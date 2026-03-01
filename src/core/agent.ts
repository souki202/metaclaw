import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ChatMessage, SessionConfig, Config, ProviderConfig, ContentPart, ContentPartText, ToolDefinition, ScheduleUpsertInput, SessionSchedule } from '../types.js';
import { OpenAIProvider } from '../providers/openai.js';
import { VectorMemory, type RecalledEntry } from '../memory/vector.js';
import { EmbeddingClient, type EmbeddingProvider } from '../memory/embedding.js';
import { QuickMemory, WorkspaceFiles } from '../memory/quick.js';
import { buildTools, executeTool, type ToolContext } from '../tools/index.js';
import { McpClientManager } from '../tools/mcp-client.js';
import { buildSkillsPromptText } from './skills.js';
import { createLogger } from '../logger.js';
import type { A2ARegistry } from '../a2a/registry.js';
import { ACAManager } from '../aca/manager.js';
import type { ACAConfig } from '../aca/types.js';
import type { SessionCommsManager } from '../a2a/session-comms.js';
import { countTokens, sliceToTokenLimit } from '../utils/tokens.js';

const MAX_ITERATIONS = 100;
const RESTART_CODE = 75;
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_COMPRESSION_THRESHOLD = 0.8;
const DEFAULT_KEEP_RECENT_MESSAGES = 20;
const MIN_KEEP_RECENT_MESSAGES = 4;
// Token-based limits for memory recall (changed from character-based)
const MAX_RECALL_COMPRESSED_TOKENS = 250;  // ~1000 chars / 4
const MAX_RECALL_RAW_TOKENS = 25000;  // ~100000 chars / 4
const TURN_RECALL_LIMIT = 30;
const AUTONOMOUS_RECALL_LIMIT = 20;
// Token limits for individual memory entries
const MAX_CRITICAL_MEMORY_TOKENS = 550;  // ~2200 chars / 4
const MAX_RELATED_MEMORY_TOKENS = 175;  // ~700 chars / 4
const MAX_CUE_TOKENS = 300;  // ~1200 chars / 4
const MAX_FLOW_CONTEXT_TOKENS = 500;  // ~2000 chars / 4

// Remove image_url content parts from messages for models that don't support vision.
// If a message becomes empty after stripping, keep it with an empty string.
function stripImageUrls(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(m => {
    if (!Array.isArray(m.content)) return m;
    const textParts = (m.content as ContentPart[]).filter(
      (p): p is ContentPartText => p.type === 'text',
    );
    if (textParts.length === m.content.length) return m; // nothing to strip
    return {
      ...m,
      content:
        textParts.length === 0 ? '' :
          textParts.length === 1 ? textParts[0].text :
            textParts,
    };
  });
}

// Accurate token estimation using tiktoken
function estimateTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => {
    if (!m.content) return sum + 10;
    if (typeof m.content === 'string') {
      return sum + countTokens(m.content) + 10;
    }
    // Multi-part content
    let tokens = 10;
    for (const part of m.content) {
      if (part.type === 'text') tokens += countTokens(part.text);
      else tokens += 765; // high detail image
    }
    return sum + tokens;
  }, 0);
}

// Helper: extract text from potentially multi-part content
function extractText(content: string | ContentPart[] | null): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is ContentPartText => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export type EventCallback = (event: {
  type: string;
  sessionId: string;
  data: unknown;
}) => void;

export interface AgentScheduleAccess {
  list: () => SessionSchedule[];
  create: (input: ScheduleUpsertInput) => SessionSchedule;
  update: (scheduleId: string, patch: Partial<ScheduleUpsertInput>) => SessionSchedule;
  remove: (scheduleId: string) => boolean;
}

export class Agent {
  private sessionId: string;
  private config: SessionConfig;
  private sessionDir: string;
  private workspace: string;
  private provider: OpenAIProvider;
  private memoryCompressionProvider: OpenAIProvider | null = null;
  private memoryCompressionProviderKey: string | null = null;
  private providerConfig: ProviderConfig;
  private embeddingProvider: EmbeddingProvider | null;
  private quickMemory: QuickMemory;
  private tmpMemory: QuickMemory;
  private vectorMemory: VectorMemory | null;
  private mcpManager: McpClientManager;
  private files: WorkspaceFiles;
  private history: ChatMessage[] = [];
  private log: ReturnType<typeof createLogger>;
  private onEvent?: EventCallback;
  private globalConfig?: Config;
  private scheduleAccess?: AgentScheduleAccess;
  private a2aRegistry?: A2ARegistry;
  private acaManager?: ACAManager;
  private commsManager?: SessionCommsManager;
  private getSessionManager?: () => any; // Getter to avoid circular dependency
  private abortController: AbortController | null = null;
  private activeProcessingCount = 0;
  private idleWaiters: Array<() => void> = [];
  private pendingNotifications: string[] = [];

  constructor(
    sessionId: string,
    config: SessionConfig,
    sessionDir: string,
    workspace: string,
    onEvent?: EventCallback,
    globalConfig?: Config,
    scheduleAccess?: AgentScheduleAccess,
    a2aRegistry?: A2ARegistry,
    commsManager?: SessionCommsManager,
    getSessionManager?: () => any,
  ) {
    this.sessionId = sessionId;
    this.config = config;
    this.sessionDir = sessionDir;
    this.workspace = workspace;

    // プロバイダー設定を解決
    this.providerConfig = this.resolveProviderConfig();
    this.provider = new OpenAIProvider(this.providerConfig);

    // Embedding provider: only use global embedding config (no per-session fallback)
    if (globalConfig?.embedding?.endpoint && globalConfig.embedding.apiKey && globalConfig.embedding.model) {
      this.embeddingProvider = new EmbeddingClient(globalConfig.embedding);
      this.vectorMemory = new VectorMemory(sessionDir, sessionId, this.embeddingProvider);
    } else {
      this.embeddingProvider = null;
      this.vectorMemory = null;
    }

    this.quickMemory = new QuickMemory(sessionDir);
    this.tmpMemory = new QuickMemory(sessionDir, 'TMP_MEMORY.md');
    this.mcpManager = new McpClientManager(globalConfig?.search, workspace);
    this.files = new WorkspaceFiles(sessionDir);
    this.log = createLogger(`agent:${sessionId}`);
    this.onEvent = onEvent;
    this.globalConfig = globalConfig;
    this.scheduleAccess = scheduleAccess;
    this.a2aRegistry = a2aRegistry;
    this.commsManager = commsManager;
    this.getSessionManager = getSessionManager;

    // Initialize ACA if enabled
    if (config.aca?.enabled) {
      const acaConfig: ACAConfig = {
        enabled: true,
        scanInterval: config.aca.scanInterval || 60,
        maxGoalsPerCycle: config.aca.maxGoalsPerCycle || 3,
        minImportanceThreshold: 0.5,
        autoScheduleObjectives: false,
        explorationBudget: 120, // 2 hours per day default
      };
      this.acaManager = new ACAManager(sessionId, workspace, acaConfig);
      this.acaManager.start();
    }

    this.loadHistory();
    this.initMcpServers();
  }

