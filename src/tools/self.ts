import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import type { ToolDefinition, ToolResult } from '../types.js';
import type { ToolContext } from './context.js';
import { CURRENT_OS } from './context.js';
import { selfFileSearch, selfTextSearch } from './search.js';
import { gitStatus, gitDiff, gitDiffStaged, gitLog, gitCommit, gitBranch, gitCheckout, gitStash, gitReset, gitPush, gitPull } from './git.js';

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
    const hasCRLF = content.includes('\r\n');
    const normContent = content.replace(/\r\n/g, '\n');
    const normOld = oldString.replace(/\r\n/g, '\n');
    const normNew = newString.replace(/\r\n/g, '\n');

    if (!normContent.includes(normOld)) return { success: false, output: 'Old string not found in file.' };
    
    let updated = normContent.replace(normOld, normNew);
    if (hasCRLF) {
      updated = updated.replace(/\n/g, '\r\n');
    }

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

export function selfRestart(reason?: string): ToolResult {
  console.log(`[self-modify] Restart triggered${reason ? `: ${reason}` : ''}.`);
  // Special return value handled by the agent loop
  return { success: true, output: "__META_CLAW_RESTART__" };
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
    const hasCRLF = content.includes('\r\n');
    const normContent = content.replace(/\r\n/g, '\n');
    const normOld = oldString.replace(/\r\n/g, '\n');
    const normNew = newString.replace(/\r\n/g, '\n');

    if (!normContent.includes(normOld)) return { success: false, output: 'Old string not found in file.' };
    
    let updated = normContent.replace(normOld, normNew);
    if (hasCRLF) {
      updated = updated.replace(/\n/g, '\r\n');
    }

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

export function buildSelfTools(ctx: ToolContext): ToolDefinition[] {
  if (!ctx.config.allowSelfModify) return [];
  return [
    {
      type: 'function',
      function: {
        name: 'self_list',
        description: 'List files in the meta-claw source code directory (src/).',
        parameters: {
          type: 'object',
          properties: {
            subdir: { type: 'string', description: 'Subdirectory within src/ to list.' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_read',
        description: 'Read a source file from meta-claw src/.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relative to src/.' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_write',
        description: 'Write/modify a source file in meta-claw src/. Use self_restart afterward to apply changes.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relative to src/.' },
            content: { type: 'string', description: 'New file content.' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_edit',
        description: 'Replace a specific string in a source file in meta-claw src/. Use self_restart afterward.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relative to src/.' },
            old_string: { type: 'string', description: 'String to replace.' },
            new_string: { type: 'string', description: 'Replacement string.' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_restart',
        description: 'Restart meta-claw to apply self-modifications. All sessions will restart. NOTE: With Next.js hot reload, this is only needed for changes that cannot be hot-reloaded (npm install, config changes, native module updates). Regular code changes in src/ or app/ are hot-reloaded automatically.',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Reason for restart.' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_read_config',
        description: 'Read the system config (API keys are redacted).',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    // Git tools
    {
      type: 'function',
      function: {
        name: 'self_git_status',
        description: "Show git working tree status of the AI system's own repository (meta-claw).",
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_git_diff',
        description: "Show unstaged changes in the AI system's own repository. Optionally filter by path.",
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to diff (optional).' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_git_diff_staged',
        description: "Show staged (cached) changes in the AI system's own repository. Optionally filter by path.",
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to diff (optional).' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_git_log',
        description: "Show recent commit history of the AI system's own repository.",
        parameters: {
          type: 'object',
          properties: {
            count: { type: 'number', description: 'Number of commits to show (default 20).' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_git_commit',
        description: "Stage all changes and commit to the AI system's own repository with a message.",
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message.' },
          },
          required: ['message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_git_branch',
        description: "List all branches (local and remote) of the AI system's own repository.",
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_git_checkout',
        description: "Switch to a branch or restore files in the AI system's own repository.",
        parameters: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'Branch name, tag, or commit hash.' },
          },
          required: ['ref'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_git_stash',
        description: "Stash changes in the AI system's own repository. Actions: push (default), pop, list, drop, apply, show.",
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'Stash action (push, pop, list, drop, apply, show).' },
            message: { type: 'string', description: 'Stash message (only for push action).' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_git_reset',
        description: "Reset current HEAD of the AI system's own repository to a commit. Use for reverting changes.",
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', description: 'Reset mode: soft, mixed (default), or hard.' },
            ref: { type: 'string', description: 'Commit ref to reset to (e.g., HEAD~1).' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_git_push',
        description: "Push commits from the AI system's own repository to remote repository.",
        parameters: {
          type: 'object',
          properties: {
            remote: { type: 'string', description: 'Remote name (default: origin).' },
            branch: { type: 'string', description: 'Branch name.' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_git_pull',
        description: "Pull changes for the AI system's own repository from remote repository.",
        parameters: {
          type: 'object',
          properties: {
            remote: { type: 'string', description: 'Remote name (default: origin).' },
            branch: { type: 'string', description: 'Branch name.' },
          },
          required: [],
        },
      },
    },
    // Root-level file access tools
    {
      type: 'function',
      function: {
        name: 'self_read_root',
        description: 'Read a file from the project root. Allowed: package.json, tsconfig.json, .gitignore, .env, and files in src/, scripts/, templates/, .agents/.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relative to project root (e.g., "package.json", "scripts/runner.js").' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_write_root',
        description: 'Write a file in the project root. Same access restrictions as self_read_root.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relative to project root.' },
            content: { type: 'string', description: 'New file content.' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_edit_root',
        description: 'Replace a string in a file in the project root. Same access restrictions as self_read_root.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relative to project root.' },
            old_string: { type: 'string', description: 'String to replace.' },
            new_string: { type: 'string', description: 'Replacement string.' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_file_search',
        description: 'Find files in the mini-claw project (src/, scripts/, templates/, root configs) by name or path pattern. Same pattern semantics as file_search. Use for self-modification tasks to locate source files quickly.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Filename pattern or glob (e.g. "*.ts", "agent", "src/tools/*.ts").' },
            max_results: { type: 'number', description: 'Max files to return (default 60).' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_text_search',
        description: 'Search the mini-claw project source code for a query string or regex. Like grep over the whole codebase. Use for self-modification tasks to find function definitions, usages, or config values.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Text or regex pattern to search for.' },
            pattern: { type: 'string', description: 'Glob to restrict which files are searched (e.g. "*.ts", "src/tools/*.ts").' },
            is_regex: { type: 'boolean', description: 'Treat query as a regular expression (default false).' },
            case_sensitive: { type: 'boolean', description: 'Case-sensitive matching (default false).' },
            context_lines: { type: 'number', description: 'Lines of context before/after each match, 0-5 (default 0).' },
            max_matches: { type: 'number', description: 'Maximum matching lines to return (default 50).' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'self_exec',
        description: `Execute a shell command in the project root directory (e.g., npm install, npx tsc). Current runtime OS: ${CURRENT_OS}.`,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to run.' },
            timeout: { type: 'number', description: 'Timeout in ms (default 60000).' },
          },
          required: ['command'],
        },
      },
    },
  ];
}

export async function executeSelfTool(
  name: string,
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult | null> {
  switch (name) {
    case 'self_list':
      return selfList(args.subdir as string | undefined);
    case 'self_read':
      return selfRead(args.path as string);
    case 'self_write':
      return selfWrite(args.path as string, args.content as string);
    case 'self_edit':
      return selfEdit(args.path as string, args.old_string as string, args.new_string as string);
    case 'self_restart':
      return selfRestart(args.reason as string | undefined);
    case 'self_read_config':
      return readConfigFile();
    case 'self_git_status':
      return gitStatus();
    case 'self_git_diff':
      return gitDiff(args.path as string | undefined);
    case 'self_git_diff_staged':
      return gitDiffStaged(args.path as string | undefined);
    case 'self_git_log':
      return gitLog(args.count as number | undefined);
    case 'self_git_commit':
      return gitCommit(args.message as string);
    case 'self_git_branch':
      return gitBranch();
    case 'self_git_checkout':
      return gitCheckout(args.ref as string);
    case 'self_git_stash':
      return gitStash(args.action as string | undefined, args.message as string | undefined);
    case 'self_git_reset':
      return gitReset(args.mode as string | undefined, args.ref as string | undefined);
    case 'self_git_push':
      return gitPush(args.remote as string | undefined, args.branch as string | undefined);
    case 'self_git_pull':
      return gitPull(args.remote as string | undefined, args.branch as string | undefined);
    case 'self_read_root':
      return selfReadRoot(args.path as string);
    case 'self_write_root':
      return selfWriteRoot(args.path as string, args.content as string);
    case 'self_edit_root':
      return selfEditRoot(args.path as string, args.old_string as string, args.new_string as string);
    case 'self_file_search':
      return selfFileSearch(args.pattern as string, { maxResults: args.max_results as number | undefined });
    case 'self_text_search':
      return selfTextSearch(args.query as string, {
        pattern: args.pattern as string | undefined,
        isRegex: args.is_regex as boolean | undefined,
        caseSensitive: args.case_sensitive as boolean | undefined,
        contextLines: args.context_lines as number | undefined,
        maxMatches: args.max_matches as number | undefined,
      });
    case 'self_exec':
      return selfExec(args.command as string, args.timeout as number | undefined);
    default:
      return null;
  }
}
