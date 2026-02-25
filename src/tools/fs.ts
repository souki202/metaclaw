import fs from 'fs';
import path from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';
import type { ToolContext } from './context.js';
import { fileSearch, textSearch } from './search.js';

function resolveSafe(workspace: string, filePath: string, restrict: boolean): string | null {
  const resolved = path.resolve(workspace, filePath);
  if (restrict && !resolved.startsWith(path.resolve(workspace) + path.sep) && resolved !== path.resolve(workspace)) {
    return null;
  }
  return resolved;
}

export function readFile(workspace: string, filePath: string, restrict: boolean): ToolResult {
  const resolved = resolveSafe(workspace, filePath, restrict);
  if (!resolved) return { success: false, output: 'Access denied: path outside workspace.' };
  if (!fs.existsSync(resolved)) return { success: false, output: `File not found: ${filePath}` };

  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return { success: false, output: `Is a directory. Use list_dir instead.` };
    const content = fs.readFileSync(resolved, 'utf-8');
    return { success: true, output: content };
  } catch (e: unknown) {
    return { success: false, output: `Read error: ${(e as Error).message}` };
  }
}

export function writeFile(workspace: string, filePath: string, content: string, restrict: boolean): ToolResult {
  const resolved = resolveSafe(workspace, filePath, restrict);
  if (!resolved) return { success: false, output: 'Access denied: path outside workspace.' };

  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');
    return { success: true, output: `Written: ${filePath}` };
  } catch (e: unknown) {
    return { success: false, output: `Write error: ${(e as Error).message}` };
  }
}

export function editFile(
  workspace: string,
  filePath: string,
  oldString: string,
  newString: string,
  restrict: boolean
): ToolResult {
  const resolved = resolveSafe(workspace, filePath, restrict);
  if (!resolved) return { success: false, output: 'Access denied: path outside workspace.' };
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

export function listDir(workspace: string, dirPath: string, restrict: boolean): ToolResult {
  const resolved = resolveSafe(workspace, dirPath || '.', restrict);
  if (!resolved) return { success: false, output: 'Access denied: path outside workspace.' };
  if (!fs.existsSync(resolved)) return { success: false, output: `Directory not found: ${dirPath}` };

  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const lines = entries.map((e) => {
      if (e.isDirectory()) return `[dir]  ${e.name}/`;
      const stat = fs.statSync(path.join(resolved, e.name));
      const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)}K` : `${stat.size}B`;
      return `[file] ${e.name} (${size})`;
    });
    return { success: true, output: lines.join('\n') || '(empty)' };
  } catch (e: unknown) {
    return { success: false, output: `List error: ${(e as Error).message}` };
  }
}

export function deleteFile(workspace: string, filePath: string, restrict: boolean): ToolResult {
  const resolved = resolveSafe(workspace, filePath, restrict);
  if (!resolved) return { success: false, output: 'Access denied: path outside workspace.' };
  if (!fs.existsSync(resolved)) return { success: false, output: `Not found: ${filePath}` };

  try {
    fs.rmSync(resolved, { recursive: false });
    return { success: true, output: `Deleted: ${filePath}` };
  } catch (e: unknown) {
    return { success: false, output: `Delete error: ${(e as Error).message}` };
  }
}

export function buildFsTools(_ctx: ToolContext): ToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file from the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace.' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace.' },
            content: { type: 'string', description: 'Content to write.' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Replace a specific string in a file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace.' },
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
        name: 'list_dir',
        description: 'List files in a directory within the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path relative to workspace. Defaults to root.' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Delete a file from the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace.' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'file_search',
        description: 'Find files in the workspace by name or path pattern. Pattern examples: "*.ts" (any TS file), "config" (name contains "config"), "src/tools/*.ts" (specific directory), "**/*.json" (recursive). Returns results sorted by most recently modified.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Filename pattern or glob (e.g. "*.ts", "config", "src/**/*.json").' },
            max_results: { type: 'number', description: 'Max files to return (default 60).' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'text_search',
        description: 'Search file contents in the workspace for a query string or regex. Like grep. Returns file paths and matching lines with optional surrounding context.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Text or regex pattern to search for.' },
            pattern: { type: 'string', description: 'Glob to restrict which files are searched (e.g. "*.ts", "src/**/*.ts").' },
            is_regex: { type: 'boolean', description: 'Treat query as a regular expression (default false).' },
            case_sensitive: { type: 'boolean', description: 'Case-sensitive matching (default false).' },
            context_lines: { type: 'number', description: 'Lines of context before/after each match, 0–5 (default 0).' },
            max_matches: { type: 'number', description: 'Maximum matching lines to return (default 50).' },
          },
          required: ['query'],
        },
      },
    },
  ];
}

export async function executeFsTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult | null> {
  const { workspace } = ctx;
  const restrict = ctx.config.restrictToWorkspace;

  switch (name) {
    case 'read_file':
      return readFile(workspace, args.path as string, restrict);
    case 'write_file':
      return writeFile(workspace, args.path as string, args.content as string, restrict);
    case 'edit_file':
      return editFile(workspace, args.path as string, args.old_string as string, args.new_string as string, restrict);
    case 'list_dir':
      return listDir(workspace, (args.path as string) ?? '.', restrict);
    case 'delete_file':
      return deleteFile(workspace, args.path as string, restrict);
    case 'file_search':
      return fileSearch(args.pattern as string, workspace, { maxResults: args.max_results as number | undefined });
    case 'text_search':
      return textSearch(args.query as string, workspace, {
        pattern: args.pattern as string | undefined,
        isRegex: args.is_regex as boolean | undefined,
        caseSensitive: args.case_sensitive as boolean | undefined,
        contextLines: args.context_lines as number | undefined,
        maxMatches: args.max_matches as number | undefined,
      });
    default:
      return null;
  }
}