  private loadHistory() {
    const historyPath = path.join(this.sessionDir, 'history.jsonl');
    if (fs.existsSync(historyPath)) {
      try {
        const content = fs.readFileSync(historyPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        this.history = lines.map(l => {
          const parsed = JSON.parse(l);
          return {
            role: parsed.role,
            content: parsed.content,
            reasoning: parsed.reasoning,
            name: parsed.name,
            tool_call_id: parsed.tool_call_id,
            tool_calls: parsed.tool_calls
          } as ChatMessage;
        });
        this.log.info(`Loaded ${this.history.length} messages from history`);
      } catch (e) {
        this.log.error('Failed to load history:', e);
        this.history = [];
      }
    }
  }

  private async initMcpServers() {
    // Start consult-ai if configured
    if (this.config.consultAi && this.config.consultAi.enabled !== false) {
      try {
        await this.mcpManager.startServer('consult-ai', {
          type: 'builtin-consult',
          ...this.config.consultAi,
        });
      } catch (e) {
        this.log.error(`Failed to start built-in MCP server "consult-ai":`, e);
      }
    }

    const servers = this.config.mcpServers;
    if (!servers) return;

    for (const [id, config] of Object.entries(servers)) {
      if (config.enabled === false) continue;
      try {
        await this.mcpManager.startServer(id, config);
      } catch (e) {
        this.log.error(`Failed to start MCP server "${id}":`, e);
      }
    }
  }

  async stopMcpServers() {
    await this.mcpManager.stopAll();

    // Stop ACA manager if running
    if (this.acaManager) {
      this.acaManager.stop();
    }
  }

  cancelProcessing() {
    if (this.abortController) {
      this.log.info('Cancelling ongoing AI processing');
      this.abortController.abort();
      this.abortController = null;
    }
  }

  isProcessing(): boolean {
    return this.activeProcessingCount > 0;
  }

  waitForIdle(): Promise<void> {
    if (!this.isProcessing()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private beginProcessing() {
    const wasIdle = this.activeProcessingCount === 0;
    this.activeProcessingCount += 1;
    if (wasIdle) {
      this.emit('busy_change', { isBusy: true });
    }
  }

  private endProcessing() {
    if (this.activeProcessingCount > 0) {
      this.activeProcessingCount -= 1;
    }

    if (this.activeProcessingCount === 0) {
      this.emit('busy_change', { isBusy: false });
      if (this.idleWaiters.length > 0) {
        const waiters = this.idleWaiters.splice(0, this.idleWaiters.length);
        for (const resolve of waiters) {
          resolve();
        }
      }
    }
  }

  getMcpManager() {
    return this.mcpManager;
  }

  updateConfig(newConfig: SessionConfig) {
    this.config = newConfig;
    this.providerConfig = this.resolveProviderConfig();
    this.provider = new OpenAIProvider(this.providerConfig);
    // VectorMemory uses global embedding config only — no update needed here
  }

  updateGlobalConfig(newGlobalConfig: Config) {
    this.globalConfig = newGlobalConfig;
    const embedding = newGlobalConfig.embedding;
    const hasEmbeddingConfig = Boolean(
      embedding?.endpoint && embedding.apiKey && embedding.model,
    );

    if (!hasEmbeddingConfig) {
      this.embeddingProvider = null;
      this.vectorMemory = null;
      return;
    }

    const embedder = new EmbeddingClient(embedding!);
    this.embeddingProvider = embedder;

    if (this.vectorMemory) {
      this.vectorMemory.updateEmbedder(embedder);
    } else {
      this.vectorMemory = new VectorMemory(this.sessionDir, this.sessionId, embedder);
    }
  }

  private resolveProviderConfig(): ProviderConfig {
    if (this.config.provider) {
      return this.config.provider;
    }

    throw new Error(`No provider configuration found for session ${this.sessionId}`);
  }

  private emit(type: string, data: unknown) {
    this.onEvent?.({ type, sessionId: this.sessionId, data });
  }

  private buildRecallCues(primaryCue: string, recentLimit = 8): string[] {
    const cues: string[] = [primaryCue];

    const recentHistory = this.history
      .slice(-recentLimit)
      .map(msg => {
        const text = extractText(msg.content);
        if (!text) return '';
        if (msg.role === 'tool' && msg.name) {
          return `[tool:${msg.name}] ${text.slice(0, 300)}`;
        }
        return text.slice(0, 300);
      })
      .filter(text => text.trim().length > 0);

    cues.push(...recentHistory.slice(-4));

    const stitched = recentHistory.slice(-3).join('\n');
    if (stitched.trim().length > 0) {
      cues.push(stitched.slice(0, 800));
    }

    return cues;
  }

  private buildRecentFlowContext(limit = 6): string {
    type FlowEntry = { role: ChatMessage['role']; prefix: string; text: string; };
    const maxChars = 2000;

    const toEntry = (msg: ChatMessage): FlowEntry | null => {
      const text = extractText(msg.content).replace(/\s+/g, ' ').trim();
      if (!text) return null;
      return {
        role: msg.role,
        prefix: msg.role === 'tool' && msg.name ? `tool:${msg.name}` : msg.role,
        text: text.slice(0, 240),
      };
    };

    const toLine = (entry: FlowEntry): string => `[${entry.prefix}] ${entry.text}`;
    const joinedLength = (entries: FlowEntry[]): number => entries.map(toLine).join('\n').length;

    const selected = this.history
      .slice(-Math.max(limit * 2, limit))
      .map(toEntry)
      .filter((entry): entry is FlowEntry => entry !== null)
      .slice(-limit);

    if (!selected.some(entry => entry.role === 'user')) {
      const latestUser = [...this.history]
        .reverse()
        .find(msg => msg.role === 'user' && extractText(msg.content).trim().length > 0);

      if (latestUser) {
        const userEntry = toEntry(latestUser);
        if (userEntry) {
          if (selected.length > 0) {
            const toolIndex = selected.findIndex(entry => entry.role === 'tool');
            if (toolIndex >= 0) {
              selected.splice(toolIndex, 1);
            } else {
              selected.shift();
            }
          }
          selected.push(userEntry);
        }
      }
    }

    while (joinedLength(selected) > maxChars && selected.some(entry => entry.role === 'tool')) {
      const idx = selected.findIndex(entry => entry.role === 'tool');
      if (idx < 0) break;
      selected.splice(idx, 1);
    }

    while (joinedLength(selected) > maxChars) {
      const idx = selected.findIndex(entry => entry.role !== 'user');
      if (idx < 0) break;
      selected.splice(idx, 1);
    }

    if (joinedLength(selected) > maxChars) {
      const firstUser = selected.find(entry => entry.role === 'user');
      if (firstUser) {
        const prefix = `[${firstUser.prefix}] `;
        const available = Math.max(0, maxChars - prefix.length);
        return `${prefix}${firstUser.text.slice(0, available)}`;
      }
    }

    return selected.map(toLine).join('\n').slice(0, maxChars);
  }

  private getRecallRawTokenLimit(): number {
    return Math.max(
      MAX_RECALL_COMPRESSED_TOKENS,
      Math.min(MAX_RECALL_RAW_TOKENS, this.getEffectiveContextLimit()),
    );
  }

  private usesSameMemoryCompressionModel(): boolean {
    const configured = this.config.context?.memoryCompressionUseSameModel;
    if (typeof configured === 'boolean') return configured;

    const hasLegacyDedicatedConfig = Boolean(
      this.config.context?.memoryCompressionModel?.trim()
      || this.config.context?.memoryCompressionEndpoint?.trim()
      || this.config.context?.memoryCompressionApiKey?.trim(),
    );
    return !hasLegacyDedicatedConfig;
  }

  private getMemoryCompressionModel(): string {
    if (this.usesSameMemoryCompressionModel()) {
      return this.providerConfig.model;
    }

    const configured = this.config.context?.memoryCompressionModel?.trim();
    return configured && configured.length > 0 ? configured : this.providerConfig.model;
  }

  private getMemoryCompressionProvider(): OpenAIProvider {
    if (this.usesSameMemoryCompressionModel()) {
      return this.provider;
    }

    const endpoint = this.config.context?.memoryCompressionEndpoint?.trim() || this.providerConfig.endpoint;
    const apiKey = this.config.context?.memoryCompressionApiKey?.trim() || this.providerConfig.apiKey;
    const cacheKey = `${endpoint}::${apiKey}`;

    if (this.memoryCompressionProvider && this.memoryCompressionProviderKey === cacheKey) {
      return this.memoryCompressionProvider;
    }

    this.memoryCompressionProvider = new OpenAIProvider({
      endpoint,
      apiKey,
      model: this.providerConfig.model,
      contextWindow: this.providerConfig.contextWindow,
    });
    this.memoryCompressionProviderKey = cacheKey;
    return this.memoryCompressionProvider;
  }

  private buildRawRecalledMemories(results: RecalledEntry[], maxTokens: number): string {
    const sorted = [...results].sort((a, b) => b.combinedScore - a.combinedScore);
    const critical = sorted.slice(0, 6);
    const related = sorted.slice(6);

    let output = '';
    let currentTokens = 0;

    const append = (line: string) => {
      if (currentTokens >= maxTokens) return;
      const safeLine = line.trim();
      if (!safeLine) return;
      const withNewline = output.length === 0 ? safeLine : `\n${safeLine}`;
      const lineTokens = countTokens(withNewline);
      const remaining = maxTokens - currentTokens;

      if (lineTokens <= remaining) {
        output += withNewline;
        currentTokens += lineTokens;
        return;
      }

      // Slice the line to fit within remaining tokens
      const sliced = sliceToTokenLimit(withNewline, remaining);
      output += sliced;
      currentTokens += countTokens(sliced);
    };

    append('# CRITICAL_MEMORIES');
    for (const item of critical) {
      const ts = item.entry.metadata.timestamp.slice(0, 10);
      const role = item.entry.metadata.role ?? 'unknown';
      const text = sliceToTokenLimit(item.entry.text.replace(/\s+/g, ' ').trim(), MAX_CRITICAL_MEMORY_TOKENS);
      append(`[CRITICAL][${ts}|${role}|sim:${item.similarity.toFixed(3)}|score:${item.combinedScore.toFixed(3)}] ${text}`);
    }

    append('# RELATED_MEMORIES');
    for (const item of related) {
      const ts = item.entry.metadata.timestamp.slice(0, 10);
      const role = item.entry.metadata.role ?? 'unknown';
      const text = sliceToTokenLimit(item.entry.text.replace(/\s+/g, ' ').trim(), MAX_RELATED_MEMORY_TOKENS);
      append(`[RELATED][${ts}|${role}|sim:${item.similarity.toFixed(3)}|score:${item.combinedScore.toFixed(3)}] ${text}`);
    }

    return output;
  }

  private fallbackCompressRecalledMemories(raw: string): string {
    const lines = raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => line.startsWith('[CRITICAL]') || line.startsWith('[RELATED]'));

    const compact = lines
      .slice(0, 16)
      .map(line => line.replace(/\[(CRITICAL|RELATED)\]/g, '').replace(/\s+/g, ' ').trim())
      .join(' / ')
      .trim();

    return sliceToTokenLimit(compact, MAX_RECALL_COMPRESSED_TOKENS);
  }

  private async formatRecalledMemories(
    results: RecalledEntry[],
    cue: string,
    mode: 'turn' | 'autonomous',
    recentFlowContext?: string,
  ): Promise<string> {
    const raw = this.buildRawRecalledMemories(results, this.getRecallRawTokenLimit());
    if (!raw) return '';

    const rawTokens = countTokens(raw);
    if (rawTokens <= MAX_RECALL_COMPRESSED_TOKENS) {
      return raw;
    }

    try {
      const slicedCue = sliceToTokenLimit(cue, MAX_CUE_TOKENS);
      const slicedContext = sliceToTokenLimit(recentFlowContext || '', MAX_FLOW_CONTEXT_TOKENS);
      const compressed = await this.getMemoryCompressionProvider().summarizeMemory(
        `Current cue:\n${slicedCue}\n\nRecent conversation flow:\n${slicedContext}\n\nRecalled memory corpus:\n${raw}`,
        {
          model: this.getMemoryCompressionModel(),
          systemPrompt: `
You compress recalled memories for an AI agent.
Mode: ${mode}.
Output must be <= ${MAX_RECALL_COMPRESSED_TOKENS} tokens.
Use a highly dense telegraphic style, but you preserve chronological order and causal relationships.
Use symbols (e.g., "->", ">", "+", "@") to denote time sequence, causality, or relationships compactly instead of words (e.g., "Action A -> Result B").
Focus on core events and outcomes (Subject-Action-Result) rather than isolated nouns. Strip out adjectives, fluff, and non-essential modifiers.
Preserve critical facts exactly: numbers, dates, file paths, IDs, errors, decisions, constraints.
Plain text only. No markdown formatting.
`.trim(),
        },
      );

      const normalized = compressed.replace(/\s+/g, ' ').trim();
      return sliceToTokenLimit(normalized, MAX_RECALL_COMPRESSED_TOKENS);
    } catch (e) {
      this.log.warn('Memory compression failed; using fallback compression:', e);
      return this.fallbackCompressRecalledMemories(raw);
    }
  }

  /** Recall relevant past memories for the current turn using user cue + recent autonomous activity cues. */
  private async recallForCurrentTurn(userMessage: string): Promise<{ text: string | null; ids: string[]; }> {
    if (!this.config.tools.memory) return { text: null, ids: [] };
    if (!this.vectorMemory) return { text: null, ids: [] };
    if (this.vectorMemory.count() === 0) return { text: null, ids: [] };

    try {
      const cues = this.buildRecallCues(userMessage);
      const results = await this.vectorMemory.humanLikeRecall(cues, {
        limit: TURN_RECALL_LIMIT,
        minSimilarity: 0.34,
        salienceWeight: 0.35,
        dedupeThreshold: 0.95,
      });
      if (results.length === 0) return { text: null, ids: [] };

      this.emit('memory_update', {
        kind: 'recall',
        mode: 'turn',
        count: results.length,
        memories: results.slice(0, 4).map(item => ({
          role: item.entry.metadata.role ?? 'unknown',
          text: item.entry.text.slice(0, 160),
        })),
      });

      return {
        text: await this.formatRecalledMemories(results, userMessage, 'turn', this.buildRecentFlowContext(8)),
        ids: results.map(item => item.entry.id),
      };
    } catch (e) {
      this.log.warn('Memory recall failed:', e);
      return { text: null, ids: [] };
    }
  }

  /**
   * During long autonomous tool loops, trigger additional cue-based recall from the latest reasoning/tool outputs.
   */
  private async recallDuringAutonomousLoop(messages: ChatMessage[], recalledIds: Set<string>): Promise<ChatMessage | null> {
    if (!this.config.tools.memory) return null;
    if (!this.vectorMemory) return null;
    if (this.vectorMemory.count() === 0) return null;

    try {
      const latestContext = messages
        .slice(-6)
        .map(msg => {
          const text = extractText(msg.content);
          if (!text) return '';
          if (msg.role === 'tool' && msg.name) {
            return `[tool:${msg.name}] ${text.slice(0, 280)}`;
          }
          return text.slice(0, 280);
        })
        .filter(Boolean)
        .join('\n');

      if (!latestContext.trim()) return null;

      const cues = this.buildRecallCues(latestContext, 10);
      const recalled = await this.vectorMemory.humanLikeRecall(cues, {
        limit: AUTONOMOUS_RECALL_LIMIT,
        minSimilarity: 0.34,
        salienceWeight: 0.4,
        dedupeThreshold: 0.95,
      });

      const fresh = recalled.filter(item => !recalledIds.has(item.entry.id));
      if (fresh.length === 0) return null;

      fresh.forEach(item => recalledIds.add(item.entry.id));
      const text = await this.formatRecalledMemories(fresh, latestContext, 'autonomous', this.buildRecentFlowContext(10));
      if (!text) return null;

      this.emit('memory_update', {
        kind: 'recall',
        mode: 'autonomous',
        count: fresh.length,
        memories: fresh.slice(0, 4).map(item => ({
          role: item.entry.metadata.role ?? 'unknown',
          text: item.entry.text.slice(0, 160),
        })),
      });

      return {
        role: 'system',
        content: `<recalled_context>
Additional Recalled Memories
The following memories were autonomously recalled from recent tool-driven context:
${text}
</recalled_context>`.trim(),
      };
    } catch (e) {
      this.log.warn('Autonomous memory recall failed:', e);
      return null;
    }
  }

  private buildSystemPrompt(recalledMemories?: string | null): string {
    const identity = this.files.read('IDENTITY.md');
    const soul = this.files.read('SOUL.md');
    const user = this.files.read('USER.md');
    const memory = this.quickMemory.read();
    const tmpMemory = this.tmpMemory.read();
    const parts = [
      `You are an AI personal agent running in the meta-claw system.`,
      `Session ID: ${this.sessionId}`,
      ``,
    ];

    if (identity) {
      parts.push(`## Your Identity\n${identity}`);
    }
    if (soul) {
      parts.push(`## Your Soul\n${soul}`);
    }
    if (user) {
      parts.push(`## About the User\n${user}`);
    }
    if (memory) {
      parts.push(`## Quick Memory (MEMORY.md)\n${memory}`);
    }
    if (tmpMemory) {
      parts.push(`## Temporary Memory (TMP_MEMORY.md)\n${tmpMemory}`);
    }
    if (recalledMemories) {
      parts.push(`## Recalled Conversation History\nThe following past conversation snippets were recalled as semantically relevant to the current message. They are from earlier sessions or earlier in this session and may not be in the active context window:\n\n${recalledMemories}`);
    }

    const skillsPrompt = buildSkillsPromptText([process.cwd(), this.workspace]);
    if (skillsPrompt) {
      parts.push(skillsPrompt);
    }

    parts.push(
      ``,
      `## Workspace`,
      `Your workspace is: ${this.workspace}`,
      `Workspace restriction: ${this.config.restrictToWorkspace ? 'ENABLED (files/exec limited to workspace)' : 'DISABLED'}`,
      `Self-modification: ${this.config.allowSelfModify ? 'ENABLED' : 'DISABLED'}`,
    );

    // Add MCP tools info
    const mcpStates = this.mcpManager.getServerStates();
    const connectedServers = mcpStates.filter(s => s.status === 'connected');

    // Determine which tools are actually active to avoid hallucination
    const disabledTools = new Set(this.config.disabledTools || []);

    // We only want to list servers that actually have at least 1 enabled tool
    const activeServersInfo = [];
    for (const server of connectedServers) {
      if (!server.toolCount || server.toolCount === 0) continue;

      // We don't have the exact tool list here without fetching, but we know the prefix is mcp_{id}_
      // In a real scenario we'd count exactly, but as a heuristic, if we have disabledTools, we just
      // warn the model that SOME tools might be disabled. Let's actually fetch the exact list to be perfectly safe.
      // Wait, buildSystemPrompt is synchronous. We can't await this.mcpManager.getTools().
      // Instead, we just list the servers and add a strict note about disabled tools.
      activeServersInfo.push({
        id: server.id,
        count: server.toolCount
      });
    }

    if (activeServersInfo.length > 0) {
      parts.push(``, `## Available Tools`);
      parts.push(`You have access to a variety of tools. ONLY EXPECT THE TOOLS PROVIDED IN THE FUNCTION CALLING SCHEMA TO ACTUALLY WORK. Do not attempt to use tools if they are not defined in your tool_calls schema (some may be disabled by the user).`);
      parts.push(`You also have access to external MCP (Model Context Protocol) tools from the following servers:`);
      for (const info of activeServersInfo) {
        parts.push(`- **${info.id}** — Tool names are prefixed with \`mcp_${info.id}_\``);
      }
      parts.push(`When the user asks about functionality that matches an MCP server's capabilities, ALWAYS use the corresponding MCP tool instead of explaining how to do it manually.`);
    }

    parts.push(
      ``,
      `Use the provided tools to help the user. When you learn important facts, save them to memory.`,
      `When you need to show an image to the user, prefer standard Markdown image syntax: ![alt text](image_url).`
    );

    return parts.join('\n');
  }

  private async compressContext() {
    const threshold = this.getCompressionThreshold();
    const contextLimit = this.getEffectiveContextLimit();
    const keepRecent = this.getKeepRecentMessages(contextLimit);

    const estimated = estimateTokens(this.history);
    if (estimated >= contextLimit * threshold) {
      this.log.info(`Compressing context (estimated ${estimated} tokens, threshold ${Math.floor(contextLimit * threshold)})`);

      const toCompress = this.history.slice(0, -keepRecent);
      const toKeep = this.history.slice(-keepRecent);

      if (toCompress.length >= 5) {
        try {
          const summary = await this.provider.summarize(toCompress);
          this.history = [
            { role: 'assistant', content: `[Earlier conversation summary: ${summary}]` },
            ...toKeep,
          ];
          this.emit('system', { message: 'Context compressed', kept: toKeep.length, compressed: toCompress.length, contextLimit });
          this.log.info(`Context compressed. History reduced from ${toCompress.length + toKeep.length} to ${this.history.length} messages.`);
        } catch (e) {
          this.log.warn('Context compression failed:', e);
        }
      }
    }

    const pruned = this.pruneHistoryToContextLimit(contextLimit, keepRecent, threshold);
    if (pruned > 0) {
      this.emit('system', { message: 'Old context pruned', removed: pruned, contextLimit });
      this.log.info(`Pruned ${pruned} old messages to fit context limit ${contextLimit}.`);
    }

    if (pruned > 0 || estimated >= contextLimit * threshold) {
      this.rewriteHistory();
    }
  }

  private getEffectiveContextLimit(): number {
    const providerWindow = this.providerConfig.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    const configuredLimit = this.config.context?.maxTokens;

    if (typeof configuredLimit !== 'number' || !Number.isFinite(configuredLimit) || configuredLimit <= 0) {
      return providerWindow;
    }

    const normalized = Math.floor(configuredLimit);
    return Math.max(1024, Math.min(providerWindow, normalized));
  }

  private getCompressionThreshold(): number {
    const configured = this.config.context?.compressionThreshold;
    if (typeof configured !== 'number' || !Number.isFinite(configured)) {
      return DEFAULT_COMPRESSION_THRESHOLD;
    }
    return Math.min(0.98, Math.max(0.5, configured));
  }

  private getKeepRecentMessages(contextLimit: number): number {
    const configured = this.config.context?.keepRecentMessages;
    if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
      return Math.max(MIN_KEEP_RECENT_MESSAGES, Math.floor(configured));
    }

    if (typeof this.config.context?.maxTokens === 'number' && Number.isFinite(this.config.context.maxTokens)) {
      const adaptive = Math.round(contextLimit / 6000);
      return Math.max(8, Math.min(80, adaptive));
    }

    return DEFAULT_KEEP_RECENT_MESSAGES;
  }

  private isSummaryMessage(message: ChatMessage | undefined): boolean {
    if (!message || message.role !== 'assistant') return false;
    if (typeof message.content !== 'string') return false;
    return message.content.startsWith('[Earlier conversation summary:');
  }

  private pruneHistoryToContextLimit(contextLimit: number, keepRecent: number, threshold: number): number {
    let estimated = estimateTokens(this.history);
    if (estimated <= contextLimit) return 0;

    const pruneTarget = Math.floor(contextLimit * Math.min(0.95, Math.max(threshold, 0.72)));
    const pinnedPrefix = this.isSummaryMessage(this.history[0]) ? 1 : 0;
    const minNonPinnedToKeep = Math.max(MIN_KEEP_RECENT_MESSAGES, Math.min(keepRecent, Math.max(0, this.history.length - pinnedPrefix)));

    const beforeCount = this.history.length;

    while (estimated > pruneTarget && (this.history.length - pinnedPrefix) > minNonPinnedToKeep) {
      this.history.splice(pinnedPrefix, 1);
      estimated = estimateTokens(this.history);
    }

    return beforeCount - this.history.length;
  }

  private rewriteHistory() {
    const historyPath = path.join(this.sessionDir, 'history.jsonl');
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    const lines = this.history.map(message => JSON.stringify({ ...message, timestamp: new Date().toISOString() }));
    fs.writeFileSync(historyPath, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf-8');
  }

  private saveHistory(message: ChatMessage) {
    const historyPath = path.join(this.sessionDir, 'history.jsonl');
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    // Strip transient fields (e.g. generatedImages base64) before persisting
    const { generatedImages: _drop, ...persistable } = message as ChatMessage & { generatedImages?: string[]; };
    const line = JSON.stringify({ ...persistable, timestamp: new Date().toISOString() });
    fs.appendFileSync(historyPath, line + '\n', 'utf-8');
  }

  // Convert relative image URLs to base64 data URLs (OpenAI can't access local server)
  private resolveImageUrl(url: string): string {
    // Already a data URL or external URL — pass through
    if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    // Relative URL like /api/sessions/:id/uploads/:filename or /api/sessions/:id/images/:filename
    const uploadsMatch = url.match(/\/api\/sessions\/[^/]+\/uploads\/(.+)$/);
    const imagesMatch = url.match(/\/api\/sessions\/[^/]+\/images\/(.+)$/);

    let filePath: string | null = null;
    if (uploadsMatch) {
      filePath = path.join(this.sessionDir, 'uploads', uploadsMatch[1]);
    } else if (imagesMatch) {
      filePath = path.join(this.sessionDir, 'screenshots', imagesMatch[1]);
    }

    if (filePath && fs.existsSync(filePath)) {
      const base64 = fs.readFileSync(filePath).toString('base64');
      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      return `data:image/${mime};base64,${base64}`;
    }

    // Fallback: return as-is
    this.log.warn(`Could not resolve image URL: ${url}`);
    return url;
  }

  private detectImageTypeFromBuffer(buffer: Buffer): { ext: string; mime: string; } | null {
    if (buffer.length >= 8
      && buffer[0] === 0x89
      && buffer[1] === 0x50
      && buffer[2] === 0x4e
      && buffer[3] === 0x47
      && buffer[4] === 0x0d
      && buffer[5] === 0x0a
      && buffer[6] === 0x1a
      && buffer[7] === 0x0a) {
      return { ext: 'png', mime: 'image/png' };
    }

    if (buffer.length >= 3
      && buffer[0] === 0xff
      && buffer[1] === 0xd8
      && buffer[2] === 0xff) {
      return { ext: 'jpg', mime: 'image/jpeg' };
    }

    if (buffer.length >= 12
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return { ext: 'webp', mime: 'image/webp' };
    }

    if (buffer.length >= 6) {
      const sig6 = buffer.toString('ascii', 0, 6);
      if (sig6 === 'GIF87a' || sig6 === 'GIF89a') {
        return { ext: 'gif', mime: 'image/gif' };
      }
    }

    return null;
  }

  private parseGeneratedImageJson(raw: string): string | null {
    const trimmed = raw.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;

    try {
      const parsed = JSON.parse(trimmed) as any;
      if (typeof parsed?.b64_json === 'string') return parsed.b64_json;
      if (typeof parsed?.image_base64 === 'string') return parsed.image_base64;
      if (typeof parsed?.image === 'string') return parsed.image;

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item?.b64_json === 'string') return item.b64_json;
          if (typeof item?.image_base64 === 'string') return item.image_base64;
          if (typeof item?.image === 'string') return item.image;
        }
      }

      if (Array.isArray(parsed?.data)) {
        for (const item of parsed.data) {
          if (typeof item?.b64_json === 'string') return item.b64_json;
          if (typeof item?.image_base64 === 'string') return item.image_base64;
          if (typeof item?.image === 'string') return item.image;
          if (typeof item?.url === 'string') return item.url;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private decodeGeneratedImagePayload(rawPayload: string): { bytes: Buffer; ext: string; mime: string; } | null {
    let payload = rawPayload.trim();
    if (!payload) return null;

    const jsonPayload = this.parseGeneratedImageJson(payload);
    if (jsonPayload) payload = jsonPayload.trim();

    const dataUrlMatch = payload.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    const declaredMime = dataUrlMatch?.[1]?.toLowerCase();
    const base64Part = (dataUrlMatch ? dataUrlMatch[2] : payload).replace(/\s+/g, '');

    const tryDecode = (input: string, encoding: BufferEncoding): Buffer | null => {
      try {
        const decoded = Buffer.from(input, encoding);
        if (decoded.length === 0) return null;
        return decoded;
      } catch {
        return null;
      }
    };

    const candidates: Buffer[] = [];
    const base64Decoded = tryDecode(base64Part, 'base64');
    if (base64Decoded) candidates.push(base64Decoded);
    if (/[-_]/.test(base64Part)) {
      const base64UrlDecoded = tryDecode(base64Part, 'base64url');
      if (base64UrlDecoded) candidates.push(base64UrlDecoded);
    }

    for (const candidate of candidates) {
      const detected = this.detectImageTypeFromBuffer(candidate);
      if (detected) return { bytes: candidate, ext: detected.ext, mime: detected.mime };
    }

    if (dataUrlMatch && candidates.length > 0) {
      const fallback = candidates[0];
      const ext = declaredMime?.split('/')[1] || 'png';
      return { bytes: fallback, ext, mime: declaredMime || 'image/png' };
    }

    return null;
  }

  private toPublicImageUrl(rawUrl: string): string | null {
    if (!rawUrl) return null;
    if (rawUrl.startsWith('/api/sessions/')) return rawUrl;
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('data:') || rawUrl.startsWith('mailto:')) return rawUrl;

    const decode = (value: string): string => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };

    const toSessionRelative = (candidate: string): string | null => {
      const normalizedCandidate = path.normalize(candidate);
      const normalizedSessionDir = path.normalize(this.sessionDir);

      const rel = path.relative(normalizedSessionDir, normalizedCandidate);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return rel.replace(/\\/g, '/');
      }
      if (!rel) return '';
      return null;
    };

    const toArtifactUrl = (relPath: string): string | null => {
      const cleaned = relPath.replace(/^\/+/, '').replace(/\\/g, '/');
      if (!cleaned || cleaned.startsWith('..')) return null;
      const encoded = cleaned
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');
      if (!encoded) return null;
      return `/api/sessions/${this.sessionId}/artifacts/${encoded}`;
    };

    const trimmed = rawUrl.trim();
    let localPathCandidate: string | null = null;

    if (trimmed.startsWith('file://')) {
      try {
        localPathCandidate = fileURLToPath(trimmed);
      } catch {
        localPathCandidate = decode(trimmed.replace(/^file:\/\//i, '').replace(/^\/+([A-Za-z]:)/, '$1'));
      }
    } else if (path.isAbsolute(trimmed)) {
      localPathCandidate = trimmed;
    }

    if (localPathCandidate) {
      const sessionRelative = toSessionRelative(localPathCandidate);
      if (sessionRelative !== null) {
        return toArtifactUrl(sessionRelative);
      }

      const slashPath = decode(localPathCandidate).replace(/\\/g, '/');
      const marker = `/sessions/${this.sessionId}/`;
      const markerIndex = slashPath.lastIndexOf(marker);
      if (markerIndex >= 0) {
        const rel = slashPath.slice(markerIndex + marker.length);
        return toArtifactUrl(rel);
      }
    }

    const normalized = decode(trimmed).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
    if (!normalized || normalized.startsWith('..')) return null;

    if (normalized.startsWith(`sessions/${this.sessionId}/`)) {
      return toArtifactUrl(normalized.slice(`sessions/${this.sessionId}/`.length));
    }

    return toArtifactUrl(normalized);
  }

  private rewriteImageUrlsForUser(text: string): string {
    if (!text) return text;

    const rewrite = (url: string): string => this.toPublicImageUrl(url) ?? url;

    let updated = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, url: string) => {
      return `![${alt}](${rewrite(url)})`;
    });

    updated = updated.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
      return `[${label}](${rewrite(url)})`;
    });

    updated = updated.replace(/(^|\s)(\.?\/?(?:screenshots|uploads)\/[\w\-.\/]+(?:\?[\w=&.-]+)?)/g, (_m, lead: string, rawPath: string) => {
      const mapped = this.toPublicImageUrl(rawPath);
      return `${lead}${mapped ?? rawPath}`;
    });

    return updated;
  }

  private normalizeAssistantContent(content: string | ContentPart[] | null): string | ContentPart[] | null {
    if (!content) return content;
    if (typeof content === 'string') return this.rewriteImageUrlsForUser(content);

    return content.map((part) => {
      if (part.type === 'text') {
        return { ...part, text: this.rewriteImageUrlsForUser(part.text) };
      }
      if (part.type === 'image_url') {
        const resolved = this.toPublicImageUrl(part.image_url.url) ?? part.image_url.url;
        return {
          ...part,
          image_url: {
            ...part.image_url,
            url: resolved,
          },
        };
      }
      return part;
    });
  }

  injectNotification(content: string) {
    this.pendingNotifications.push(content);
  }

  async processMessage(
    userMessage: string,
    channelId?: string,
    imageUrls?: string[],
    options?: { noMemory?: boolean; noRecall?: boolean; systemPrompt?: string; },
  ): Promise<string> {
    this.beginProcessing();
    try {
      this.log.info(`Processing message from ${channelId ?? 'unknown'}: ${userMessage.slice(0, 80)}...`);

      // Set up abort controller for this processing run
      this.abortController = new AbortController();
      const signal = this.abortController.signal;

      // Compress context if needed
      await this.compressContext();

      // Build timestamp marker
      const now = new Date();
      const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
      const timestampMarker = `[[timestamp:${now.toLocaleString()} (${localTimeZone})]] `;

      // Build user message with optional images
      // Resolve relative URLs to base64 data URLs for LLM
      const resolvedImageUrls = imageUrls?.map(url => this.resolveImageUrl(url));
      const imageUrlReferenceText = imageUrls && imageUrls.length > 0
        ? `\n\nAttached image URLs (these are visible to the user):\n${imageUrls.map((url) => `- ${url}`).join('\n')}`
        : '';

      const userMsgContent = resolvedImageUrls && resolvedImageUrls.length > 0
        ? [
          { type: 'text' as const, text: `${timestampMarker}${userMessage}${imageUrlReferenceText}` },
          ...resolvedImageUrls.map(url => ({
            type: 'image_url' as const,
            image_url: { url, detail: 'high' as const },
          })),
        ]
        : `${timestampMarker}${userMessage}`;

      const userMsg: ChatMessage = {
        role: 'user',
        content: userMsgContent,
      };
      this.history.push(userMsg);
      this.saveHistory(userMsg);
      this.emit('message', { role: 'user', content: userMessage, channelId, imageUrls });

      // Auto-save user message to vector memory (fire-and-forget, don't block)
      if (this.config.tools.memory && this.vectorMemory && !options?.noMemory) {
        this.vectorMemory.autoAdd({ role: 'user', content: userMessage }).catch(e => {
          this.log.warn('Auto-save user message to vector failed:', e);
        });
      }

      // Recall relevant past memories BEFORE building system prompt
      const recalledMemories = options?.noRecall
        ? { text: null, ids: [] }
        : await this.recallForCurrentTurn(userMessage);
      const systemPrompt = options?.systemPrompt ?? this.buildSystemPrompt(recalledMemories.text);
      const recalledMemoryIds = new Set<string>(recalledMemories.ids);
      const toolCtx: ToolContext = {
        sessionId: this.sessionId,
        config: this.config,
        workspace: this.workspace,
        sessionDir: this.sessionDir,
        vectorMemory: this.vectorMemory ?? undefined,
        quickMemory: this.quickMemory,
        tmpMemory: this.tmpMemory,
        searchConfig: this.globalConfig?.search,
        mcpManager: this.mcpManager,
        a2aRegistry: this.a2aRegistry,
        acaManager: this.acaManager,
        commsManager: this.commsManager,
        sessionManager: this.getSessionManager ? this.getSessionManager() : undefined,
        scheduleList: this.scheduleAccess ? () => this.scheduleAccess!.list() : undefined,
        scheduleCreate: this.scheduleAccess ? (input) => this.scheduleAccess!.create(input) : undefined,
        scheduleUpdate: this.scheduleAccess ? (scheduleId, patch) => this.scheduleAccess!.update(scheduleId, patch) : undefined,
        scheduleDelete: this.scheduleAccess ? (scheduleId) => this.scheduleAccess!.remove(scheduleId) : undefined,
        clearHistory: () => this.clearHistory(),
      };
      let tools = await buildTools(toolCtx);

      // Filter out disabled tools
      if (this.config.disabledTools && this.config.disabledTools.length > 0) {
        tools = tools.filter(t => !this.config.disabledTools!.includes(t.function.name));
      }

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.history,
      ];

      let iterations = 0;
      let finalResponse = '';
      let lastStreamBuffer = '';

      while (iterations < MAX_ITERATIONS) {
        // Check if cancelled before each iteration
        if (signal.aborted) {
          this.log.info('Processing cancelled by user');
          finalResponse = lastStreamBuffer
            ? lastStreamBuffer + '\n\n[cancelled]'
            : '[cancelled]';
          break;
        }

        iterations++;

        // Process any queued notifications sent while the agent was running
        if (this.pendingNotifications.length > 0) {
          const now = new Date();
          const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
          const timestampMarker = `[[timestamp:${now.toLocaleString()} (${localTimeZone})]] `;

          for (const notification of this.pendingNotifications) {
            const userContent = `${timestampMarker}${notification}`;
            const notifMsg: ChatMessage = { role: 'user', content: userContent };
            messages.push(notifMsg);
            this.history.push(notifMsg);
            this.saveHistory(notifMsg);

            this.emit('message', { role: 'user', content: notification, channelId: 'system' });

            if (this.config.tools.memory && this.vectorMemory && !options?.noMemory) {
              this.vectorMemory.autoAdd({ role: 'user', content: notification }).catch(e => {
                this.log.warn('Auto-save notification to vector failed:', e);
              });
            }
          }
          this.pendingNotifications = [];
        }

        let streamBuffer = '';
        try {
          let response = await this.provider.chat(messages, tools, (chunk, type) => {
            if (type === 'reasoning') {
              this.emit('stream', { chunk, type: 'reasoning' });
            } else {
              streamBuffer += chunk;
              this.emit('stream', { chunk, type: 'content' });
            }
          }, signal).catch(async (err: unknown) => {
            // Retry without images if the model reports it doesn't support vision.
            // Error example: "404 No endpoints found that support image input"
            const msg = String((err as Error)?.message ?? '').toLowerCase();
            const isVisionError =
              ((err as { status?: number; })?.status === 404 || msg.includes('404')) &&
              (msg.includes('image') || msg.includes('vision') || msg.includes('endpoint'));
            if (isVisionError) {
              this.log.warn('Model does not support image input – retrying without images');
              return this.provider.chat(stripImageUrls(messages), tools, (chunk, type) => {
                if (type === 'reasoning') {
                  this.emit('stream', { chunk, type: 'reasoning' });
                } else {
                  streamBuffer += chunk;
                  this.emit('stream', { chunk, type: 'content' });
                }
              }, signal);
            }
            throw err;
          });

          if (!response.tool_calls || response.tool_calls.length === 0) {
            response = {
              ...response,
              content: this.normalizeAssistantContent(response.content),
            };
          }

          // Persist any AI-generated images (image_generation_call output) to disk
          if (response.generatedImages && response.generatedImages.length > 0) {
            const imageUrls: string[] = [];
            const genImgDir = path.join(this.sessionDir, 'generated-images');
            fs.mkdirSync(genImgDir, { recursive: true });

            for (let i = 0; i < response.generatedImages.length; i++) {
              const payload = response.generatedImages[i];
              const decoded = this.decodeGeneratedImagePayload(payload);

              if (!decoded) {
                this.log.warn(`Generated image payload could not be decoded (index=${i}, head=${payload.slice(0, 64)})`);
                continue;
              }

              const filename = `${Date.now()}_${i}.${decoded.ext}`;
              const filePath = path.join(genImgDir, filename);
              fs.writeFileSync(filePath, decoded.bytes);
              imageUrls.push(`/api/sessions/${this.sessionId}/artifacts/generated-images/${encodeURIComponent(filename)}`);
            }

            // Append Markdown image tags to response content
            const imageMarkdown = imageUrls.map(url => `![Generated Image](${url})`).join('\n\n');
            const existingText = typeof response.content === 'string' ? response.content : '';
            const { generatedImages: _dropGen, ...restResponse } = response;
            response = {
              ...restResponse,
              content: existingText ? `${existingText}\n\n${imageMarkdown}` : imageMarkdown,
            };

            this.log.info(`Saved ${imageUrls.length} generated image(s) to ${genImgDir}`);
          }

          // Check again after chat completes
          if (signal.aborted) {
            finalResponse = streamBuffer
              ? streamBuffer + '\n\n[cancelled]'
              : '[cancelled]';
            // Save partial response
            const partialMsg: ChatMessage = { role: 'assistant', content: finalResponse };
            this.history.push(partialMsg);
            this.saveHistory(partialMsg);
            break;
          }

          lastStreamBuffer = streamBuffer;
          messages.push(response);
          this.history.push(response);
          this.saveHistory(response);
          // Auto-save assistant response to vector memory
          if (this.config.tools.memory && this.vectorMemory && !options?.noMemory) {
            this.vectorMemory.autoAdd(response).catch(e => {
              this.log.warn('Auto-save assistant message to vector failed:', e);
            });
          }

          let shouldRestart = false;

          if (response.tool_calls && response.tool_calls.length > 0) {
            this.log.info(`Tool calls: ${response.tool_calls.map((t) => t.function.name).join(', ')}`);
            this.emit('tool_call', { tools: response.tool_calls.map((t) => ({ name: t.function.name, args: t.function.arguments })) });

            for (const tc of response.tool_calls) {
              // Check cancellation between tool executions
              if (signal.aborted) break;

              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(tc.function.arguments);
              } catch {
                args = {};
              }

              const result = await executeTool(tc.function.name, args, toolCtx);
              this.log.debug(`Tool ${tc.function.name}: ${result.success ? 'ok' : 'error'} - ${result.output.slice(0, 100)}`);
              this.emit('tool_result', {
                tool: tc.function.name,
                success: result.success,
                output: result.output.slice(0, 1000),
                ...(result.imageUrl && { imageUrl: result.imageUrl }),
              });

              if (result.output === "__META_CLAW_RESTART__") {
                const toolMsg: ChatMessage = {
                  role: 'tool',
                  tool_call_id: tc.id,
                  name: tc.function.name,
                  content: "Server restarting... The system will reboot and you will resume this task.",
                };
                messages.push(toolMsg);
                this.history.push(toolMsg);
                this.saveHistory(toolMsg);

                // Drop resume marker
                const resumePath = path.join(this.sessionDir, '.resume');
                fs.writeFileSync(resumePath, 'resume', 'utf-8');

                // Set final response and break
                finalResponse = "Rebooting system... Please wait.";
                shouldRestart = true;
                process.emit('meta-claw-restart' as any);
                break;
              }

              const toolText = this.rewriteImageUrlsForUser(result.success ? result.output : `Error: ${result.output}`);
              const toolTextWithImageUrl = result.imageUrl
                ? `${toolText}\n\nImage URL: ${result.imageUrl}\nIf you show this to the user, use Markdown: ![image](${result.imageUrl})`
                : toolText;
              const toolMsg: ChatMessage = {
                role: 'tool',
                tool_call_id: tc.id,
                name: tc.function.name,
                content: result.image
                  ? [
                    { type: 'text' as const, text: toolTextWithImageUrl },
                    { type: 'image_url' as const, image_url: { url: result.image, detail: 'high' as const } },
                  ]
                  : toolTextWithImageUrl,
              };
              messages.push(toolMsg);
              this.history.push(toolMsg);
              this.saveHistory(toolMsg);
              // Auto-save tool result to vector memory
              if (this.config.tools.memory && this.vectorMemory && !options?.noMemory) {
                this.vectorMemory.autoAdd(toolMsg).catch(e => {
                  this.log.warn('Auto-save tool message to vector failed:', e);
                });
              }
            }

            // If cancelled during tool execution, save and break
            if (signal.aborted) {
              finalResponse = '[cancelled]';
              const cancelledMsg: ChatMessage = { role: 'assistant', content: finalResponse };
              this.history.push(cancelledMsg);
              this.saveHistory(cancelledMsg);
              break;
            }

            const autonomousRecall = await this.recallDuringAutonomousLoop(messages, recalledMemoryIds);
            if (autonomousRecall) {
              messages.splice(messages.length - 1, 0, autonomousRecall);
            }
          } else {
            finalResponse = extractText(response.content);
            break;
          }

          if (shouldRestart) {
            break;
          }
        } catch (e: any) {
          if (signal.aborted || e?.name === 'AbortError') {
            finalResponse = streamBuffer
              ? streamBuffer + '\n\n[cancelled]'
              : '[cancelled]';
            const partialMsg: ChatMessage = { role: 'assistant', content: finalResponse };
            this.history.push(partialMsg);
            this.saveHistory(partialMsg);
            break;
          }
          throw e;
        }
      }

      if (!finalResponse) {
        finalResponse = 'I reached the maximum number of tool iterations. Please try again.';
        const assistantMsg: ChatMessage = { role: 'assistant', content: finalResponse };
        this.history.push(assistantMsg);
        this.saveHistory(assistantMsg);
      }

      this.abortController = null;
      this.emit('message', {
        role: 'assistant',
        content: finalResponse,
        reasoning: this.history[this.history.length - 1]?.reasoning
      });

      return finalResponse;
    } finally {
      this.endProcessing();
    }
  }

  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  clearVectorMemory(): void {
    this.vectorMemory?.clear();
    this.log.info('Vector memory cleared');
  }

  clearHistory() {
    this.history = [];
    const historyPath = path.join(this.sessionDir, 'history.jsonl');
    if (fs.existsSync(historyPath)) {
      try {
        fs.unlinkSync(historyPath);
        this.log.info('History file cleared');
      } catch (e) {
        this.log.error('Failed to delete history file:', e);
      }
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getWorkspace(): string {
    return this.workspace;
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  async getAvailableTools(): Promise<ToolDefinition[]> {
    const toolCtx: ToolContext = {
      sessionId: this.sessionId,
      config: this.config,
      workspace: this.workspace,
      sessionDir: this.sessionDir,
      vectorMemory: this.vectorMemory ?? undefined,
      quickMemory: this.quickMemory,
      tmpMemory: this.tmpMemory,
      searchConfig: this.globalConfig?.search,
      mcpManager: this.mcpManager,
      a2aRegistry: this.a2aRegistry,
      acaManager: this.acaManager,
      commsManager: this.commsManager,
      sessionManager: this.getSessionManager ? this.getSessionManager() : undefined,
      scheduleList: this.scheduleAccess ? () => this.scheduleAccess!.list() : undefined,
      scheduleCreate: this.scheduleAccess ? (input) => this.scheduleAccess!.create(input) : undefined,
      scheduleUpdate: this.scheduleAccess ? (scheduleId, patch) => this.scheduleAccess!.update(scheduleId, patch) : undefined,
      scheduleDelete: this.scheduleAccess ? (scheduleId) => this.scheduleAccess!.remove(scheduleId) : undefined,
      clearHistory: () => this.clearHistory(),
    };
    return buildTools(toolCtx);
  }
}
