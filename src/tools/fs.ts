import fs from 'fs';
import path from 'path';
import type { ToolResult } from '../types.js';

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
    if (!content.includes(oldString)) return { success: false, output: 'Old string not found in file.' };
    const updated = content.replace(oldString, newString);
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
