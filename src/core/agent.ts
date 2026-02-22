import fs from 'fs';
import path from 'path';
import type { ChatMessage, SessionConfig, Config, ProviderConfig, ContentPart, ContentPartText } from '../types.js';
import { OpenAIProvider } from '../providers/openai.js';
import { VectorMemory } from '../memory/vector.js';
import { QuickMemory, WorkspaceFiles } from '../memory/quick.js';
import { buildTools, executeTool, type ToolContext } from '../tools/index.js';
import { McpClientManager } from '../tools/mcp-client.js';
import { buildSkillsPromptText } from './skills.js';
import { createLogger } from '../logger.js';

const MAX_ITERATIONS = 20;
const RESTART_CODE = 75;

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

export class Agent {
  private sessionId: string;
  private config: SessionConfig;
  private workspace: string;
  private provider: OpenAIProvider;
  private providerConfig: ProviderConfig;
  private quickMemory: QuickMemory;
  private tmpMemory: QuickMemory;
  private vectorMemory: VectorMemory;
  private mcpManager: McpClientManager;
  private files: WorkspaceFiles;
  private history: ChatMessage[] = [];
  private log: ReturnType<typeof createLogger>;
  private onEvent?: EventCallback;
  private globalConfig?: Config;
  private abortController: AbortController | null = null;

  constructor(
    sessionId: string,
    config: SessionConfig,
    workspace: string,
    onEvent?: EventCallback,
    globalConfig?: Config
  ) {
    this.sessionId = sessionId;
    this.config = config;
    this.workspace = workspace;
    
    // プロバイダー設定を解決
    this.providerConfig = this.resolveProviderConfig();
    this.provider = new OpenAIProvider(this.providerConfig);
    this.quickMemory = new QuickMemory(workspace);
    this.tmpMemory = new QuickMemory(workspace, 'TMP_MEMORY.md');
    this.vectorMemory = new VectorMemory(workspace, sessionId, this.provider);
    this.mcpManager = new McpClientManager();
    this.files = new WorkspaceFiles(workspace);
    this.log = createLogger(`agent:${sessionId}`);
    this.onEvent = onEvent;
    this.globalConfig = globalConfig;
    
    this.loadHistory();
    this.initMcpServers();
  }

