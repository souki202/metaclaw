import test from 'node:test';
import assert from 'node:assert/strict';
import { executeMemoryTool } from './memory.js';
import { executeBrowserTool } from './browser.js';
import type { ToolContext } from './context.js';
import type { SessionSchedule } from '../types.js';

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
        startAt: input.startAt,
        repeatCron: input.repeatCron,
        memo: input.memo,
        nextRunAt: input.startAt,
        enabled: true,
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

  assert.equal(create.success, true);
  assert.ok(create.output.includes('Schedule created.'));
  assert.ok(create.output.includes('memo: unified test'));

  const list = await executeMemoryTool('schedule', { action: 'list' }, ctx);
  assert.equal(list.success, true);
  assert.ok(list.output.includes('unified test'));
});

test('browser unified tool rejects unknown action without launching browser', async () => {
  const ctx = {
    sessionId: 's',
    config: { tools: { exec: true }, restrictToWorkspace: false } as any,
    workspace: process.cwd(),
    sessionDir: '/tmp',
  } as ToolContext;

  const result = await executeBrowserTool('browser', { type: 'unknown' }, ctx);
  assert.equal(result.success, false);
  assert.ok(result.output.includes('Unknown browser action'));
});
