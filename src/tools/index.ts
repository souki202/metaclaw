export type { ToolContext } from './context.js';
import type { ToolDefinition, ToolResult } from '../types.js';
import type { ToolContext } from './context.js';

import { buildFsTools, executeFsTool } from './fs.js';
import { buildWebTools, executeWebTool } from './web.js';
import { buildExecTools, executeExecTool } from './exec.js';
import { buildBrowserTools, executeBrowserTool } from './browser.js';
import { buildSelfTools, executeSelfTool } from './self.js';
import { buildMemoryTools, executeMemoryTool } from './memory.js';
import { buildA2ATools, executeA2ATool } from '../a2a/tools.js';
import { buildA2AEnhancedTools, executeA2AEnhancedTool } from '../a2a/enhanced-tools.js';
import { buildAcaTools, executeAcaTool } from '../aca/tools.js';
import { buildTeamProtocolTools, executeTeamProtocolTool } from '../a2a/team-protocol-tools.js';

export async function buildTools(ctx: ToolContext): Promise<ToolDefinition[]> {
  const mcpTools = ctx.mcpManager ? await ctx.mcpManager.getAllTools() : [];

  return [
    ...buildFsTools(ctx),
    ...buildMemoryTools(ctx),
    ...buildA2ATools(ctx),
    ...buildA2AEnhancedTools(ctx),
    ...buildTeamProtocolTools(ctx),
    ...buildAcaTools(ctx),
    ...buildWebTools(ctx),
    ...buildExecTools(ctx),
    ...buildBrowserTools(ctx),
    ...buildSelfTools(ctx),
    ...mcpTools,
  ];
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const result =
    await executeFsTool(name, args, ctx) ??
    await executeMemoryTool(name, args, ctx) ??
    await executeA2ATool(name, args, ctx) ??
    await executeA2AEnhancedTool(name, args, ctx) ??
    await executeTeamProtocolTool(name, args, ctx) ??
    await executeAcaTool(name, args, ctx) ??
    await executeWebTool(name, args, ctx) ??
    await executeExecTool(name, args, ctx) ??
    await executeBrowserTool(name, args, ctx) ??
    await executeSelfTool(name, args, ctx);

  if (result) return result;

  // MCP tools
  if (ctx.mcpManager && name.startsWith('mcp_')) {
    const mcpResult = await ctx.mcpManager.routeToolCall(name, args);
    if (mcpResult) return mcpResult;
  }

  return { success: false, output: `Unknown tool: ${name}` };
}