  private loadHistory() {
    const historyPath = path.join(this.workspace, 'history.jsonl');
    if (fs.existsSync(historyPath)) {
      try {
        const content = fs.readFileSync(historyPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        this.history = lines.map(l => {
          const parsed = JSON.parse(l);
          return {
            role: parsed.role,
            content: parsed.content,
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
  }

  cancelProcessing() {
    if (this.abortController) {
      this.log.info('Cancelling ongoing AI processing');
      this.abortController.abort();
      this.abortController = null;
    }
  }

  getMcpManager() {
    return this.mcpManager;
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

  private buildSystemPrompt(): string {
    const identity = this.files.read('IDENTITY.md');
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
    if (user) {
      parts.push(`## About the User\n${user}`);
    }
    if (memory) {
      parts.push(`## Quick Memory (MEMORY.md)\n${memory}`);
    }
    if (tmpMemory) {
      parts.push(`## Temporary Memory (TMP_MEMORY.md)\n${tmpMemory}`);
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
    if (connectedServers.length > 0) {
      parts.push(``, `## MCP Tools`);
      parts.push(`You have access to external MCP (Model Context Protocol) tools from the following servers. USE THESE TOOLS when relevant — they are real, connected tools you can call directly:`);
      for (const server of connectedServers) {
        parts.push(`- **${server.id}** (${server.toolCount ?? 0} tools available) — Tool names are prefixed with \`mcp_${server.id}_\``);
      }
      parts.push(`When the user asks about functionality that matches an MCP server's capabilities, ALWAYS use the corresponding MCP tool instead of explaining how to do it manually.`);
    }

    parts.push(
      ``,
      `Use the provided tools to help the user. When you learn important facts, save them to memory.`
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
    const historyPath = path.join(this.workspace, 'history.jsonl');
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
      filePath = path.join(this.workspace, 'uploads', uploadsMatch[1]);
    } else if (imagesMatch) {
      filePath = path.join(this.workspace, 'screenshots', imagesMatch[1]);
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

  async processMessage(userMessage: string, channelId?: string, imageUrls?: string[]): Promise<string> {
    this.log.info(`Processing message from ${channelId ?? 'unknown'}: ${userMessage.slice(0, 80)}...`);

    // Set up abort controller for this processing run
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Compress context if needed
    await this.compressContext();

    // Build user message with optional images
    // Resolve relative URLs to base64 data URLs for LLM
    const resolvedImageUrls = imageUrls?.map(url => this.resolveImageUrl(url));
    const userMsg: ChatMessage = {
      role: 'user',
      content: resolvedImageUrls && resolvedImageUrls.length > 0
        ? [
            { type: 'text' as const, text: userMessage },
            ...resolvedImageUrls.map(url => ({
              type: 'image_url' as const,
              image_url: { url, detail: 'high' as const },
            })),
          ]
        : userMessage,
    };
    this.history.push(userMsg);
    this.saveHistory(userMsg);
    this.emit('message', { role: 'user', content: userMessage, channelId, imageUrls });

    const systemPrompt = this.buildSystemPrompt();
    const toolCtx: ToolContext = {
      sessionId: this.sessionId,
      config: this.config,
      workspace: this.workspace,
      vectorMemory: this.vectorMemory,
      quickMemory: this.quickMemory,
      tmpMemory: this.tmpMemory,
      searchConfig: this.globalConfig?.search,
      mcpManager: this.mcpManager,
    };
    const tools = await buildTools(toolCtx);

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
        const response = await this.provider.chat(messages, tools, (chunk) => {
          streamBuffer += chunk;
          this.emit('stream', { chunk });
        }, signal);

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
            this.emit('tool_result', { tool: tc.function.name, success: result.success, output: result.output.slice(0, 500) });

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
              const resumePath = path.join(this.workspace, '.resume');
              fs.writeFileSync(resumePath, 'resume', 'utf-8');

              // Set final response and break
              finalResponse = "Rebooting system... Please wait.";
              shouldRestart = true;
              process.emit('meta-claw-restart' as any);
              break;
            }

            const toolMsg: ChatMessage = {
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.function.name,
              content: result.image
                ? [
                    { type: 'text' as const, text: result.success ? result.output : `Error: ${result.output}` },
                    { type: 'image_url' as const, image_url: { url: result.image, detail: 'high' as const } },
                  ]
                : (result.success ? result.output : `Error: ${result.output}`),
            };
            messages.push(toolMsg);
            this.history.push(toolMsg);
            this.saveHistory(toolMsg);
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
    this.emit('message', { role: 'assistant', content: finalResponse });

    return finalResponse;
  }

  async runHeartbeat(): Promise<string | null> {
    const heartbeatContent = this.files.read('HEARTBEAT.md');
    if (!heartbeatContent) return null;

    const { activeHours } = this.config.heartbeat;
    if (activeHours) {
      const hour = new Date().getHours();
      if (hour < activeHours.start || hour >= activeHours.end) return null;
    }

    const prompt = `[HEARTBEAT] Review your HEARTBEAT.md instructions and check if there's anything you need to do or report. If nothing needs attention, respond with exactly: HEARTBEAT_OK\n\n${heartbeatContent}`;

    try {
      const response = await this.processMessage(prompt, 'heartbeat');
      this.emit('heartbeat', { response });
      if (response.trim() === 'HEARTBEAT_OK') return null;
      return response;
    } catch (e) {
      this.log.error('Heartbeat error:', e);
      return null;
    }
  }

  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  clearHistory() {
    this.history = [];
    const historyPath = path.join(this.workspace, 'history.jsonl');
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
}