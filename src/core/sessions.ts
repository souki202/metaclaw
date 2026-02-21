import fs from 'fs';
import path from 'path';
import type { Config, SessionConfig, ProviderConfig } from '../types.js';
import { Agent, type EventCallback } from './agent.js';
import { HeartbeatScheduler } from './heartbeat.js';
import { createLogger } from '../logger.js';
import { resolveProvider as resolveProviderConfig } from '../config.js';

const log = createLogger('sessions');

const TEMPLATE_DIR = path.resolve(process.cwd(), 'templates');

function initWorkspace(workspace: string) {
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(workspace, 'memory'), { recursive: true });

  const files = ['IDENTITY.md', 'USER.md', 'MEMORY.md', 'TMP_MEMORY.md', 'HEARTBEAT.md'];
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

    const agent = new Agent(sessionId, sessionConfig, workspace, onEvent, this.config);
    this.agents.set(sessionId, agent);
    log.info(`Started session: ${sessionId} (workspace: ${workspace})`);

    if (sessionConfig.heartbeat.enabled) {
      this.heartbeat.schedule(agent, sessionConfig.heartbeat.interval);
    }

    return agent;
  }

  stopSession(sessionId: string) {
    this.heartbeat.cancel(sessionId);
    const agent = this.agents.get(sessionId);
    if (agent) {
      agent.stopMcpServers().catch(e => log.error(`Error stopping MCP servers for ${sessionId}:`, e));
    }
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

  getSessionConfig(sessionId: string): SessionConfig | undefined {
    return this.config.sessions[sessionId];
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

  // 設定を再読み込み
  reloadConfig(config: Config) {
    this.config = config;
  }

  // セッションのプロバイダー設定を解決
  resolveProvider(sessionConfig: SessionConfig): ProviderConfig {
    return resolveProviderConfig(sessionConfig, this.config);
  }

  // Find which session a Discord channel/guild belongs to
  resolveDiscordSession(guildId?: string, channelId?: string, userId?: string, token?: string): string | null {
    let fallbackSessionId: string | null = null;
    for (const [sessionId, sessionConfig] of Object.entries(this.config.sessions)) {
      const discordCfg = sessionConfig.discord;
      if (!discordCfg || !discordCfg.enabled) continue;
      if (token && discordCfg.token !== token) continue;

      if (fallbackSessionId === null) {
        fallbackSessionId = sessionId;
      }

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

    // Default: use first session that matches the token if no specific routing
    return fallbackSessionId;
  }

  // 現在の設定を取得
  getConfig(): Config {
    return this.config;
  }
}