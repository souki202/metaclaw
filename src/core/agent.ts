import fs from 'fs';
import path from 'path';
import type { ChatMessage, SessionConfig, ToolCall } from '../types.js';
import { OpenAIProvider } from '../providers/openai.js';
import { VectorMemory } from '../memory/vector.js';
import { QuickMemory, WorkspaceFiles } from '../memory/quick.js';
import { buildTools, executeTool, type ToolContext } from '../tools/index.js';
import { createLogger } from '../logger.js';

const MAX_ITERATIONS = 20;
const RESTART_CODE = 75;

// Rough token estimation: ~4 chars per token
function estimateTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : '';
    return sum + Math.ceil(content.length / 4) + 10;
  }, 0);
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
  private quickMemory: QuickMemory;
  private vectorMemory: VectorMemory;
  private files: WorkspaceFiles;
  private history: ChatMessage[] = [];
  private log: ReturnType<typeof createLogger>;
  private onEvent?: EventCallback;

  constructor(
    sessionId: string,
    config: SessionConfig,
    workspace: string,
    onEvent?: EventCallback
  ) {
    this.sessionId = sessionId;
    this.config = config;
    this.workspace = workspace;
    this.provider = new OpenAIProvider(config.provider);
    this.quickMemory = new QuickMemory(workspace);
    this.vectorMemory = new VectorMemory(workspace, sessionId, this.provider);
    this.files = new WorkspaceFiles(workspace);
    this.log = createLogger(`agent:${sessionId}`);
    this.onEvent = onEvent;
  }

  private emit(type: string, data: unknown) {
    this.onEvent?.({ type, sessionId: this.sessionId, data });
  }

  private buildSystemPrompt(): string {
    const identity = this.files.read('IDENTITY.md');
    const user = this.files.read('USER.md');
    const memory = this.quickMemory.read();

    const parts = [
      `You are an AI personal agent running in the mini-claw system.`,
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

    parts.push(
      ``,
      `## Workspace`,
      `Your workspace is: ${this.workspace}`,
      `Workspace restriction: ${this.config.restrictToWorkspace ? 'ENABLED (files/exec limited to workspace)' : 'DISABLED'}`,
      `Self-modification: ${this.config.allowSelfModify ? 'ENABLED' : 'DISABLED'}`,
      ``,
      `Use the provided tools to help the user. When you learn important facts, save them to memory.`
    );

    return parts.join('\n');
  }

  private async compressContext() {
    const threshold = this.config.context?.compressionThreshold ?? 0.8;
    const contextWindow = this.config.provider.contextWindow ?? 128000;
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

  private saveHistory() {
    const historyPath = path.join(this.workspace, 'history.jsonl');
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    // Append last two messages (user + assistant)
    const recent = this.history.slice(-2);
    const lines = recent.map((m) => JSON.stringify({ ...m, timestamp: new Date().toISOString() }));
    fs.appendFileSync(historyPath, lines.join('\n') + '\n', 'utf-8');
  }

  async processMessage(userMessage: string, channelId?: string): Promise<string> {
    this.log.info(`Processing message from ${channelId ?? 'unknown'}: ${userMessage.slice(0, 80)}...`);

    // Compress context if needed
    await this.compressContext();

    const userMsg: ChatMessage = { role: 'user', content: userMessage };
    this.history.push(userMsg);
    this.emit('message', { role: 'user', content: userMessage, channelId });

    const systemPrompt = this.buildSystemPrompt();
    const toolCtx: ToolContext = {
      sessionId: this.sessionId,
      config: this.config,
      workspace: this.workspace,
      vectorMemory: this.vectorMemory,
      quickMemory: this.quickMemory,
    };
    const tools = buildTools(toolCtx);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...this.history,
    ];

    let iterations = 0;
    let finalResponse = '';

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      let streamBuffer = '';
      const response = await this.provider.chat(messages, tools, (chunk) => {
        streamBuffer += chunk;
      });

      messages.push(response);

      if (response.tool_calls && response.tool_calls.length > 0) {
        this.log.info(`Tool calls: ${response.tool_calls.map((t) => t.function.name).join(', ')}`);
        this.emit('tool_call', { tools: response.tool_calls.map((t) => ({ name: t.function.name, args: t.function.arguments })) });

        for (const tc of response.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }

          const result = await executeTool(tc.function.name, args, toolCtx);
          this.log.debug(`Tool ${tc.function.name}: ${result.success ? 'ok' : 'error'} - ${result.output.slice(0, 100)}`);
          this.emit('tool_result', { tool: tc.function.name, success: result.success, output: result.output.slice(0, 500) });

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: result.success ? result.output : `Error: ${result.output}`,
          });
        }
      } else {
        finalResponse = response.content ?? '';
        break;
      }
    }

    if (!finalResponse) {
      finalResponse = 'I reached the maximum number of tool iterations. Please try again.';
    }

    const assistantMsg: ChatMessage = { role: 'assistant', content: finalResponse };
    this.history.push(assistantMsg);
    this.emit('message', { role: 'assistant', content: finalResponse });
    this.saveHistory();

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
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getWorkspace(): string {
    return this.workspace;
  }
}
