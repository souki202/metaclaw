import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type {
  Config,
  SessionConfig,
  ProviderConfig,
  ScheduleUpsertInput,
  SessionSchedule,
  OrganizationGroupChatMessage,
  OrganizationGroupChatUnread,
  OrganizationGroupChatSearchMode,
  OrganizationGroupChatSearchHit,
} from '../types.js';
import { Agent, type EventCallback } from './agent.js';
import { ScheduleManager } from './schedule.js';
import { createLogger } from '../logger.js';
import { resolveProvider as resolveProviderConfig } from '../config.js';
import { A2ARegistry } from '../a2a/registry.js';
import { generateAgentCard } from '../a2a/card-generator.js';
import { SessionCommsManager } from '../a2a/session-comms.js';
import { getEventDispatch } from '../a2a/event-dispatch.js';
import { VectorMemory } from '../memory/vector.js';
import { EmbeddingClient, type EmbeddingProvider } from '../memory/embedding.js';

const log = createLogger('sessions');

const TEMPLATE_DIR = path.resolve(process.cwd(), 'templates');

interface OrganizationGroupChatReadState {
  lastReadMessageId?: string;
}

interface OrganizationGroupChatState {
  messages: OrganizationGroupChatMessage[];
  readStates: Record<string, OrganizationGroupChatReadState>;
}

interface PendingMentionNotification {
  organizationId: string;
  messageId: string;
  fromSessionId?: string;
  fromName: string;
  content: string;
  timestamp: string;
}

const DEFAULT_ORG_CHAT_STATE: OrganizationGroupChatState = {
  messages: [],
  readStates: {},
};

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function fuzzySimilarity(query: string, target: string): number {
  const q = normalizeSearchText(query);
  const t = normalizeSearchText(target);
  if (!q || !t) return 0;
  if (t.includes(q)) return 1;

  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }

  const subsequenceScore = qi / q.length;
  const lengthPenalty = Math.min(1, q.length / Math.max(q.length, t.length * 0.6));
  return subsequenceScore * 0.7 + lengthPenalty * 0.3;
}

function extractIndexedGroupChatMessageId(text: string): string | null {
  const match = text.match(/\[group_chat_message_id:([^\]]+)\]/);
  return match?.[1] || null;
}

