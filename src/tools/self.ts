import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import type { ToolResult } from '../types.js';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');

function resolveSrcPath(filePath: string): string | null {
  const resolved = path.resolve(SRC_DIR, filePath);
  if (!resolved.startsWith(SRC_DIR + path.sep) && resolved !== SRC_DIR) return null;
  return resolved;
}

export function selfRead(filePath: string): ToolResult {
  const resolved = resolveSrcPath(filePath);
  if (!resolved) return { success: false, output: 'Access denied: can only read files in src/.' };
  if (!fs.existsSync(resolved)) return { success: false, output: `File not found: src/${filePath}` };

  try {
    const content = fs.readFileSync(resolved, 'utf-8');
    return { success: true, output: content };
  } catch (e: unknown) {
    return { success: false, output: `Read error: ${(e as Error).message}` };
  }
}

export function selfWrite(filePath: string, content: string): ToolResult {
  const resolved = resolveSrcPath(filePath);
  if (!resolved) return { success: false, output: 'Access denied: can only write files in src/.' };

  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');
    return { success: true, output: `Written: src/${filePath}` };
  } catch (e: unknown) {
    return { success: false, output: `Write error: ${(e as Error).message}` };
  }
}

export function selfEdit(filePath: string, oldString: string, newString: string): ToolResult {
  const resolved = resolveSrcPath(filePath);
  if (!resolved) return { success: false, output: 'Access denied: can only edit files in src/.' };
  if (!fs.existsSync(resolved)) return { success: false, output: `File not found: src/${filePath}` };

  try {
    const content = fs.readFileSync(resolved, 'utf-8');
    if (!content.includes(oldString)) return { success: false, output: 'Old string not found in file.' };
    const updated = content.replace(oldString, newString);
    fs.writeFileSync(resolved, updated, 'utf-8');
    return { success: true, output: `Edited: src/${filePath}` };
  } catch (e: unknown) {
    return { success: false, output: `Edit error: ${(e as Error).message}` };
  }
}

export function selfList(subDir?: string): ToolResult {
  const target = subDir ? resolveSrcPath(subDir) : SRC_DIR;
  if (!target) return { success: false, output: 'Access denied.' };
  if (!fs.existsSync(target)) return { success: false, output: `Directory not found.` };

  function walk(dir: string, prefix = ''): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const lines: string[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        lines.push(`${prefix}${e.name}/`);
        lines.push(...walk(path.join(dir, e.name), `${prefix}  `));
      } else {
        lines.push(`${prefix}${e.name}`);
      }
    }
    return lines;
  }

  return { success: true, output: walk(target).join('\n') };
}

export function selfRestart(reason?: string): never {
  console.log(`[self-modify] Restart triggered${reason ? `: ${reason}` : ''}.`);
  // Use custom event for graceful shutdown instead of hard exit
  process.emit('meta-claw-restart' as any);
  
  // Fallback in case the listener fails
  setTimeout(() => process.exit(75), 5000);
  
  // TypeScript requires never return
  throw new Error('unreachable');
}

export function readConfigFile(): ToolResult {
  const configPath = path.join(ROOT, 'config.json');
  if (!fs.existsSync(configPath)) return { success: false, output: 'config.json not found.' };
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    // Redact API keys for safety
    const config = JSON.parse(raw);
    const redacted = JSON.stringify(config, (key, value) => {
      if (key === 'apiKey' || key === 'token') return '[REDACTED]';
      return value;
    }, 2);
    return { success: true, output: redacted };
  } catch (e: unknown) {
    return { success: false, output: `Error: ${(e as Error).message}` };
  }
}

// ============================================================
// Root-level file access (whitelist-based)
// ============================================================

/** Files at project root the AI is allowed to read/write. */
const ALLOWED_ROOT_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  '.gitignore',
  '.env',
  '.env.example',
];

