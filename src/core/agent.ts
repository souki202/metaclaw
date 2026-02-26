import fs from 'fs';
import path from 'path';
import type { ChatMessage, SessionConfig, Config, ProviderConfig, ContentPart, ContentPartText, ToolDefinition, ScheduleUpsertInput, SessionSchedule } from '../types.js';
import { OpenAIProvider } from '../providers/openai.js';
import { VectorMemory } from '../memory/vector.js';
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

const MAX_ITERATIONS = 100;
const RESTART_CODE = 75;

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

// Rough token estimation: ~4 chars per token, ~765 tokens per high-detail image
function estimateTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => {
    if (!m.content) return sum + 10;
    if (typeof m.content === 'string') {
      return sum + Math.ceil(m.content.length / 4) + 10;
    }
    // Multi-part content
    let tokens = 10;
    for (const part of m.content) {
      if (part.type === 'text') tokens += Math.ceil(part.text.length / 4);
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
  private providerConfig: ProviderConfig;
  private embeddingProvider: EmbeddingProvider;
  private usingGlobalEmbedding: boolean;
  private quickMemory: QuickMemory;
  private tmpMemory: QuickMemory;
  private vectorMemory: VectorMemory;
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

    // Embedding provider: use global config if set, otherwise fall back to session provider
    if (globalConfig?.embedding?.endpoint && globalConfig.embedding.apiKey && globalConfig.embedding.model) {
      this.embeddingProvider = new EmbeddingClient(globalConfig.embedding);
      this.usingGlobalEmbedding = true;
    } else {
      this.embeddingProvider = this.provider;
      this.usingGlobalEmbedding = false;
    }

    this.quickMemory = new QuickMemory(sessionDir);
    this.tmpMemory = new QuickMemory(sessionDir, 'TMP_MEMORY.md');
    this.vectorMemory = new VectorMemory(sessionDir, sessionId, this.embeddingProvider);
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
    // Only update VectorMemory embedder if we're using the session provider as fallback
    if (!this.usingGlobalEmbedding) {
      this.vectorMemory.updateEmbedder(this.provider);
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

  /** Recall relevant past memories for the current user message, formatted for injection into system prompt. */
  private async recallForCurrentTurn(userMessage: string): Promise<string | null> {
    if (!this.config.tools.memory) return null;
    if (this.vectorMemory.count() === 0) return null;

    try {
      const results = await this.vectorMemory.smartRecall(userMessage, { limit: 6, minSimilarity: 0.55 });
      if (results.length === 0) return null;

      const lines = results.map(r => {
        const ts = r.entry.metadata.timestamp.slice(0, 10);
        const role = r.entry.metadata.role ?? 'unknown';
        // Truncate each snippet to 400 chars for readability
        const text = r.entry.text.length > 400 ? r.entry.text.slice(0, 397) + '...' : r.entry.text;
        return `[${ts} | ${role}]: ${text}`;
      });

      return lines.join('\n\n');
    } catch (e) {
      this.log.warn('Memory recall failed:', e);
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
    const threshold = this.config.context?.compressionThreshold ?? 0.8;
    const contextWindow = this.providerConfig.contextWindow ?? 128000;
    const keepRecent = this.config.context?.keepRecentMessages ?? 20;

    const estimated = estimateTokens(this.history);
    if (estimated < contextWindow * threshold) return;

    this.log.info(`Compressing context (estimated ${estimated} tokens, threshold ${Math.floor(contextWindow * threshold)})`);

    const toCompress = this.history.slice(0, -keepRecent);
    const toKeep = this.history.slice(-keepRecent);

    if (toCompress.length < 5) return;

    try {
      const summary = await this.provider.summarize(toCompress);
      this.history = [
        { role: 'assistant', content: `[Earlier conversation summary: ${summary}]` },
        ...toKeep,
      ];
      this.emit('system', { message: 'Context compressed', kept: toKeep.length, compressed: toCompress.length });
      this.log.info(`Context compressed. History reduced from ${toCompress.length + toKeep.length} to ${this.history.length} messages.`);
    } catch (e) {
      this.log.warn('Context compression failed:', e);
    }
  }

  private saveHistory(message: ChatMessage) {
    const historyPath = path.join(this.sessionDir, 'history.jsonl');
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    const line = JSON.stringify({ ...message, timestamp: new Date().toISOString() });
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

  private toPublicImageUrl(rawUrl: string): string | null {
    if (!rawUrl) return null;
    if (rawUrl.startsWith('/api/sessions/')) return rawUrl;
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('data:')) return rawUrl;

    const normalized = rawUrl.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');

    const screenshotsRel = normalized.match(/^screenshots\/(.+)$/);
    if (screenshotsRel) {
      const filename = path.basename(screenshotsRel[1]);
      return `/api/sessions/${this.sessionId}/images/${filename}`;
    }

    const uploadsRel = normalized.match(/^uploads\/(.+)$/);
    if (uploadsRel) {
      const filename = path.basename(uploadsRel[1]);
      return `/api/sessions/${this.sessionId}/uploads/${filename}`;
    }

    const screenshotsAbs = normalized.match(/[\/]screenshots[\/](.+)$/);
    if (screenshotsAbs) {
      const filename = path.basename(screenshotsAbs[1]);
      return `/api/sessions/${this.sessionId}/images/${filename}`;
    }

    const uploadsAbs = normalized.match(/[\/]uploads[\/](.+)$/);
    if (uploadsAbs) {
      const filename = path.basename(uploadsAbs[1]);
      return `/api/sessions/${this.sessionId}/uploads/${filename}`;
    }

    return null;
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

  async processMessage(userMessage: string, channelId?: string, imageUrls?: string[]): Promise<string> {
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
    if (this.config.tools.memory) {
      this.vectorMemory.autoAdd({ role: 'user', content: userMessage }).catch(e => {
        this.log.warn('Auto-save user message to vector failed:', e);
      });
    }

    // Recall relevant past memories BEFORE building system prompt
    const recalledMemories = await this.recallForCurrentTurn(userMessage);
    const systemPrompt = this.buildSystemPrompt(recalledMemories);
    const toolCtx: ToolContext = {
      sessionId: this.sessionId,
      config: this.config,
      workspace: this.workspace,
      sessionDir: this.sessionDir,
      vectorMemory: this.vectorMemory,
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
            ((err as { status?: number })?.status === 404 || msg.includes('404')) &&
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
        if (this.config.tools.memory) {
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
            if (this.config.tools.memory) {
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
      vectorMemory: this.vectorMemory,
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
