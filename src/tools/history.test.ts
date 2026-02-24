import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, type ToolContext } from './index.js';

test('clear_history tool should call clearHistory callback in ToolContext', async () => {
  const clearHistoryMock = mock.fn(() => {});
  const ctx: Partial<ToolContext> = {
    sessionId: 'test-session',
    workspace: 'test-workspace',
    config: {
      name: 'test',
      provider: { endpoint: '', apiKey: '', model: '' },
      workspace: 'test-workspace',
      restrictToWorkspace: false,
      allowSelfModify: false,
      tools: { exec: false, web: false, memory: false },
    },
    clearHistory: clearHistoryMock as unknown as () => void,
  };

  const result = await executeTool('clear_history', {}, ctx as ToolContext);

  assert.strictEqual(result.success, true);
  assert.ok(result.output.includes('Conversation history deleted'));
  assert.strictEqual(clearHistoryMock.mock.callCount(), 1);
});

test('clear_history tool should return failure if clearHistory callback is not provided', async () => {
  const ctx: Partial<ToolContext> = {
    sessionId: 'test-session',
    workspace: 'test-workspace',
    config: {
      name: 'test',
      provider: { endpoint: '', apiKey: '', model: '' },
      workspace: 'test-workspace',
      restrictToWorkspace: false,
      allowSelfModify: false,
      tools: { exec: false, web: false, memory: false },
    },
    // clearHistory is missing
  };

  const result = await executeTool('clear_history', {}, ctx as ToolContext);

  assert.strictEqual(result.success, false);
  assert.ok(result.output.includes('tool not available'));
});
