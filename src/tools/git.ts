import { execFile } from 'child_process';
import type { ToolResult } from '../types.js';

const ROOT = process.cwd();
const GIT_TIMEOUT = 30_000;

/**
 * Run a git command in the project root and return the result.
 */
function gitExec(args: string[]): Promise<ToolResult> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: ROOT, timeout: GIT_TIMEOUT, maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
      if (err) {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        resolve({ success: false, output: output || err.message });
      } else {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        resolve({ success: true, output: output || '(no output)' });
      }
    });
  });
}

/** Show working tree status (porcelain format). */
export function gitStatus(): Promise<ToolResult> {
  return gitExec(['status', '--porcelain', '-b']);
}

/** Show unstaged changes. Optionally filter by path. */
export function gitDiff(filePath?: string): Promise<ToolResult> {
  const args = ['diff'];
  if (filePath) args.push('--', filePath);
  return gitExec(args);
}

/** Show staged changes. Optionally filter by path. */
export function gitDiffStaged(filePath?: string): Promise<ToolResult> {
  const args = ['diff', '--staged'];
  if (filePath) args.push('--', filePath);
  return gitExec(args);
}

/** Show recent commit history. */
export function gitLog(count?: number): Promise<ToolResult> {
  return gitExec(['log', '--oneline', `-${count ?? 20}`]);
}

/** Stage all changes and commit. */
export function gitCommit(message: string): Promise<ToolResult> {
  return new Promise(async (resolve) => {
    const addResult = await gitExec(['add', '-A']);
    if (!addResult.success) {
      resolve({ success: false, output: `git add failed: ${addResult.output}` });
      return;
    }
    const commitResult = await gitExec(['commit', '-m', message]);
    resolve(commitResult);
  });
}

/** List branches (local and remote). */
export function gitBranch(): Promise<ToolResult> {
  return gitExec(['branch', '-a']);
}

/** Checkout a branch or ref. */
export function gitCheckout(ref: string): Promise<ToolResult> {
  return gitExec(['checkout', ref]);
}

/** Stash management: push (default), pop, list, drop. */
export function gitStash(action?: string, message?: string): Promise<ToolResult> {
  const act = action ?? 'push';
  const validActions = ['push', 'pop', 'list', 'drop', 'apply', 'show'];
  if (!validActions.includes(act)) {
    return Promise.resolve({ success: false, output: `Invalid stash action: ${act}. Valid: ${validActions.join(', ')}` });
  }
  const args = ['stash', act];
  if (act === 'push' && message) {
    args.push('-m', message);
  }
  return gitExec(args);
}

/** Reset to a commit. mode: soft, mixed (default), or hard. */
export function gitReset(mode?: string, ref?: string): Promise<ToolResult> {
  const m = mode ?? 'mixed';
  const validModes = ['soft', 'mixed', 'hard'];
  if (!validModes.includes(m)) {
    return Promise.resolve({ success: false, output: `Invalid reset mode: ${m}. Valid: ${validModes.join(', ')}` });
  }
  const args = ['reset', `--${m}`];
  if (ref) args.push(ref);
  return gitExec(args);
}

/** Push to remote. */
export function gitPush(remote?: string, branch?: string): Promise<ToolResult> {
  const args = ['push'];
  if (remote) args.push(remote);
  if (branch) args.push(branch);
  return gitExec(args);
}

/** Pull from remote. */
export function gitPull(remote?: string, branch?: string): Promise<ToolResult> {
  const args = ['pull'];
  if (remote) args.push(remote);
  if (branch) args.push(branch);
  return gitExec(args);
}