function initSessionDir(sessionDir: string) {
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'memory'), { recursive: true });

  const files = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'TMP_MEMORY.md'];
  for (const file of files) {
    const dest = path.join(sessionDir, file);
    if (!fs.existsSync(dest)) {
      const tmpl = path.join(TEMPLATE_DIR, file);
      if (fs.existsSync(tmpl)) {
        fs.copyFileSync(tmpl, dest);
        log.info(`Initialized ${file} in session directory: ${sessionDir}`);
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
  private organizationGroupChats = new Map<string, OrganizationGroupChatState>();
  private organizationGroupVectorMemories = new Map<string, VectorMemory>();
  private organizationEmbedder: EmbeddingProvider | null = null;
  private pendingMentionNotifications = new Map<string, PendingMentionNotification[]>();
  private mentionDeliveryInFlight = new Set<string>();

  constructor(config: Config) {
    this.config = config;
    this.setupOrganizationEmbedder(config);
    // Load schedules for all configured sessions immediately so that schedules
    // fire even for sessions that are not currently running an agent.
    this.loadAllSessionSchedules();
    this.setupEventDispatch();
  }

  /**
   * Wire the EventDrivenDispatch singleton to this session manager so that
   * it can deliver agent notifications and post group chat messages.
   */
  private setupEventDispatch(): void {
    const dispatch = getEventDispatch();
    dispatch.setAgentNotifier(async (sessionId, content) => {
      const agent = this.agents.get(sessionId);
      if (agent) {
        await agent.processMessage(content, 'system');
      }
    });
    dispatch.setGroupChatPoster((organizationId, senderSessionId, content) => {
      try {
        this.postOrganizationGroupChatMessage({
          organizationId,
          content,
          senderType: 'ai',
          senderSessionId,
        });
      } catch (err) {
        log.warn('EventDispatch group chat post failed:', err);
      }
    });
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
      const sessionDir = this.resolveSessionDir(sessionId);
      const workspace = this.resolveWorkspace(sessionConfig);
      fs.mkdirSync(workspace, { recursive: true });
      initSessionDir(sessionDir);
      this.schedules.loadSession(sessionId, sessionDir);
    }
  }

  setScheduleTriggerHandler(fn: (trigger: { sessionId: string; schedule: SessionSchedule; }) => Promise<void>) {
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
    fs.mkdirSync(workspace, { recursive: true });
    const sessionDir = this.resolveSessionDir(sessionId);
    initSessionDir(sessionDir);

    const agent = new Agent(
      sessionId,
      sessionConfig,
      sessionDir,
      workspace,
      onEvent,
      this.config,
      {
        list: () => this.getSchedules(sessionId),
        create: (input: ScheduleUpsertInput) => this.createSchedule(sessionId, input),
        update: (scheduleId: string, patch: Partial<ScheduleUpsertInput>) => this.updateSchedule(sessionId, scheduleId, patch),
        remove: (scheduleId: string) => this.deleteSchedule(sessionId, scheduleId),
      },
      this.a2aRegistry,
      this.commsManager,
      () => this
    );
    this.agents.set(sessionId, agent);
    this.schedules.loadSession(sessionId, sessionDir);

    // Load persisted messages if they exist
    this.commsManager.loadMessagesFromFile(sessionId, sessionDir);

    log.info(`Started session: ${sessionId} (sessionDir: ${sessionDir}, workspace: ${workspace})`);

    // Register agent card if A2A is enabled
    if (sessionConfig.a2a?.enabled) {
      this.registerAgentCard(sessionId, agent).catch(e =>
        log.error(`Failed to register agent card for ${sessionId}:`, e)
      );
    }

    const resumePath = path.join(sessionDir, '.resume');
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

    if ((this.pendingMentionNotifications.get(sessionId) || []).length > 0) {
      setTimeout(() => this.scheduleMentionNotificationDelivery(sessionId), 1000);
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
      const sessionDir = agent.getSessionDir();
      this.commsManager.saveMessagesToFile(sessionId, sessionDir);
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
      const sessionDir = agent.getSessionDir();
      this.commsManager.saveMessagesToFile(sessionId, sessionDir);
    }

    // Unregister from A2A
    this.a2aRegistry.unregister(sessionId);

    this.agents.delete(sessionId);
    log.info(`Deleted session: ${sessionId}`);
  }

  isSessionActive(sessionId: string): boolean {
    return this.getAgent(sessionId) !== undefined;
  }

  getAgent(sessionId: string): Agent | undefined {
    const agents = (this as any).agents;
    if (!(agents instanceof Map)) {
      return undefined;
    }
    return agents.get(sessionId);
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

  getSessionOrganizationId(sessionId: string): string | null {
    const config = this.config.sessions[sessionId];
    if (!config) return null;
    const orgId = config.organizationId?.trim();
    return orgId && orgId.length > 0 ? orgId : 'default';
  }

  isSameOrganization(sessionA: string, sessionB: string): boolean {
    const orgA = this.getSessionOrganizationId(sessionA);
    const orgB = this.getSessionOrganizationId(sessionB);
    return !!orgA && !!orgB && orgA === orgB;
  }

  getOrganizationIds(): string[] {
    const orgs = new Set<string>();
    for (const config of Object.values(this.config.sessions)) {
      orgs.add(config.organizationId?.trim() || 'default');
    }
    return Array.from(orgs.values()).sort((a, b) => a.localeCompare(b));
  }

  getOrganizationSessions(organizationId: string): Array<{ id: string; name: string; }> {
    const orgId = this.normalizeOrganizationId(organizationId);
    return Object.entries(this.config.sessions)
      .filter(([sessionId]) => this.getSessionOrganizationId(sessionId) === orgId)
      .map(([sessionId, sessionConfig]) => ({
        id: sessionId,
        name: sessionConfig.name?.trim() || sessionId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  postOrganizationGroupChatMessage(input: {
    organizationId: string;
    content: string;
    senderType: 'ai' | 'human';
    senderSessionId?: string;
    senderName?: string;
  }): OrganizationGroupChatMessage {
    const organizationId = this.normalizeOrganizationId(input.organizationId);
    const content = input.content?.trim();
    if (!content) {
      throw new Error('Message content cannot be empty.');
    }

    if (input.senderSessionId) {
      const senderOrg = this.getSessionOrganizationId(input.senderSessionId);
      if (!senderOrg) {
        throw new Error(`Sender session "${input.senderSessionId}" was not found.`);
      }
      if (senderOrg !== organizationId) {
        throw new Error('Cross-organization group chat posting is not allowed.');
      }
    }

    const mentions = this.extractMentionedSessions(organizationId, content);
    const state = this.ensureOrganizationGroupChatState(organizationId);

    const senderName = input.senderName?.trim()
      || (input.senderSessionId ? (this.config.sessions[input.senderSessionId]?.name || input.senderSessionId) : undefined)
      || (input.senderType === 'ai' ? 'AI' : 'Human');

    const message: OrganizationGroupChatMessage = {
      id: randomUUID(),
      organizationId,
      senderType: input.senderType,
      senderSessionId: input.senderSessionId,
      senderName,
      content,
      mentionSessionIds: mentions.map((m) => m.id),
      mentionSessionNames: mentions.map((m) => m.name),
      timestamp: new Date().toISOString(),
    };

    state.messages.push(message);
    this.saveOrganizationGroupChatState(organizationId);

    this.indexOrganizationGroupChatMessage(message).catch((error) => {
      log.warn(`Failed to index organization group chat message ${message.id}:`, error);
    });

    this.enqueueMentionNotifications(message);

    return message;
  }

  async searchOrganizationGroupChatMessages(input: {
    organizationId: string;
    query: string;
    mode?: OrganizationGroupChatSearchMode;
    viewerSessionId?: string;
    limit?: number;
  }): Promise<{ mode: OrganizationGroupChatSearchMode; hits: OrganizationGroupChatSearchHit[]; }> {
    const organizationId = this.normalizeOrganizationId(input.organizationId);
    const query = input.query?.trim();
    if (!query) {
      return {
        mode: input.mode || 'substring',
        hits: [],
      };
    }

    if (input.viewerSessionId) {
      const viewerOrg = this.getSessionOrganizationId(input.viewerSessionId);
      if (!viewerOrg || viewerOrg !== organizationId) {
        throw new Error('Cross-organization group chat search is not allowed.');
      }
    }

    const mode = input.mode || 'substring';
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const state = this.ensureOrganizationGroupChatState(organizationId);

    if (mode === 'semantic') {
      const vectorMemory = this.getOrganizationGroupVectorMemory(organizationId);
      if (!vectorMemory) {
        return { mode, hits: [] };
      }

      const vectorHits = await vectorMemory.search(query, Math.max(limit * 3, 10));
      const mapped: OrganizationGroupChatSearchHit[] = [];
      const seen = new Set<string>();

      for (const hit of vectorHits) {
        const messageId = extractIndexedGroupChatMessageId(hit.entry.text);
        if (!messageId || seen.has(messageId)) continue;

        const message = state.messages.find((m) => m.id === messageId);
        if (!message) continue;

        seen.add(messageId);
        mapped.push({
          message,
          score: hit.score,
        });

        if (mapped.length >= limit) break;
      }

      return { mode, hits: mapped };
    }

    const normalizedQuery = normalizeSearchText(query);
    const scored: OrganizationGroupChatSearchHit[] = [];

    for (const message of state.messages) {
      const haystack = normalizeSearchText(
        `${message.senderName} ${message.content} ${message.mentionSessionNames.join(' ')} ${message.mentionSessionIds.join(' ')}`
      );

      let score = 0;
      if (mode === 'substring') {
        const index = haystack.indexOf(normalizedQuery);
        if (index < 0) continue;
        score = 1 / (1 + index);
      } else {
        score = fuzzySimilarity(normalizedQuery, haystack);
        if (score < 0.3) continue;
      }

      scored.push({ message, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return {
      mode,
      hits: scored.slice(0, limit),
    };
  }

  getOrganizationGroupChatMessages(input: {
    organizationId: string;
    viewerSessionId?: string;
    limit?: number;
    unreadOnly?: boolean;
    mentionsOnly?: boolean;
  }): { messages: OrganizationGroupChatMessage[]; unread: OrganizationGroupChatUnread; } {
    const organizationId = this.normalizeOrganizationId(input.organizationId);
    const state = this.ensureOrganizationGroupChatState(organizationId);
    const unread = this.getOrganizationGroupChatUnreadCount(organizationId, input.viewerSessionId);

    const safeLimit = Math.max(1, Math.min(input.limit ?? 200, 500));
    let filtered = state.messages;

    if (input.viewerSessionId) {
      const viewerSessionId = input.viewerSessionId;
      const viewerOrg = this.getSessionOrganizationId(input.viewerSessionId);
      if (!viewerOrg || viewerOrg !== organizationId) {
        throw new Error('Cross-organization group chat access is not allowed.');
      }

      const readId = state.readStates[viewerSessionId]?.lastReadMessageId;
      const readIndex = readId ? state.messages.findIndex((m) => m.id === readId) : -1;

      if (input.unreadOnly) {
        filtered = filtered.filter((m, idx) => idx > readIndex && m.senderSessionId !== viewerSessionId);
      }

      if (input.mentionsOnly) {
        filtered = filtered.filter((m, idx) => {
          if (m.senderSessionId === viewerSessionId) return false;
          if (!m.mentionSessionIds.includes(viewerSessionId)) return false;
          return input.unreadOnly ? idx > readIndex : true;
        });
      }
    }

    if (filtered.length > safeLimit) {
      filtered = filtered.slice(filtered.length - safeLimit);
    }

    return {
      messages: filtered,
      unread,
    };
  }

  markOrganizationGroupChatAsRead(input: {
    organizationId: string;
    viewerSessionId: string;
  }): OrganizationGroupChatUnread {
    const organizationId = this.normalizeOrganizationId(input.organizationId);
    const viewerOrg = this.getSessionOrganizationId(input.viewerSessionId);
    if (!viewerOrg || viewerOrg !== organizationId) {
      throw new Error('Cross-organization read state updates are not allowed.');
    }

    const state = this.ensureOrganizationGroupChatState(organizationId);
    const latest = state.messages[state.messages.length - 1];
    if (latest) {
      state.readStates[input.viewerSessionId] = {
        lastReadMessageId: latest.id,
      };
      this.saveOrganizationGroupChatState(organizationId);
    }

    this.pruneMentionNotifications(input.viewerSessionId);

    return this.getOrganizationGroupChatUnreadCount(organizationId, input.viewerSessionId);
  }

  getOrganizationGroupChatUnreadCount(
    organizationId: string,
    viewerSessionId?: string,
  ): OrganizationGroupChatUnread {
    if (!viewerSessionId) {
      return { total: 0, mentions: 0 };
    }

    const orgId = this.normalizeOrganizationId(organizationId);
    const state = this.ensureOrganizationGroupChatState(orgId);
    const readId = state.readStates[viewerSessionId]?.lastReadMessageId;
    const readIndex = readId ? state.messages.findIndex((m) => m.id === readId) : -1;

    let total = 0;
    let mentions = 0;

    for (let i = readIndex + 1; i < state.messages.length; i++) {
      const message = state.messages[i];
      if (message.senderSessionId === viewerSessionId) continue;

      total += 1;
      if (message.mentionSessionIds.includes(viewerSessionId)) {
        mentions += 1;
      }
    }

    return { total, mentions };
  }

  private normalizeOrganizationId(organizationId: string): string {
    const id = organizationId?.trim();
    return id && id.length > 0 ? id : 'default';
  }

  private setupOrganizationEmbedder(config: Config): void {
    if (config.embedding?.endpoint && config.embedding.apiKey && config.embedding.model) {
      this.organizationEmbedder = new EmbeddingClient(config.embedding);
      for (const memory of this.organizationGroupVectorMemories.values()) {
        memory.updateEmbedder(this.organizationEmbedder);
      }
      return;
    }

    this.organizationEmbedder = null;
    this.organizationGroupVectorMemories.clear();
  }

  private getOrganizationGroupVectorMemory(organizationId: string): VectorMemory | null {
    if (!this.organizationEmbedder) return null;

    const orgId = this.normalizeOrganizationId(organizationId);
    const existing = this.organizationGroupVectorMemories.get(orgId);
    if (existing) return existing;

    const workspace = path.join(process.cwd(), 'data', 'organizations', orgId);
    const memory = new VectorMemory(workspace, `organization-group-chat:${orgId}`, this.organizationEmbedder);
    this.organizationGroupVectorMemories.set(orgId, memory);
    return memory;
  }

  private async indexOrganizationGroupChatMessage(message: OrganizationGroupChatMessage): Promise<void> {
    const vectorMemory = this.getOrganizationGroupVectorMemory(message.organizationId);
    if (!vectorMemory) return;

    const mentionText = message.mentionSessionNames.length > 0
      ? ` Mentions: ${message.mentionSessionNames.join(', ')}`
      : '';

    const indexedText = `[group_chat_message_id:${message.id}] [${message.senderName}] ${message.content}${mentionText}`;
    await vectorMemory.add(indexedText, {
      category: 'organization-group-chat',
      source: 'organization-group-chat',
      sessionId: message.senderSessionId,
      timestamp: message.timestamp,
      type: 'manual',
    });
  }

  private enqueueMentionNotifications(message: OrganizationGroupChatMessage): void {
    for (const targetSessionId of message.mentionSessionIds) {
      if (message.senderSessionId && targetSessionId === message.senderSessionId) {
        if (message.senderType === 'ai') {
          continue;
        }
      }

      const targetOrg = this.getSessionOrganizationId(targetSessionId);
      if (!targetOrg || targetOrg !== message.organizationId) {
        continue;
      }

      const queue = this.pendingMentionNotifications.get(targetSessionId) || [];
      if (queue.some((queued) => queued.messageId === message.id)) {
        continue;
      }

      queue.push({
        organizationId: message.organizationId,
        messageId: message.id,
        fromSessionId: message.senderSessionId,
        fromName: message.senderName,
        content: message.content,
        timestamp: message.timestamp,
      });
      this.pendingMentionNotifications.set(targetSessionId, queue);
      this.scheduleMentionNotificationDelivery(targetSessionId);
    }
  }

  private scheduleMentionNotificationDelivery(sessionId: string): void {
    if (this.mentionDeliveryInFlight.has(sessionId)) {
      return;
    }

    this.mentionDeliveryInFlight.add(sessionId);
    setImmediate(() => {
      this.deliverMentionNotifications(sessionId)
        .catch((error) => {
          log.error(`Mention delivery failed for ${sessionId}:`, error);
        })
        .finally(() => {
          this.mentionDeliveryInFlight.delete(sessionId);
          const remaining = this.pruneMentionNotifications(sessionId);
          if (remaining.length > 0) {
            // If agent is active retry quickly; if session is inactive retry in 5s waiting for it to start
            const delay = this.getAgent(sessionId) ? 500 : 5000;
            setTimeout(() => this.scheduleMentionNotificationDelivery(sessionId), delay);
          }
        });
    });
  }

  private async deliverMentionNotifications(sessionId: string): Promise<void> {
    while (true) {
      const queue = this.pruneMentionNotifications(sessionId);
      if (queue.length === 0) {
        return;
      }

      let agent = this.getAgent(sessionId);
      if (!agent) {
        const config = this.config.sessions[sessionId];
        if (!config) {
          this.pendingMentionNotifications.delete(sessionId);
          return;
        }
        log.info(`Auto-starting session ${sessionId} to deliver mention notification`);
        agent = await this.startSession(sessionId, config);
      }

      const next = queue[0];
      const mentionMessage = [
        '[GROUP_CHAT_MENTION]',
        `Organization: ${next.organizationId}`,
        `From: ${next.fromName}${next.fromSessionId ? ` (${next.fromSessionId})` : ''}`,
        `Timestamp: ${next.timestamp}`,
        `Message ID: ${next.messageId}`,
        '',
        next.content,
        '',
        'You were mentioned in organization group chat. Use read_organization_group_chat or search_organization_group_chat if you need additional context.',
      ].join('\n');

      if (agent.isProcessing()) {
        agent.injectNotification(mentionMessage);
        queue.shift();
        if (queue.length === 0) {
          this.pendingMentionNotifications.delete(sessionId);
        } else {
          this.pendingMentionNotifications.set(sessionId, queue);
        }
        continue;
      }

      try {
        await agent.processMessage(mentionMessage, 'system');
        queue.shift();
        if (queue.length === 0) {
          this.pendingMentionNotifications.delete(sessionId);
        } else {
          this.pendingMentionNotifications.set(sessionId, queue);
        }
      } catch (error) {
        log.error(`Failed to deliver mention notification to ${sessionId}:`, error);
        return;
      }
    }
  }

  private pruneMentionNotifications(sessionId: string): PendingMentionNotification[] {
    const queue = this.pendingMentionNotifications.get(sessionId) || [];
    if (queue.length === 0) {
      this.pendingMentionNotifications.delete(sessionId);
      return [];
    }

    const sessionOrg = this.getSessionOrganizationId(sessionId);
    if (!sessionOrg) {
      this.pendingMentionNotifications.delete(sessionId);
      return [];
    }

    const filtered = queue.filter((notification) => {
      if (notification.organizationId !== sessionOrg) {
        return false;
      }
      return this.isGroupChatMessageUnreadForSession(
        notification.organizationId,
        sessionId,
        notification.messageId,
      );
    });

    if (filtered.length === 0) {
      this.pendingMentionNotifications.delete(sessionId);
      return [];
    }

    if (filtered.length !== queue.length) {
      this.pendingMentionNotifications.set(sessionId, filtered);
    }

    return filtered;
  }

  private isGroupChatMessageUnreadForSession(
    organizationId: string,
    sessionId: string,
    messageId: string,
  ): boolean {
    const orgId = this.normalizeOrganizationId(organizationId);
    const sessionOrg = this.getSessionOrganizationId(sessionId);
    if (!sessionOrg || sessionOrg !== orgId) {
      return false;
    }

    const state = this.ensureOrganizationGroupChatState(orgId);
    const messageIndex = state.messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) {
      return false;
    }

    const readId = state.readStates[sessionId]?.lastReadMessageId;
    const readIndex = readId ? state.messages.findIndex((message) => message.id === readId) : -1;

    return messageIndex > readIndex;
  }

  private getOrganizationGroupChatFilePath(organizationId: string): string {
    return path.join(process.cwd(), 'data', 'organizations', organizationId, 'group-chat.json');
  }

  private ensureOrganizationGroupChatState(organizationId: string): OrganizationGroupChatState {
    const orgId = this.normalizeOrganizationId(organizationId);
    const existing = this.organizationGroupChats.get(orgId);
    if (existing) return existing;

    const filePath = this.getOrganizationGroupChatFilePath(orgId);
    if (fs.existsSync(filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<OrganizationGroupChatState>;
        const state: OrganizationGroupChatState = {
          messages: Array.isArray(parsed.messages) ? parsed.messages : [],
          readStates: parsed.readStates && typeof parsed.readStates === 'object' ? parsed.readStates : {},
        };
        this.organizationGroupChats.set(orgId, state);
        return state;
      } catch (error) {
        log.error(`Failed to load organization group chat state for ${orgId}:`, error);
      }
    }

    const fresh: OrganizationGroupChatState = {
      messages: [...DEFAULT_ORG_CHAT_STATE.messages],
      readStates: { ...DEFAULT_ORG_CHAT_STATE.readStates },
    };
    this.organizationGroupChats.set(orgId, fresh);
    return fresh;
  }

  private saveOrganizationGroupChatState(organizationId: string): void {
    const orgId = this.normalizeOrganizationId(organizationId);
    const state = this.ensureOrganizationGroupChatState(orgId);
    const filePath = this.getOrganizationGroupChatFilePath(orgId);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  private extractMentionedSessions(organizationId: string, content: string): Array<{ id: string; name: string; }> {
    const sessions = this.getOrganizationSessions(organizationId)
      .filter((session) => session.name.trim().length > 0)
      .sort((a, b) => b.name.length - a.name.length);

    const boundaryBefore = '(^|[\\s\\u3000.,!?;:。、！？；：，、([{"「『（【〈《])';
    const boundaryAfter = '(?=$|[\\s\\u3000.,!?;:。、！？；：，、)\\]}"」』）】〉》])';
    const mentionPrefix = '[@＠]';

    const found = new Map<string, { id: string; name: string; }>();
    for (const session of sessions) {
      const escaped = session.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedId = session.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const byNameRegex = new RegExp(`${boundaryBefore}${mentionPrefix}${escaped}${boundaryAfter}`, 'iu');
      const byIdRegex = new RegExp(`${boundaryBefore}${mentionPrefix}${escapedId}${boundaryAfter}`, 'iu');
      if (byNameRegex.test(content) || byIdRegex.test(content)) {
        found.set(session.id, session);
      }
    }

    return Array.from(found.values());
  }

  resolveWorkspace(sessionConfig: SessionConfig): string {
    const ws = sessionConfig.workspace;
    if (path.isAbsolute(ws)) return ws;
    return path.resolve(process.cwd(), ws);
  }

  resolveSessionDir(sessionId: string): string {
    return path.join(process.cwd(), 'data', 'sessions', sessionId);
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
    this.setupOrganizationEmbedder(config);
    // Reload schedules to pick up any sessions added or removed in the new config
    this.loadAllSessionSchedules();

    for (const [sessionId, agent] of this.agents.entries()) {
      const sessionConfig = this.config.sessions[sessionId];
      if (sessionConfig) {
        agent.updateConfig(sessionConfig);
      }
      agent.updateGlobalConfig(this.config);
    }
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