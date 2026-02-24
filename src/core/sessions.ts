import fs from 'fs';
import path from 'path';
import type { Config, SessionConfig, ProviderConfig, ScheduleUpsertInput, SessionSchedule } from '../types.js';
import { Agent, type EventCallback } from './agent.js';
import { ScheduleManager } from './schedule.js';
import { createLogger } from '../logger.js';
import { resolveProvider as resolveProviderConfig } from '../config.js';
import { A2ARegistry } from '../a2a/registry.js';
import { generateAgentCard } from '../a2a/card-generator.js';
import { SessionCommsManager } from '../a2a/session-comms.js';

const log = createLogger('sessions');

const TEMPLATE_DIR = path.resolve(process.cwd(), 'templates');

function initWorkspace(workspace: string) {
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(workspace, 'memory'), { recursive: true });

  const files = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'TMP_MEMORY.md'];
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
  private a2aRegistry = new A2ARegistry();
  private commsManager = new SessionCommsManager();

  constructor(config: Config) {
    this.config = config;
    // Load schedules for all configured sessions immediately so that schedules
    // fire even for sessions that are not currently running an agent.
    this.loadAllSessionSchedules();
  }

  /**
   * Get the A2A registry
   */
  getA2ARegistry(): A2ARegistry {
    return this.a2aRegistry;
  }

  /**
   * Get the communications manager
   */
  getCommsManager(): SessionCommsManager {
    return this.commsManager;
  }

  /**
   * Start the schedule timer.  Must be called after setScheduleTriggerHandler()
   * so that the handler is in place before any schedule fires.
   */
  startScheduler() {
    this.schedules.start();
  }

  /**
   * Load schedules from disk for every session in the current config.
   * Safe to call multiple times; subsequent calls refresh the in-memory state.
   */
  private loadAllSessionSchedules() {
    for (const [sessionId, sessionConfig] of Object.entries(this.config.sessions)) {
      const workspace = this.resolveWorkspace(sessionConfig);
      initWorkspace(workspace);
      this.schedules.loadSession(sessionId, workspace);
    }
  }

  setScheduleTriggerHandler(fn: (trigger: { sessionId: string; schedule: SessionSchedule }) => Promise<void>) {
    this.schedules.setTriggerHandler(fn);
  }

  setScheduleChangeHandler(fn: (sessionId: string, schedules: SessionSchedule[]) => void) {
    this.schedules.setScheduleChangeHandler(fn);
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
      },
      this.a2aRegistry,
      this.commsManager,
      () => this
    );
    this.agents.set(sessionId, agent);
    this.schedules.loadSession(sessionId, workspace);

    // Load persisted messages if they exist
    this.commsManager.loadMessagesFromFile(sessionId, workspace);

    log.info(`Started session: ${sessionId} (workspace: ${workspace})`);

    // Register agent card if A2A is enabled
    if (sessionConfig.a2a?.enabled) {
      this.registerAgentCard(sessionId, agent).catch(e =>
        log.error(`Failed to register agent card for ${sessionId}:`, e)
      );
    }

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
    // Schedules are intentionally NOT unloaded here so that recurring schedules
    // continue to fire even when the agent is not running.
    const agent = this.agents.get(sessionId);
    if (agent) {
      agent.stopMcpServers().catch(e => log.error(`Error stopping MCP servers for ${sessionId}:`, e));
      // Save messages before stopping
      const workspace = agent.getWorkspace();
      this.commsManager.saveMessagesToFile(sessionId, workspace);
    }

    // Unregister from A2A if enabled
    const config = this.config.sessions[sessionId];
    if (config?.a2a?.enabled) {
      this.a2aRegistry.unregister(sessionId);
    }

    this.agents.delete(sessionId);
    log.info(`Stopped session: ${sessionId}`);
  }

  /**
   * Permanently remove a session: stop the agent and unload its schedules.
   * Use this when the session is deleted from config, not just temporarily stopped.
   */
  deleteSession(sessionId: string) {
    this.schedules.unloadSession(sessionId);
    const agent = this.agents.get(sessionId);
    if (agent) {
      agent.stopMcpServers().catch(e => log.error(`Error stopping MCP servers for ${sessionId}:`, e));
      // Save messages before deleting
      const workspace = agent.getWorkspace();
      this.commsManager.saveMessagesToFile(sessionId, workspace);
    }

    // Unregister from A2A
    this.a2aRegistry.unregister(sessionId);

    this.agents.delete(sessionId);
    log.info(`Deleted session: ${sessionId}`);
  }

  isSessionActive(sessionId: string): boolean {
    return this.agents.has(sessionId);
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
    // Reload schedules to pick up any sessions added or removed in the new config
    this.loadAllSessionSchedules();
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

  // Find which session a Slack channel/team belongs to
  resolveSlackSession(teamId?: string, channelId?: string, userId?: string, botToken?: string): string | null {
    let fallbackSessionId: string | null = null;
    for (const [sessionId, sessionConfig] of Object.entries(this.config.sessions)) {
      const slackCfg = sessionConfig.slack;
      if (!slackCfg || !slackCfg.enabled) continue;
      if (botToken && slackCfg.botToken !== botToken) continue;

      if (fallbackSessionId === null) {
        fallbackSessionId = sessionId;
      }

      if (channelId && slackCfg.channels?.includes(channelId)) {
        if (!slackCfg.allowFrom || slackCfg.allowFrom.length === 0 || (userId && slackCfg.allowFrom.includes(userId))) {
          return sessionId;
        }
      }

      if (teamId && slackCfg.teams?.includes(teamId)) {
        if (!slackCfg.allowFrom || slackCfg.allowFrom.length === 0 || (userId && slackCfg.allowFrom.includes(userId))) {
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

  /**
   * Register or update an agent's card in the A2A registry
   */
  private async registerAgentCard(sessionId: string, agent: Agent): Promise<void> {
    const config = this.config.sessions[sessionId];
    if (!config) return;

    const workspace = this.resolveWorkspace(config);
    const availableTools = await agent.getAvailableTools();
    const toolNames = availableTools.map(t => t.function.name);

    const card = generateAgentCard(sessionId, config, workspace, toolNames);
    this.a2aRegistry.register(sessionId, card);

    // Set up message handler
    this.a2aRegistry.registerHandler(sessionId, async (message) => {
      if (message.type === 'request') {
        const payload = message.payload as any;
        const task = payload.params.task;

        log.info(`A2A request received for ${sessionId}: ${task}`);

        // Ensure agent is active
        if (!this.isSessionActive(sessionId)) {
          this.startSession(sessionId, config);
        }

        // Send task to agent with special A2A marker
        const formattedTask = [
          `[A2A_REQUEST] Task request from agent: ${message.from}`,
          `Request ID: ${message.id}`,
          `Priority: ${payload.params.priority || 'normal'}`,
          ``,
          `Task: ${task}`,
        ].join('\n');

        if (payload.params.context) {
          formattedTask + `\nContext: ${JSON.stringify(payload.params.context, null, 2)}`;
        }

        formattedTask + '\n\nPlease execute this task and use respond_to_agent tool to send back the results.';

        agent.processMessage(formattedTask, 'system').catch(e => {
          log.error(`Error processing A2A request for ${sessionId}:`, e);
        });
      }
    });

    log.info(`Registered agent card for ${sessionId}: ${card.agentName}`);
  }
}