import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from './agent.js';
import type { Config, SessionConfig } from '../types.js';

function createSessionConfig(workspace: string): SessionConfig {
  return {
    name: 'test',
    provider: {
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: 'test-key',
      model: 'openai/gpt-4o-mini',
      contextWindow: 128000,
    },
    workspace,
    restrictToWorkspace: true,
    allowSelfModify: false,
    tools: {
      exec: false,
      web: false,
      memory: true,
    },
  };
}

test('agent applies embedding config updates without restart', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaclaw-agent-'));
  const sessionDir = path.join(tempDir, 'session');
  fs.mkdirSync(sessionDir, { recursive: true });

  const sessionId = 'test-session';
  const sessionConfig = createSessionConfig(tempDir);
  const baseConfig: Config = {
    dashboard: { enabled: true, port: 3020 },
    sessions: { [sessionId]: sessionConfig },
  };

  const agent = new Agent(sessionId, sessionConfig, sessionDir, tempDir, undefined, baseConfig);

  assert.equal((agent as any).vectorMemory, null);

  const withEmbedding: Config = {
    ...baseConfig,
    embedding: {
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: 'embedding-key',
      model: 'text-embedding-3-small',
    },
  };

  agent.updateGlobalConfig(withEmbedding);
  assert.ok((agent as any).vectorMemory);

  agent.updateGlobalConfig(baseConfig);
  assert.equal((agent as any).vectorMemory, null);

  await agent.stopMcpServers();
});