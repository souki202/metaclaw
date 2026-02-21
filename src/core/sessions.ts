import fs from 'fs';
import path from 'path';
import type { Config, SessionConfig } from '../types.js';
import { Agent, type EventCallback } from './agent.js';
import { HeartbeatScheduler } from './heartbeat.js';
import { createLogger } from '../logger.js';

const log = createLogger('sessions');

const TEMPLATE_DIR = path.resolve(process.cwd(), 'templates');

function initWorkspace(workspace: string) {
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(workspace, 'memory'), { recursive: true });

  const files = ['IDENTITY.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md'];
  for (const file of files) {
    const dest = path.join(workspace, file);
    if (!fs.existsSync(dest)) {
      const tmpl = path.join(TEMPLATE_DIR, file);
      if (fs.existsSync(tmpl)) {
        fs.copyFileSync(tmpl, dest);
        log.info(`Initialized ${file} in workspace: ${workspace}`);
      }
    }
  }
}

export class SessionManager {
  private agents = new Map<string, Agent>();
  private heartbeat = new HeartbeatScheduler();
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  setHeartbeatNotificationHandler(fn: (n: { sessionId: string; message: string; timestamp: Date }) => void) {
    this.heartbeat.setNotificationHandler(fn);
  }

  startAll(onEvent?: EventCallback) {
    for (const [sessionId, sessionConfig] of Object.entries(this.config.sessions)) {
      this.startSession(sessionId, sessionConfig, onEvent);
    }
  }

  startSession(sessionId: string, sessionConfig: SessionConfig, onEvent?: EventCallback) {
    const workspace = this.resolveWorkspace(sessionConfig);
    initWorkspace(workspace);

    const agent = new Agent(sessionId, sessionConfig, workspace, onEvent);
    this.agents.set(sessionId, agent);
    log.info(`Started session: ${sessionId} (workspace: ${workspace})`);

    if (sessionConfig.heartbeat.enabled) {
      this.heartbeat.schedule(agent, sessionConfig.heartbeat.interval);
    }

    return agent;
  }

  stopSession(sessionId: string) {
    this.heartbeat.cancel(sessionId);
    this.agents.delete(sessionId);
    log.info(`Stopped session: ${sessionId}`);
  }

  getAgent(sessionId: string): Agent | undefined {
    return this.agents.get(sessionId);
  }

  getSessionIds(): string[] {
    return Array.from(this.agents.keys());
  }

  getSessionConfigs(): Record<string, SessionConfig> {
    return this.config.sessions;
  }

  resolveWorkspace(sessionConfig: SessionConfig): string {
    const ws = sessionConfig.workspace;
    if (path.isAbsolute(ws)) return ws;
    return path.resolve(process.cwd(), ws);
  }

  stopAll() {
    this.heartbeat.cancelAll();
    this.agents.clear();
  }

  // Find which session a Discord channel/guild belongs to
  resolveDiscordSession(guildId?: string, channelId?: string, userId?: string): string | null {
    for (const [sessionId, sessionConfig] of Object.entries(this.config.sessions)) {
      const discordCfg = sessionConfig.discord;
      if (!discordCfg) continue;

      if (channelId && discordCfg.channels?.includes(channelId)) {
        if (!discordCfg.allowFrom || discordCfg.allowFrom.length === 0 || (userId && discordCfg.allowFrom.includes(userId))) {
          return sessionId;
        }
      }
      if (guildId && discordCfg.guilds?.includes(guildId)) {
        if (!discordCfg.allowFrom || discordCfg.allowFrom.length === 0 || (userId && discordCfg.allowFrom.includes(userId))) {
          return sessionId;
        }
      }
    }

    // Default: use first session if no specific routing
    const first = this.getSessionIds()[0];
    return first ?? null;
  }
}
