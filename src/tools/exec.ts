import { execFile } from 'child_process';
import path from 'path';
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
    const proc = execFile(shell, [...args, command], {
      cwd: workingDir,
      timeout,
      maxBuffer: 1024 * 1024 * 5,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        LANG: process.env.LANG,
        TERM: 'xterm-256color',
      } as any,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => (stdout += d));
    proc.stderr?.on('data', (d) => (stderr += d));

    proc.on('close', (code) => {
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
