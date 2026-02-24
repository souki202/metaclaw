import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig, ToolDefinition, ToolResult, SearchConfig } from '../types.js';
import { createLogger } from '../logger.js';

const log = createLogger('mcp');

export type McpServerStatus = 'connecting' | 'connected' | 'error' | 'stopped';

export interface McpServerState {
  id: string;
  config: McpServerConfig;
  status: McpServerStatus;
  error?: string;
  toolCount?: number;
}

interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  config: McpServerConfig;
  status: McpServerStatus;
  error?: string;
  toolCount?: number;
}

interface BuiltinServer {
  config: McpServerConfig;
  status: McpServerStatus;
  error?: string;
  toolCount?: number;
  tools: ToolDefinition[];
  handler: (toolName: string, args: Record<string, unknown>) => Promise<ToolResult>;
}

export class McpClientManager {
  static createOpenAIClient(apiKey: string, baseURL: string): OpenAI {
    return new OpenAI({
      apiKey,
      baseURL,
    });
  }

  private connections = new Map<string, McpConnection>();
  private builtinServers = new Map<string, BuiltinServer>();
  private searchConfig?: SearchConfig;
  private workspace?: string;

  constructor(searchConfig?: SearchConfig, workspace?: string) {
    this.searchConfig = searchConfig;
    this.workspace = workspace;
  }

