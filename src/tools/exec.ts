import { execFile } from 'child_process';
import path from 'path';
import iconv from 'iconv-lite';
import type { ToolResult } from '../types.js';

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

function detectShell(): [string, string[]] {
  if (process.platform === 'win32') {
    return ['cmd.exe', ['/d', '/s', '/c']];
  }
  const sh = process.env.SHELL ?? '/bin/sh';
  const safe = sh.endsWith('fish') ? '/bin/bash' : sh;
  return [safe, ['-c']];
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

  const [shell, args] = detectShell();

  return new Promise((resolve) => {
    // Windows treats standard output differently: it uses the system code page (CP932/Shift-JIS for Japanese locales).
    // We attempt to set it to UTF-8 (65001) first, but we still capture as Buffer and decode for robustness.
    const finalCommand = process.platform === 'win32'
      ? `chcp 65001 > nul && ${command}`
      : command;

    const proc = execFile(shell, [...args, finalCommand], {
      cwd: workingDir,
      timeout,
      maxBuffer: 1024 * 1024 * 5,
      encoding: 'buffer', // Set to buffer to manually decode
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        LANG: process.env.LANG,
        TERM: 'xterm-256color',
      } as any,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

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
