import type { ToolDefinition, ToolResult } from '../types.js';
import type { ToolContext } from './context.js';
import { PtyManager } from './pty-manager.js';
import { CURRENT_OS } from './context.js';

export function buildTerminalTools(ctx: ToolContext): ToolDefinition[] {
  if (!ctx.config.tools.exec) return [];
  return [
    {
      type: 'function',
      function: {
        name: 'terminal_exec',
        description: `Execute a shell command in a persistent terminal session. Unlike exec, the working directory (cd) and environment variables carry over between calls. Suitable for multi-step workflows and interactive programs. Current runtime OS: ${CURRENT_OS}.`,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to run.' },
            timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000).' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'terminal_send_input',
        description: 'Send raw input to the persistent terminal session. Use this to respond to interactive prompts (e.g. yes/no questions, npm init prompts). Append \\n to submit.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to send to the terminal (include \\n to submit).' },
          },
          required: ['text'],
        },
      },
    },
  ];
}

export async function executeTerminalTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult | null> {
  const manager = PtyManager.getInstance();

  if (name === 'terminal_exec') {
    const command = args.command as string;
    const timeout = args.timeout as number | undefined;
    const { output, exitCode } = await manager.execCommand(
      ctx.sessionId,
      ctx.workspace,
      command,
      timeout
    );
    return {
      success: exitCode === 0 || exitCode === -1,
      output: output || `(exited with code ${exitCode})`,
    };
  }

  if (name === 'terminal_send_input') {
    const text = args.text as string;
    manager.write(ctx.sessionId, text);
    return { success: true, output: 'Input sent.' };
  }

  return null;
}