/** Directories at project root the AI is allowed to access. */
const ALLOWED_ROOT_DIRS = [
  'scripts',
  'templates',
  '.agents',
];

function resolveRootPath(filePath: string): string | null {
  const normalized = path.normalize(filePath).replace(/\\/g, '/');

  // Block path traversal
  if (normalized.startsWith('..') || path.isAbsolute(filePath)) return null;

  // Check if it's a whitelisted root file
  if (ALLOWED_ROOT_FILES.includes(normalized)) {
    return path.join(ROOT, normalized);
  }

  // Check if it's inside src/ (delegate to existing)
  if (normalized.startsWith('src/') || normalized === 'src') {
    return path.resolve(ROOT, normalized);
  }

  // Check if it's inside an allowed root directory
  for (const dir of ALLOWED_ROOT_DIRS) {
    if (normalized.startsWith(dir + '/') || normalized === dir) {
      return path.resolve(ROOT, normalized);
    }
  }

  return null;
}

export function selfReadRoot(filePath: string): ToolResult {
  const resolved = resolveRootPath(filePath);
  if (!resolved) return { success: false, output: `Access denied: ${filePath} is not in the allowed file list. Allowed root files: ${ALLOWED_ROOT_FILES.join(', ')}. Allowed directories: src/, ${ALLOWED_ROOT_DIRS.join(', ')}.` };
  if (!fs.existsSync(resolved)) return { success: false, output: `File not found: ${filePath}` };

  try {
    const content = fs.readFileSync(resolved, 'utf-8');
    return { success: true, output: content };
  } catch (e: unknown) {
    return { success: false, output: `Read error: ${(e as Error).message}` };
  }
}

export function selfWriteRoot(filePath: string, content: string): ToolResult {
  const resolved = resolveRootPath(filePath);
  if (!resolved) return { success: false, output: `Access denied: ${filePath} is not in the allowed file list. Allowed root files: ${ALLOWED_ROOT_FILES.join(', ')}. Allowed directories: src/, ${ALLOWED_ROOT_DIRS.join(', ')}.` };

  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');
    return { success: true, output: `Written: ${filePath}` };
  } catch (e: unknown) {
    return { success: false, output: `Write error: ${(e as Error).message}` };
  }
}

export function selfEditRoot(filePath: string, oldString: string, newString: string): ToolResult {
  const resolved = resolveRootPath(filePath);
  if (!resolved) return { success: false, output: `Access denied: ${filePath} is not in the allowed file list. Allowed root files: ${ALLOWED_ROOT_FILES.join(', ')}. Allowed directories: src/, ${ALLOWED_ROOT_DIRS.join(', ')}.` };
  if (!fs.existsSync(resolved)) return { success: false, output: `File not found: ${filePath}` };

  try {
    const content = fs.readFileSync(resolved, 'utf-8');
    if (!content.includes(oldString)) return { success: false, output: 'Old string not found in file.' };
    const updated = content.replace(oldString, newString);
    fs.writeFileSync(resolved, updated, 'utf-8');
    return { success: true, output: `Edited: ${filePath}` };
  } catch (e: unknown) {
    return { success: false, output: `Edit error: ${(e as Error).message}` };
  }
}

// ============================================================
// self_exec: run commands in the project root
// ============================================================

function detectShell(): [string, string[]] {
  if (process.platform === 'win32') {
    return ['cmd.exe', ['/d', '/s', '/c']];
  }
  const sh = process.env.SHELL ?? '/bin/sh';
  const safe = sh.endsWith('fish') ? '/bin/bash' : sh;
  return [safe, ['-c']];
}

export function selfExec(command: string, timeout?: number): Promise<ToolResult> {
  const [shell, args] = detectShell();

  return new Promise((resolve) => {
    const proc = execFile(shell, [...args, command], {
      cwd: ROOT,
      timeout: timeout ?? 60000,
      maxBuffer: 1024 * 1024 * 5,
      env: { ...process.env },
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
