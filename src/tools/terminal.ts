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
        description: `Execute a shell command in a persistent terminal session. Working directory (cd) and environment variables carry over between calls. Current runtime OS: ${CURRENT_OS}.

For NON-INTERACTIVE commands (ls, git, npm install, cat, etc.): call normally. Waits for completion and returns output.

For INTERACTIVE commands that prompt for input (npm init, python REPL, node, etc.): set interactive=true. The command starts and initial prompts are returned. Then use terminal_send_input SEQUENTIALLY for each prompt — one call per prompt, wait for the result before sending the next input. Do NOT call terminal_exec again until the entire interactive session is complete.`,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to run.' },
            timeout: { type: 'number', description: 'Timeout ms (default 30000). Only for non-interactive mode.' },
            interactive: {
              type: 'boolean',
              description: 'Set true for interactive programs (npm init, REPLs, etc.). Returns initial output/prompts; use terminal_send_input to respond to each one.',
            },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'terminal_send_input',
        description: 'Send one line of input to the active interactive terminal session and return the resulting output/next prompt. Call ONCE per prompt — wait for the result before calling again. To accept a default value, send an empty string "".',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Value to enter at the current prompt. Use "" to accept the default. Do NOT include \\n — it is added automatically.',
            },
          },
          required: ['text'],
        },
      },
    },
  ];
}

/** Normalize text for PTY input and append Enter */
function toTerminalLine(text: string): string {
  // Always send as a complete line (append CR+LF on Windows, LF elsewhere)
  // Strip any trailing newlines the caller might have included, then re-add correctly
  const stripped = text.replace(/[\r\n]+$/, '');
  return process.platform === 'win32' ? stripped + '\r\n' : stripped + '\n';
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
    const interactive = args.interactive as boolean | undefined;

    if (interactive) {
      // Ensure PTY exists BEFORE setting up the output listener
      manager.getOrCreate(ctx.sessionId, ctx.workspace);
      const outputPromise = manager.waitForOutput(ctx.sessionId, 1200, 15000);
      manager.write(ctx.sessionId, command + (process.platform === 'win32' ? '\r\n' : '\n'));
      const output = await outputPromise;
      // Fall back to buffer snapshot if waitForOutput returned nothing meaningful
      return {
        success: true,
        output: output || manager.getRecentBuffer(ctx.sessionId, 1500),
      };
    }

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
    const line = toTerminalLine(text);

    // Set up listener BEFORE writing to avoid missing early output
    const outputPromise = manager.waitForOutput(ctx.sessionId, 800, 8000);
    manager.write(ctx.sessionId, line);
    const newOutput = await outputPromise;

    // Always return the recent terminal buffer as context so the AI can see the
    // current state even when waitForOutput returns blank (e.g. echo-only responses).
    const bufferSnapshot = manager.getRecentBuffer(ctx.sessionId, 800);
    return {
      success: true,
      output: newOutput || bufferSnapshot || '(no terminal output)',
    };
  }

  return null;
}
