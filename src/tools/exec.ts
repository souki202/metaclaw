import path from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';
import type { ToolContext } from './context.js';
import { CURRENT_OS } from './context.js';
import { PtyManager } from './pty-manager.js';

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf?\b/i,
  /\bdel\s+\/[sf]/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /:\(\)\s*\{.*\}\s*;/,
];

/**
 * Context-aware normalisation of bash-style quoting for Windows cmd.exe.
 *
 * In bash, \" is always a literal " and never changes the quote state.
 * Only a bare " opens/closes bash double-quote context.
 *
 * Rules applied here:
 *  - \" outside a bare "..." context  →  replace with "   (AI outer delimiter)
 *  - \" inside  a bare "..." context  →  keep as \"        (Windows CRT escaped quote)
 *  - bare "                           →  toggle context, emit as-is
 *
 * Example transformations:
 *   -H \"Content-Type: application/json\"       → -H "Content-Type: application/json"
 *   --data-binary "{\"name\":\"value\"}"        → unchanged (CRT handles inner \")
 */
function normalizeWindowsQuotes(cmd: string): string {
  let result = '';
  let inBashDoubleQuote = false;
  let i = 0;
  while (i < cmd.length) {
    const ch = cmd[i];
    if (ch === '\\' && i + 1 < cmd.length && cmd[i + 1] === '"') {
      if (inBashDoubleQuote) {
        // Inside "...": keep \" for Windows CRT to interpret as escaped "
        result += '\\"';
      } else {
        // Outside "...": bash-style outer delimiter → convert to bare "
        result += '"';
      }
      i += 2;
    } else if (ch === '"') {
      inBashDoubleQuote = !inBashDoubleQuote;
      result += '"';
      i++;
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

function sanitizePath(workspace: string, cmdPath: string): boolean {
  const resolved = path.resolve(workspace, cmdPath);
  return resolved.startsWith(path.resolve(workspace));
}

function quotePosixPath(targetPath: string): string {
  return `'${targetPath.replace(/'/g, `'\\''`)}'`;
}

function quoteWindowsPath(targetPath: string): string {
  return `"${targetPath.replace(/"/g, '""')}"`;
}

function wrapCommandForTerminal(command: string, workingDir: string, workspace: string): string {
  if (workingDir === workspace) {
    return command;
  }

  if (process.platform === 'win32') {
    return `cd /d ${quoteWindowsPath(workingDir)} && ${command}`;
  }

  return `cd ${quotePosixPath(workingDir)} && ${command}`;
}

export async function execTool(params: {
  command: string;
  cwd?: string;
  timeout?: number;
  workspace: string;
  restrictToWorkspace: boolean;
  sessionId: string;
}): Promise<ToolResult> {
  const { command, cwd, timeout = 30000, workspace, restrictToWorkspace, sessionId } = params;

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { success: false, output: `Command blocked: dangerous pattern detected.` };
    }
  }

  const workingDir = cwd
    ? restrictToWorkspace
      ? sanitizePath(workspace, cwd)
        ? path.resolve(workspace, cwd)
        : workspace
      : path.resolve(cwd)
    : workspace;

  if (restrictToWorkspace && !workingDir.startsWith(path.resolve(workspace))) {
    return { success: false, output: `Command blocked: working directory outside workspace.` };
  }

  // AI models generate bash-style quoting which cmd.exe cannot handle directly.
  // We do a context-aware normalisation: only replace \" that are OUTSIDE a bare-"..."
  // context (i.e. AI-generated outer delimiters like -H \"value\").
  // \" that appear INSIDE an existing "..." context (e.g. --data-binary "{\"key\":\"val\"}")
  // must be kept as-is because Windows CRT recognises \" as an escaped " inside "...".
  const normalizedCommand = process.platform === 'win32'
    ? normalizeWindowsQuotes(command)
    : command;

  // Execute through the shared PTY so dashboard Terminal view and AI shell work stay aligned.
  const finalCommand = wrapCommandForTerminal(normalizedCommand, workingDir, workspace);
  const manager = PtyManager.getInstance();
  const { output, exitCode } = await manager.execCommand(
    sessionId,
    workspace,
    finalCommand,
    timeout,
  );

  return {
    success: exitCode === 0 || exitCode === -1,
    output: output || `(exited with code ${exitCode})`,
  };
}

export function buildExecTools(ctx: ToolContext): ToolDefinition[] {
  if (!ctx.config.tools.exec) return [];
  return [
    {
      type: 'function',
      function: {
        name: 'exec',
        description: `Execute a shell command in the shared session terminal. Output is reflected in the dashboard Terminal tab, and terminal state can persist across calls. Current runtime OS: ${CURRENT_OS}.`,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to run.' },
            cwd: { type: 'string', description: 'Working directory (relative to workspace).' },
            timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000).' },
          },
          required: ['command'],
        },
      },
    },
  ];
}

export async function executeExecTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult | null> {
  if (name !== 'exec') return null;
  return execTool({
    command: args.command as string,
    cwd: args.cwd as string | undefined,
    timeout: args.timeout as number | undefined,
    workspace: ctx.workspace,
    restrictToWorkspace: ctx.config.restrictToWorkspace,
    sessionId: ctx.sessionId,
  });
}