  async startServer(id: string, config: McpServerConfig): Promise<void> {
    if ((config.type ?? 'command') === 'builtin-consult') {
      await this.startBuiltinConsultServer(id, config);
      return;
    }

    if (!config.command) {
      const errMsg = 'Command is required for MCP process servers.';
      log.error(`Failed to start MCP server "${id}": ${errMsg}`);
      this.connections.set(id, {
        client: null!,
        transport: null!,
        config,
        status: 'error',
        error: errMsg,
      });
      return;
    }

    if (this.connections.has(id)) {
      const existing = this.connections.get(id)!;
      if (existing.status === 'connected' || existing.status === 'connecting') {
        log.info(`MCP server "${id}" already running, skipping.`);
        return;
      }
      // If it was in error state, clean it up first
      try { await existing.client.close(); } catch { /* ignore */ }
      this.connections.delete(id);
    }

    log.info(`Starting MCP server "${id}": ${config.command} ${(config.args || []).join(' ')}`);

    const placeholder: McpConnection = {
      client: null!,
      transport: null!,
      config,
      status: 'connecting',
    };
    this.connections.set(id, placeholder);

    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
      });

      const client = new Client({
        name: `meta-claw-${id}`,
        version: '1.0.0',
      });

      await client.connect(transport);

      // Fetch tool count right away
      let toolCount = 0;
      try {
        const result = await client.listTools();
        toolCount = (result.tools || []).length;
      } catch { /* ignore */ }

      this.connections.set(id, { client, transport, config, status: 'connected', toolCount });
      log.info(`MCP server "${id}" connected successfully (${toolCount} tools).`);
    } catch (e) {
      const errMsg = (e as Error).message || String(e);
      log.error(`Failed to start MCP server "${id}":`, errMsg);
      this.connections.set(id, {
        ...placeholder,
        status: 'error',
        error: errMsg,
      });
      // Don't throw — store the error for UI consumption
    }
  }

  async stopServer(id: string): Promise<void> {
    const builtin = this.builtinServers.get(id);
    if (builtin) {
      log.info(`Stopping built-in MCP server "${id}"...`);
      this.builtinServers.delete(id);
      return;
    }

    const conn = this.connections.get(id);
    if (!conn) return;

    log.info(`Stopping MCP server "${id}"...`);
    try {
      if (conn.client) await conn.client.close();
    } catch (e) {
      log.warn(`Error closing MCP server "${id}":`, e);
    }
    this.connections.delete(id);
  }

  async stopAll(): Promise<void> {
    const ids = this.getServerIds();
    for (const id of ids) {
      await this.stopServer(id);
    }
  }

  async restartServer(id: string, config: McpServerConfig): Promise<void> {
    await this.stopServer(id);
    await this.startServer(id, config);
  }

  getServerStates(): McpServerState[] {
    const states: McpServerState[] = [];
    for (const [id, server] of this.builtinServers) {
      states.push({
        id,
        config: server.config,
        status: server.status,
        error: server.error,
        toolCount: server.toolCount,
      });
    }
    for (const [id, conn] of this.connections) {
      states.push({
        id,
        config: conn.config,
        status: conn.status,
        error: conn.error,
        toolCount: conn.toolCount,
      });
    }
    return states;
  }

  async getTools(id: string): Promise<ToolDefinition[]> {
    const builtin = this.builtinServers.get(id);
    if (builtin) {
      if (builtin.status !== 'connected') return [];
      return builtin.tools;
    }

    const conn = this.connections.get(id);
    if (!conn || conn.status !== 'connected') return [];

    try {
      const result = await conn.client.listTools();
      return (result.tools || []).map((tool) => ({
        type: 'function' as const,
        function: {
          name: `mcp_${id}_${tool.name}`,
          description: tool.description || `MCP tool from ${id}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
        },
      }));
    } catch (e) {
      log.error(`Failed to list tools from MCP server "${id}":`, e);
      return [];
    }
  }

  async getAllTools(): Promise<ToolDefinition[]> {
    const all: ToolDefinition[] = [];
    for (const id of this.getServerIds()) {
      const tools = await this.getTools(id);
      all.push(...tools);
    }
    return all;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const builtin = this.builtinServers.get(serverId);
    if (builtin) {
      if (builtin.status !== 'connected') {
        return { success: false, output: `MCP server "${serverId}" is not connected (status: ${builtin.status}).` };
      }
      return builtin.handler(toolName, args);
    }

    const conn = this.connections.get(serverId);
    if (!conn) {
      return { success: false, output: `MCP server "${serverId}" not found or not running.` };
    }
    if (conn.status !== 'connected') {
      return { success: false, output: `MCP server "${serverId}" is not connected (status: ${conn.status}).` };
    }

    try {
      const result = await conn.client.callTool({ name: toolName, arguments: args });
      const output = (result.content as Array<{ type: string; text?: string }>)
        .map((c) => c.text || '')
        .join('\n');
      return { success: !result.isError, output };
    } catch (e) {
      return { success: false, output: `MCP tool error: ${(e as Error).message}` };
    }
  }

  /**
   * Parse a prefixed tool name like "mcp_serverId_toolName" and route the call.
   */
  async routeToolCall(prefixedName: string, args: Record<string, unknown>): Promise<ToolResult | null> {
    if (!prefixedName.startsWith('mcp_')) return null;

    const rest = prefixedName.slice(4); // remove "mcp_"
    // find the matching server id
    for (const id of this.getServerIds()) {
      if (rest.startsWith(id + '_')) {
        const toolName = rest.slice(id.length + 1);
        return this.callTool(id, toolName, args);
      }
    }
    return { success: false, output: `Unknown MCP tool: ${prefixedName}` };
  }

  private async startBuiltinConsultServer(id: string, config: McpServerConfig): Promise<void> {
    const existing = this.builtinServers.get(id);
    if (existing?.status === 'connected') {
      log.info(`Built-in MCP server "${id}" already running, skipping.`);
      return;
    }
    if (existing) {
      this.builtinServers.delete(id);
    }

    const normalizedConfig: McpServerConfig = { ...config, type: 'builtin-consult' };
    const toolBaseName = 'consult_ai';
    const tools: ToolDefinition[] = [{
      type: 'function',
      function: {
        name: `mcp_${id}_${toolBaseName}`,
        description: 'Consult a "Senior AI Advisor" for logic review, refinement, or alternative perspectives. returns Analysis, Improvements, and Risks.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Prompt to send to the advisor AI.' },
            image_url: { type: 'string', description: 'Optional image URL or local file path.' },
          },
          required: ['prompt'],
        },
      },
    }];

    if (!normalizedConfig.endpointUrl || !normalizedConfig.apiKey) {
      const error = !normalizedConfig.endpointUrl ? 'endpointUrl is required' : 'apiKey is required';
      this.builtinServers.set(id, {
        config: normalizedConfig,
        status: 'error',
        error,
        toolCount: tools.length,
        tools,
        handler: async () => ({ success: false, output: `Built-in MCP server "${id}" is not configured: ${error}` }),
      });
      log.error(`Failed to start built-in MCP server "${id}": ${error}`);
      return;
    }

    const handler = async (toolName: string, args: Record<string, unknown>): Promise<ToolResult> => {
      if (toolName !== toolBaseName && toolName !== `mcp_${id}_${toolBaseName}`) {
        return { success: false, output: `Unknown tool "${toolName}" for server "${id}".` };
      }

      const prompt = typeof args.prompt === 'string' ? args.prompt : '';
      if (!prompt.trim()) {
        return { success: false, output: 'Prompt is required.' };
      }

      const imageUrl = typeof args.image_url === 'string' ? args.image_url : undefined;
      let imagePayload: string | undefined;
      if (imageUrl) {
        try {
          imagePayload = await this.prepareImagePayload(imageUrl);
        } catch (e) {
          return { success: false, output: (e as Error).message };
        }
      }

      const systemPrompt = `
You are a "Senior AI Advisor" designed to receive consultations from another AI model to improve the quality of its reasoning and outputs.
The input text will be a draft response or a stalled thought process generated by the consulting AI.

Strictly adhere to the following constraints and guidelines:

[Constraints]
1. Strict Single-Turn Execution: There is no conversation history in this system. Even if the input lacks information, NEVER ask clarifying questions. If context is missing, explicitly state your assumptions and output the best possible response.
2. AI-to-AI Communication: Omit all greetings, pleasantries, and introductory remarks. Begin your analysis immediately.
3. Objectivity & Critical Thinking: Do not simply agree with the consulting AI. Rigorously point out logical leaps, potential factual errors, and blind spots.

[Output Format]
Structure your response using the following Markdown format:

### 1. Analysis
Briefly analyze the strengths, weaknesses, and logical consistency of the input.

### 2. Improvements & Knowledge
Provide concrete suggestions for refinement or additional specialized knowledge.

### 3. Risks & Edge Cases
Identify potential risks or edge cases.
`.trim();

      if (!normalizedConfig.endpointUrl) {
        throw new Error('endpointUrl is required for consult-ai');
      }

      const client = McpClientManager.createOpenAIClient(normalizedConfig.apiKey, normalizedConfig.endpointUrl);

      try {
        const response = await client.responses.create({
          model: normalizedConfig.model || 'gpt-4o',
          input: [
            {
              role: 'system',
              content: [{ type: 'input_text', text: systemPrompt }],
            },
            {
              role: 'user',
              content: imagePayload
                ? [
                    { type: 'input_text', text: prompt },
                    { type: 'input_image', image_url: imagePayload, detail: 'auto' },
                  ]
                : [{ type: 'input_text', text: prompt }],
            },
          ],
        });

        // Extract text from response
        const texts: string[] = [];
        for (const item of (response as any).output ?? []) {
          if (item?.type !== 'message') continue;
          for (const content of item.content ?? []) {
            if ((content?.type === 'output_text' || content?.type === 'text') && typeof content.text === 'string') {
              texts.push(content.text);
            }
          }
        }
        const output = texts.join('') || (typeof (response as any).output_text === 'string' ? (response as any).output_text : JSON.stringify(response));

        return { success: true, output };
      } catch (e) {
        return { success: false, output: `MCP tool error: ${(e as Error).message}` };
      }
    };

    this.builtinServers.set(id, {
      config: normalizedConfig,
      status: 'connected',
      toolCount: tools.length,
      tools,
      handler,
    });
    log.info(`Built-in MCP server "${id}" connected successfully (${tools.length} tools).`);
  }

  private async prepareImagePayload(imageRef: string): Promise<string> {
    if (imageRef.startsWith('data:')) return imageRef;
    if (/^https?:\/\//i.test(imageRef)) return imageRef;

    const fullPath = path.isAbsolute(imageRef)
      ? imageRef
      : this.workspace
        ? path.join(this.workspace, imageRef)
        : path.resolve(imageRef);

    const data = await fs.promises.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'gif'
        ? 'image/gif'
        : ext === 'webp'
          ? 'image/webp'
          : `image/${ext || 'png'}`;

    return `data:${mime};base64,${data.toString('base64')}`;
  }


  getServerIds(): string[] {
    return Array.from(new Set([
      ...this.connections.keys(),
      ...this.builtinServers.keys(),
    ]));
  }

  isRunning(id: string): boolean {
    const builtin = this.builtinServers.get(id);
    if (builtin) return builtin.status === 'connected';
    const conn = this.connections.get(id);
    return conn?.status === 'connected';
  }
}
