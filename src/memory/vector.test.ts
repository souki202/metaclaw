import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { VectorMemory } from './vector.js';

class MockEmbedder {
  async embed(text: string): Promise<number[]> {
    const t = text.toLowerCase();
    return [
      /deploy|pipeline|release/.test(t) ? 1 : 0,
      /error|fail|failed|timeout|exception/.test(t) ? 1 : 0,
      /remember|todo|important|budget/.test(t) ? 1 : 0,
      Math.min(1, t.length / 2000),
    ];
  }
}

test('humanLikeRecall uses multi-cue retrieval and ranks relevant memory first', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'metaclaw-vector-'));
  const memory = new VectorMemory(workspace, 'session-a', new MockEmbedder());

  await memory.add('Deploy pipeline failed with timeout while publishing release', {
    timestamp: '2026-01-01T00:00:00.000Z',
    role: 'tool',
    type: 'auto',
    salience: 0.95,
  });
  await memory.add('User likes coffee in the morning', {
    timestamp: '2026-02-20T00:00:00.000Z',
    role: 'user',
    type: 'auto',
    salience: 0.2,
  });

  const recalled = await memory.humanLikeRecall(
    ['deploy timeout', 'pipeline release error'],
    { limit: 2, minSimilarity: 0.1, decayRate: 0.01 }
  );

  assert.ok(recalled.length > 0);
  assert.match(recalled[0].entry.text, /Deploy pipeline failed/);
});

test('humanLikeRecall updates recall metadata by default', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'metaclaw-vector-'));
  const memory = new VectorMemory(workspace, 'session-b', new MockEmbedder());

  const id = await memory.add('Remember budget threshold for hosting costs', {
    role: 'assistant',
    type: 'manual',
    salience: 0.8,
  });

  await memory.humanLikeRecall(['budget reminder'], { limit: 1, minSimilarity: 0.1 });

  const touched = memory.list(10).find(entry => entry.id === id);
  assert.ok(touched);
  assert.equal(touched!.metadata.recallCount, 1);
  assert.ok(touched!.metadata.lastRecalledAt);

  await memory.humanLikeRecall(['budget reminder'], { limit: 1, minSimilarity: 0.1, markAsRecalled: false });
  const unchanged = memory.list(10).find(entry => entry.id === id);
  assert.equal(unchanged!.metadata.recallCount, 1);
});

test('autoAdd keeps each memory entry within 8000 characters', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'metaclaw-vector-'));
  const memory = new VectorMemory(workspace, 'session-c', new MockEmbedder());

  await memory.autoAdd({ role: 'user', content: 'x'.repeat(9000) });

  const latest = memory.list(1)[0];
  assert.ok(latest);
  assert.equal(latest.metadata.role, 'user');
  assert.ok(latest.text.length <= 8000);
});