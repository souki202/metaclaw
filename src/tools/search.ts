import fs from 'fs';
import path from 'path';
import type { ToolResult } from '../types.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** Directory names that are never traversed. */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', '.turbo',
  '__pycache__', 'coverage', '.cache', 'out', '.svelte-kit',
]);

/** File extensions treated as binary (skipped in text_search). */
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.tiff', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.mp3', '.wav', '.ogg', '.webm', '.avi',
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.pyc', '.class',
  '.db', '.sqlite', '.sqlite3',
]);

/** Project root – used by self_* search tools. */
const ROOT = process.cwd();

// ── Helpers ────────────────────────────────────────────────────────────────

/** Recursively yield absolute paths of all non-hidden, non-skipped files. */
function* walkDir(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkDir(full);
    else if (e.isFile()) yield full;
  }
}

/**
 * Convert a glob-like pattern to a RegExp.
 * Supports * (any chars, no slash), ** (any path), ? (single char, no slash).
 */
function globToRegex(pattern: string): RegExp {
  const esc = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex specials
    .replace(/\*\*/g, '\x00')               // protect **
    .replace(/\*/g, '[^/]*')               // * → no-slash wildcard
    .replace(/\?/g, '[^/]')                // ? → no-slash single char
    .replace(/\x00/g, '.*');               // ** → any path
  return new RegExp(`^${esc}$`, 'i');
}

/**
 * Return true when `absolutePath` matches `pattern` relative to `root`.
 *
 * Pattern semantics:
 *   - No glob chars, no slash  →  substring match on basename  ("config" matches "next.config.js")
 *   - Glob chars, no slash     →  glob match on basename        ("*.ts" matches "browser.ts")
 *   - Contains slash           →  glob match on relative path   ("src/tools/*.ts" or "**\/*.ts")
 */
