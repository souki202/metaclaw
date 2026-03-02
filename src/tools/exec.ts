import { spawn } from 'child_process';
import path from 'path';
import iconv from 'iconv-lite';
import type { ToolDefinition, ToolResult } from '../types.js';
import type { ToolContext } from './context.js';
import { CURRENT_OS } from './context.js';

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

function detectShell(): string | true {
  if (process.platform === 'win32') {
    // Return true so Node.js uses cmd.exe via spawn's shell:true.
    // This avoids Node.js's per-argument quoting (execFile) which would
    // double-escape double-quotes and break cmd.exe command parsing.
    return true;
  }
  const sh = process.env.SHELL ?? '/bin/sh';
  const safe = sh.endsWith('fish') ? '/bin/bash' : sh;
  return safe;
}

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

export async function execTool(params: {
  command: string;
  cwd?: string;
  timeout?: number;
  workspace: string;
  restrictToWorkspace: boolean;
}): Promise<ToolResult> {
  const { command, cwd, timeout = 30000, workspace, restrictToWorkspace } = params;

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

  const shell = detectShell();

  // AI models generate bash-style quoting which cmd.exe cannot handle directly.
  // We do a context-aware normalisation: only replace \" that are OUTSIDE a bare-"..."
  // context (i.e. AI-generated outer delimiters like -H \"value\").
  // \" that appear INSIDE an existing "..." context (e.g. --data-binary "{\"key\":\"val\"}")
  // must be kept as-is because Windows CRT recognises \" as an escaped " inside "...".
  const normalizedCommand = process.platform === 'win32'
    ? normalizeWindowsQuotes(command)
    : command;

  // Windows: switch code page to UTF-8 before the actual command.
  const finalCommand = process.platform === 'win32'
    ? `chcp 65001 > nul && ${normalizedCommand}`
    : normalizedCommand;

  return new Promise((resolve) => {
    // Use spawn with shell:true so that on Windows Node.js wraps the entire
    // command string in quotes for cmd.exe (/S /C "...") instead of escaping
    // each argument individually (execFile behaviour), which breaks "..." inside
    // the command string by turning them into \".
    const proc = spawn(finalCommand, [], {
      shell,
      cwd: workingDir,
      timeout,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        LANG: process.env.LANG,
        TERM: 'xterm-256color',
      } as any,
    });

    const MAX_OUTPUT = 1024 * 1024 * 5; // 5 MB
    let totalSize = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout?.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize <= MAX_OUTPUT) stdoutChunks.push(chunk);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize <= MAX_OUTPUT) stderrChunks.push(chunk);
    });

    proc.on('close', (code) => {
      const stdout = decodeBuffer(Buffer.concat(stdoutChunks));
      const stderr = decodeBuffer(Buffer.concat(stderrChunks));

      const output = [stdout, stderr].filter(Boolean).join('\n');
      resolve({
        success: code === 0,
        output: output || `(exited with code ${code})`,
      });
    });

    proc.on('error', (err) => {
      resolve({ success: false, output: `Error: ${err.message}` });
    });
  });
}

function decodeBuffer(buffer: Buffer): string {
  if (buffer.length === 0) return '';

  if (process.platform === 'win32') {
    // Try UTF-8 first
    try {
      const utf8Text = buffer.toString('utf8');
      // If it contains replacement character or invalid sequences, it might be SJIS
      if (!utf8Text.includes('\uFFFD')) {
        return utf8Text;
      }
    } catch {
      // ignore
    }
    // Fallback to CP932 (Shift-JIS) for Windows Japanese environments
    return iconv.decode(buffer, 'cp932');
  }

  return buffer.toString('utf8');
}

export function buildExecTools(ctx: ToolContext): ToolDefinition[] {
  if (!ctx.config.tools.exec) return [];
  return [
    {
      type: 'function',
      function: {
        name: 'exec',
        description: `Execute a shell command. Each operation is independent, and operations such as "cd" are not carried over. Current runtime OS: ${CURRENT_OS}.`,
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
  });
}
