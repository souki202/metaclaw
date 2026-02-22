import fs from 'fs';
import path from 'path';
import type { Config, SessionConfig, ProviderConfig, ScheduleUpsertInput, SessionSchedule } from '../types.js';
import { Agent, type EventCallback } from './agent.js';
import { ScheduleManager } from './schedule.js';
import { createLogger } from '../logger.js';
import { resolveProvider as resolveProviderConfig } from '../config.js';

const log = createLogger('sessions');

const TEMPLATE_DIR = path.resolve(process.cwd(), 'templates');

function initWorkspace(workspace: string) {
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(workspace, 'memory'), { recursive: true });

  const files = ['IDENTITY.md', 'USER.md', 'MEMORY.md', 'TMP_MEMORY.md'];
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
  private schedules = new ScheduleManager();
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.schedules.start();
  }

  setScheduleTriggerHandler(fn: (trigger: { sessionId: string; schedule: SessionSchedule }) => Promise<void>) {
    this.schedules.setTriggerHandler(fn);
  }

  startAll(onEvent?: EventCallback) {
    for (const [sessionId, sessionConfig] of Object.entries(this.config.sessions)) {
      this.startSession(sessionId, sessionConfig, onEvent);
    }
  }

  startSession(sessionId: string, sessionConfig: SessionConfig, onEvent?: EventCallback) {
    const workspace = this.resolveWorkspace(sessionConfig);
    initWorkspace(workspace);

    const agent = new Agent(
      sessionId,
      sessionConfig,
      workspace,
      onEvent,
      this.config,
      {
        list: () => this.getSchedules(sessionId),
        create: (input) => this.createSchedule(sessionId, input),
        update: (scheduleId, patch) => this.updateSchedule(sessionId, scheduleId, patch),
        remove: (scheduleId) => this.deleteSchedule(sessionId, scheduleId),
      }
    );
    this.agents.set(sessionId, agent);
    this.schedules.loadSession(sessionId, workspace);
    log.info(`Started session: ${sessionId} (workspace: ${workspace})`);

    const resumePath = path.join(workspace, '.resume');
    if (fs.existsSync(resumePath)) {
      try {
        fs.unlinkSync(resumePath);
        log.info(`Detected .resume marker for session ${sessionId}. Resuming AI interaction.`);
        setTimeout(() => {
          agent.processMessage(
            "SYSTEM: The server has successfully rebooted following your restart command. Please verify your changes and continue your previous task.",
            'system'
          ).catch(e => {
            log.error(`Failed to resume session ${sessionId}:`, e);
          });
        }, 8000);
      } catch (e) {
        log.error(`Failed to handle .resume for session ${sessionId}:`, e);
      }
    }

    return agent;
  }

  stopSession(sessionId: string) {
    this.schedules.unloadSession(sessionId);
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

  async stopAll() {
    this.schedules.stop();
    const promises = Array.from(this.agents.keys()).map(id => {
      const agent = this.agents.get(id);
      if (agent) {
        return agent.stopMcpServers().catch(e => log.error(`Error stopping MCP servers for ${id}:`, e));
      }
      return Promise.resolve();
    });
    await Promise.all(promises);
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

  getSchedules(sessionId: string): SessionSchedule[] {
    return this.schedules.list(sessionId);
  }

  createSchedule(sessionId: string, input: ScheduleUpsertInput): SessionSchedule {
    return this.schedules.create(sessionId, input);
  }

  updateSchedule(sessionId: string, scheduleId: string, patch: Partial<ScheduleUpsertInput>): SessionSchedule {
    return this.schedules.update(sessionId, scheduleId, patch);
  }

  deleteSchedule(sessionId: string, scheduleId: string): boolean {
    return this.schedules.remove(sessionId, scheduleId);
  }
}