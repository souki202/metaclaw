import test from 'node:test';
import assert from 'node:assert/strict';
import { gitCommand } from './git.js';

test('gitCommand runs status via unified entry', async () => {
  const result = await gitCommand('status');
  assert.strictEqual(result.success, true);
  assert.ok(result.output.length > 0);
});

test('gitCommand forwards arbitrary git subcommands', async () => {
  const result = await gitCommand('rev-parse', ['--is-inside-work-tree']);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.output.trim(), 'true');
});