function matchesPattern(absolutePath: string, pattern: string, root: string): boolean {
  const relative = path.relative(root, absolutePath).replace(/\\/g, '/');
  const basename = path.basename(absolutePath);
  const hasGlob = pattern.includes('*') || pattern.includes('?');
  const hasSlash = pattern.includes('/');

  if (!hasGlob && !hasSlash) {
    return basename.toLowerCase().includes(pattern.toLowerCase());
  }
  if (hasSlash) {
    return globToRegex(pattern).test(relative);
  }
  return globToRegex(pattern).test(basename);
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1_048_576).toFixed(1)}M`;
}

// ── file_search ────────────────────────────────────────────────────────────

export interface FileSearchOptions {
  maxResults?: number;  // default 60
}

/**
 * Find files under `root` whose name/path matches `pattern`.
 *
 * Pattern examples:
 *   "*.ts"         – any TypeScript file
 *   "browser"      – files with "browser" in name
 *   "src/tools/*"  – files directly inside src/tools/
 *   "**\/*.tsx"    – any .tsx file recursively
 */
export function fileSearch(
  pattern: string,
  root: string,
  options?: FileSearchOptions,
): ToolResult {
  const max = options?.maxResults ?? 60;
  if (!fs.existsSync(root)) return { success: false, output: `Root not found: ${root}` };

  const found: Array<{ rel: string; bytes: number; mtime: number }> = [];
  try {
    for (const f of walkDir(root)) {
      if (!matchesPattern(f, pattern, root)) continue;
      try {
        const st = fs.statSync(f);
        found.push({ rel: path.relative(root, f).replace(/\\/g, '/'), bytes: st.size, mtime: st.mtimeMs });
      } catch {
        found.push({ rel: path.relative(root, f).replace(/\\/g, '/'), bytes: 0, mtime: 0 });
      }
      if (found.length >= max) break;
    }
  } catch (e: unknown) {
    return { success: false, output: `Search error: ${(e as Error).message}` };
  }

  if (!found.length) return { success: true, output: `No files found matching "${pattern}"` };

  // Sort by modification time (most recently changed first)
  found.sort((a, b) => b.mtime - a.mtime);

  const limitNote = found.length >= max ? ' (limit reached – refine pattern to see more)' : '';
  const header = `${found.length} file${found.length === 1 ? '' : 's'} found${limitNote}:`;
  const lines = found.map(f => `${f.rel} (${fmtSize(f.bytes)})`);
  return { success: true, output: `${header}\n${lines.join('\n')}` };
}

// ── text_search ────────────────────────────────────────────────────────────

export interface TextSearchOptions {
  /** Glob pattern to restrict which files are searched (e.g., "*.ts", "src/**\/*.ts"). */
  pattern?: string;
  /** Treat `query` as a regular expression. Default false. */
  isRegex?: boolean;
  /** Case-sensitive matching. Default false. */
  caseSensitive?: boolean;
  /** Number of surrounding lines to show (0–5). Default 0. */
  contextLines?: number;
  /** Maximum number of matching lines to return. Default 50. */
  maxMatches?: number;
}

/**
 * Search file contents under `root` for `query`.
 * Returns file path + line number for each match.
 */
export function textSearch(
  query: string,
  root: string,
  options?: TextSearchOptions,
): ToolResult {
  if (!fs.existsSync(root)) return { success: false, output: `Root not found: ${root}` };

  const isRegex = options?.isRegex ?? false;
  const caseSensitive = options?.caseSensitive ?? false;
  const ctx = Math.min(options?.contextLines ?? 0, 5);
  const maxMatches = options?.maxMatches ?? 50;
  const filePattern = options?.pattern;

  let re: RegExp;
  try {
    const flags = caseSensitive ? '' : 'i';
    const src = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(src, flags);
  } catch (e: unknown) {
    return { success: false, output: `Invalid regex: ${(e as Error).message}` };
  }

  interface FileGroup { file: string; hits: string[] }
  const groups: FileGroup[] = [];
  let total = 0;

  outer:
  for (const absPath of walkDir(root)) {
    if (BINARY_EXTS.has(path.extname(absPath).toLowerCase())) continue;
    if (filePattern && !matchesPattern(absPath, filePattern, root)) continue;

    let lines: string[];
    try {
      const buf = fs.readFileSync(absPath);
      if (buf.includes(0)) continue;             // null byte → binary
      if (buf.length > 2_000_000) continue;       // skip huge files (>2 MB)
      lines = buf.toString('utf-8').split('\n');
    } catch { continue; }

    const hits: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (total >= maxMatches) break outer;
      if (!re.test(lines[i])) continue;

      const lineNo = i + 1;
      const trim = (l: string) => (l.length > 200 ? l.slice(0, 200) + '…' : l).trimEnd();

      if (ctx > 0) {
        const bStart = Math.max(0, i - ctx);
        for (let b = bStart; b < i; b++) hits.push(`  ${b + 1}:   ${trim(lines[b])}`);
        hits.push(`  ${lineNo}:→ ${trim(lines[i])}`);
        const aEnd = Math.min(lines.length - 1, i + ctx);
        for (let a = i + 1; a <= aEnd; a++) hits.push(`  ${a + 1}:   ${trim(lines[a])}`);
        hits.push('');
      } else {
        hits.push(`  L${lineNo}: ${trim(lines[i])}`);
      }
      total++;
    }

    if (hits.length) {
      const rel = path.relative(root, absPath).replace(/\\/g, '/');
      groups.push({ file: rel, hits });
    }
  }

  if (!total) return { success: true, output: `No matches for "${query}"` };

  const limitNote = total >= maxMatches ? ' (limit reached – use pattern/isRegex to narrow)' : '';
  const out: string[] = [
    `${total} match${total === 1 ? '' : 'es'} across ${groups.length} file${groups.length === 1 ? '' : 's'}${limitNote}:`,
  ];
  for (const g of groups) {
    out.push(`\n${g.file}`);
    out.push(...g.hits);
  }
  return { success: true, output: out.join('\n') };
}

// ── self_file_search / self_text_search ────────────────────────────────────
// These search the entire mini-claw project (ROOT) rather than the session workspace.

export function selfFileSearch(pattern: string, options?: FileSearchOptions): ToolResult {
  return fileSearch(pattern, ROOT, options);
}

export function selfTextSearch(query: string, options?: TextSearchOptions): ToolResult {
  return textSearch(query, ROOT, options);
}
