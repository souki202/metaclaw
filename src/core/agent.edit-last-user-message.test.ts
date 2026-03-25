import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { Agent } from './agent.js';
import type { ChatMessage, Config, SessionConfig } from '../types.js';

function createSessionConfig(workspace: string): SessionConfig {
  return {
    name: 'test',
    provider: {
      endpoint: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      contextWindow: 128000,
    },
    workspace,
    restrictToWorkspace: true,
    allowSelfModify: false,
    tools: {
      exec: false,
      web: false,
      memory: false,
    },
  };
}

function writeHistory(sessionDir: string, history: ChatMessage[]) {
  fs.mkdirSync(sessionDir, { recursive: true });
  const historyPath = path.join(sessionDir, 'history.jsonl');
  const lines = history.map((message) =>
    JSON.stringify({ ...message, timestamp: new Date().toISOString() }),
  );
  fs.writeFileSync(historyPath, `${lines.join('\n')}\n`, 'utf-8');
}

test('resendEditedLastUserMessage cancels when authored text is unchanged', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaclaw-agent-edit-'));
  const sessionDir = path.join(tempDir, 'session');
  const sessionId = 'test-session';
  const sessionConfig = createSessionConfig(tempDir);
  const config: Config = {
    dashboard: { enabled: true, port: 3020 },
    sessions: { [sessionId]: sessionConfig },
  };

  writeHistory(sessionDir, [
    {
      role: 'user',
      content: '[[timestamp:old]] Original prompt\n\n## Attached Files\n### note.md\n```md\nhello\n```',
    },
    { role: 'assistant', content: 'Old reply' },
  ]);

  const agent = new Agent(sessionId, sessionConfig, sessionDir, tempDir, undefined, config);
  const providerChat = async () => {
    throw new Error('provider should not be called');
  };
  (agent as any).provider = { chat: providerChat };

  const result = await agent.resendEditedLastUserMessage(0, 'Original prompt', 'dashboard');

  assert.equal(result.cancelled, true);
  assert.equal(agent.getHistory().length, 2);

  await agent.stopMcpServers();
});

test('resendEditedLastUserMessage truncates later history and appends the new branch', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaclaw-agent-edit-'));
  const sessionDir = path.join(tempDir, 'session');
  const sessionId = 'test-session';
  const sessionConfig = createSessionConfig(tempDir);
  const config: Config = {
    dashboard: { enabled: true, port: 3020 },
    sessions: { [sessionId]: sessionConfig },
  };

  writeHistory(sessionDir, [
    {
      role: 'user',
      content: '[[timestamp:old]] Original prompt\n\n## Attached Files\n### note.md\n```md\nhello\n```',
    },
    { role: 'assistant', content: 'Old reply' },
    { role: 'tool', content: 'tool output', name: 'read_file', tool_call_id: 'tool-1' },
  ]);

  const agent = new Agent(sessionId, sessionConfig, sessionDir, tempDir, undefined, config);
  let capturedMessages: ChatMessage[] = [];
  (agent as any).provider = {
    chat: async (messages: ChatMessage[]) => {
      capturedMessages = messages;
      return { role: 'assistant', content: 'New reply' };
    },
  };

  const result = await agent.resendEditedLastUserMessage(0, 'Updated prompt', 'dashboard');

  assert.equal(result.cancelled, false);
  assert.equal(result.response, 'New reply');

  const history = agent.getHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].role, 'user');
  assert.ok(String(history[0].content).includes('Updated prompt'));
  assert.ok(String(history[0].content).includes('## Attached Files'));
  assert.equal(history[1].role, 'assistant');
  assert.equal(history[1].content, 'New reply');

  assert.equal(capturedMessages[1].role, 'user');
  assert.ok(String(capturedMessages[1].content).includes('Updated prompt'));
  assert.equal(capturedMessages.some((message) => message.content === 'Old reply'), false);

  const persisted = fs
    .readFileSync(path.join(sessionDir, 'history.jsonl'), 'utf-8')
    .trim()
    .split('\n');
  assert.equal(persisted.length, 2);

  await agent.stopMcpServers();
});

test('compression helpers keep tool call exchanges intact', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaclaw-agent-edit-'));
  const sessionDir = path.join(tempDir, 'session');
  const sessionId = 'test-session';
  const sessionConfig = createSessionConfig(tempDir);
  const config: Config = {
    dashboard: { enabled: true, port: 3020 },
    sessions: { [sessionId]: sessionConfig },
  };

  const agent = new Agent(sessionId, sessionConfig, sessionDir, tempDir, undefined, config);
  const toolHistory: ChatMessage[] = [
    { role: 'user', content: 'old request' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"README.md"}',
          },
        },
      ],
    },
    { role: 'tool', name: 'read_file', tool_call_id: 'call_1', content: 'file contents' },
    { role: 'assistant', content: 'final reply' },
  ];

  (agent as any).history = toolHistory;

  assert.equal((agent as any).getSafeCompressionCutIndex(2), 3);
  assert.equal((agent as any).getPrunableMessageCount(1), 2);

  (agent as any).history = [
    { role: 'tool', name: 'read_file', tool_call_id: 'orphan_1', content: 'orphan output 1' },
    { role: 'tool', name: 'search', tool_call_id: 'orphan_2', content: 'orphan output 2' },
    { role: 'assistant', content: 'recent reply' },
  ];

  assert.equal((agent as any).getPrunableMessageCount(0), 2);

  await agent.stopMcpServers();
});
