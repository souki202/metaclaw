import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig, ToolDefinition, ToolResult } from '../types.js';
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

export class McpClientManager {
  private connections = new Map<string, McpConnection>();

  async startServer(id: string, config: McpServerConfig): Promise<void> {
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
    const ids = Array.from(this.connections.keys());
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
    for (const id of this.connections.keys()) {
      const tools = await this.getTools(id);
      all.push(...tools);
    }
    return all;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
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
    for (const id of this.connections.keys()) {
      if (rest.startsWith(id + '_')) {
        const toolName = rest.slice(id.length + 1);
        return this.callTool(id, toolName, args);
      }
    }
    return { success: false, output: `Unknown MCP tool: ${prefixedName}` };
  }

  getServerIds(): string[] {
    return Array.from(this.connections.keys());
  }

  isRunning(id: string): boolean {
    const conn = this.connections.get(id);
    return conn?.status === 'connected';
  }
}
