import fs from 'fs';
import path from 'path';
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
  console.log(`[self-modify] Restart triggered${reason ? `: ${reason}` : ''}. Exiting with code 75.`);
  setTimeout(() => process.exit(75), 500);
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
