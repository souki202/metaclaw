import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { buildTools, executeTool } from './index.js';
import { executeMemoryTool } from './memory.js';
import { executeBrowserTool } from './browser.js';
import type { ToolContext } from './context.js';
import type { SessionSchedule } from '../types.js';
import { PtyManager } from './pty-manager.js';

test('schedule unified tool can create and list schedules', async () => {
  const schedules: SessionSchedule[] = [];
  const ctx = {
    sessionId: 's',
    config: { tools: { memory: true }, restrictToWorkspace: false } as any,
    workspace: process.cwd(),
    sessionDir: '',
    scheduleList: () => schedules,
    scheduleCreate: (input: any) => {
      const entry: SessionSchedule = {
        id: String(schedules.length + 1),
        sessionId: 's',
        startAt: input.startAt,
        repeatCron: input.repeatCron,
        memo: input.memo,
        nextRunAt: input.startAt,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      schedules.push(entry);
      return entry;
    },
    scheduleUpdate: (id: string, patch: any) => {
      const idx = schedules.findIndex((s) => s.id === id);
      const updated = { ...schedules[idx], ...patch };
      schedules[idx] = updated;
      return updated;
    },
    scheduleDelete: (id: string) => {
      const idx = schedules.findIndex((s) => s.id === id);
      if (idx === -1) return false;
      schedules.splice(idx, 1);
      return true;
    },
  } as ToolContext;

  const create = await executeMemoryTool('schedule', {
    action: 'create',
    startAt: '2026-01-01T00:00:00Z',
    repeatCron: 'none',
    memo: 'unified test',
  }, ctx);

  assert.equal(create!.success, true);
  assert.ok(create!.output.includes('Schedule created.'));
  assert.ok(create!.output.includes('memo: unified test'));

  const list = await executeMemoryTool('schedule', { action: 'list' }, ctx);
  assert.equal(list!.success, true);
  assert.ok(list!.output.includes('unified test'));
});

test('browser unified tool rejects unknown action without launching browser', async () => {
  const ctx = {
    sessionId: 's',
    config: { tools: { exec: true }, restrictToWorkspace: false } as any,
    workspace: process.cwd(),
    sessionDir: '/tmp',
  } as ToolContext;

  const result = await executeBrowserTool('browser', { type: 'unknown' }, ctx);
  assert.equal(result!.success, false);
  assert.ok(result!.output.includes('Unknown browser action'));
});

test('buildTools exposes terminal tools but not legacy exec', async () => {
  const ctx = {
    sessionId: 's',
    config: { tools: { exec: true }, restrictToWorkspace: false } as any,
    workspace: process.cwd(),
    sessionDir: '/tmp',
  } as ToolContext;

  const tools = await buildTools(ctx);
  const names = tools.map((tool) => tool.function.name);

  assert.ok(names.includes('terminal_exec'));
  assert.ok(names.includes('terminal_send_input'));
  assert.ok(!names.includes('exec'));
});

test('executeTool rejects legacy exec calls', async () => {
  const ctx = {
    sessionId: 's',
    config: { tools: { exec: true }, restrictToWorkspace: false } as any,
    workspace: process.cwd(),
    sessionDir: '/tmp',
  } as ToolContext;

  const result = await executeTool('exec', { command: 'echo test' }, ctx);

  assert.equal(result.success, false);
  assert.equal(result.output, 'Unknown tool: exec');
});

test('terminal_exec handles heredoc commands without corrupting subsequent shell state', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'metaclaw-terminal-'));
  const sessionId = `pty-heredoc-${Date.now()}`;
  const manager = PtyManager.getInstance();

  try {
    const first = await manager.execCommand(
      sessionId,
      workspace,
      "cat <<'EOF'\nhello from heredoc\nEOF",
      5000
    );

    assert.equal(first.exitCode, 0);
    assert.match(first.output, /hello from heredoc/);
    assert.doesNotMatch(first.output, /\[TIMEOUT\]/);

    const second = await manager.execCommand(sessionId, workspace, 'printf after-heredoc', 5000);

    assert.equal(second.exitCode, 0);
    assert.match(second.output, /after-heredoc/);
    assert.doesNotMatch(second.output, />\s*printf after-heredoc/);
  } finally {
    manager.kill(sessionId);
    await rm(workspace, { recursive: true, force: true });
  }
});
