import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

import { buildAgentSystemPrompt, normalizeAssistantContent, rewriteImageUrlsForUser, toPublicImageUrl } from './agent-helpers.js';
import type { ContentPart, SessionConfig } from '../types.js';

function createSessionConfig(): SessionConfig {
  return {
    name: 'test',
    provider: {
      endpoint: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
    },
    workspace: '/workspace',
    restrictToWorkspace: true,
    allowSelfModify: false,
    tools: {
      exec: false,
      web: false,
      memory: true,
    },
  };
}

test('buildAgentSystemPrompt keeps core sections and connected MCP server list', () => {
  const prompt = buildAgentSystemPrompt({
    sessionId: 'agent-1',
    workspace: '/workspace',
    config: createSessionConfig(),
    identity: 'I am agent one.',
    soul: 'Be helpful.',
    user: 'User likes concise answers.',
    memory: 'Remember the deployment path.',
    tmpMemory: 'Short-lived note.',
    recalledMemories: 'Past task summary',
    mcpStates: [
      { id: 'docs', status: 'connected', toolCount: 2 },
      { id: 'empty', status: 'connected', toolCount: 0 },
      { id: 'offline', status: 'disconnected', toolCount: 3 },
    ],
  });

  assert.ok(prompt.includes('Session ID: agent-1'));
  assert.ok(prompt.includes('## Your Identity\nI am agent one.'));
  assert.ok(prompt.includes('## Recalled Conversation History'));
  assert.ok(prompt.includes('Workspace restriction: ENABLED'));
  assert.ok(prompt.includes('- **docs** — Tool names are prefixed with `mcp_docs_`'));
  assert.equal(prompt.includes('empty'), false);
  assert.equal(prompt.includes('offline'), false);
});

test('toPublicImageUrl maps session-local paths to artifact URLs', () => {
  const sessionDir = path.join('/tmp', 'metaclaw-session');

  assert.equal(
    toPublicImageUrl(path.join(sessionDir, 'generated-images', 'chart 1.png'), {
      sessionId: 'agent-1',
      sessionDir,
    }),
    '/api/sessions/agent-1/artifacts/generated-images/chart%201.png',
  );

  assert.equal(
    toPublicImageUrl('uploads/report.png', {
      sessionId: 'agent-1',
      sessionDir,
    }),
    '/api/sessions/agent-1/artifacts/uploads/report.png',
  );
});

test('rewriteImageUrlsForUser rewrites markdown and bare artifact paths', () => {
  const sessionDir = path.join('/tmp', 'metaclaw-session');
  const text = [
    'See ![graph](uploads/chart.png)',
    'and [notes](./screenshots/run 1.png)',
    'plus uploads/raw.log.png',
  ].join(' ');

  const rewritten = rewriteImageUrlsForUser(text, {
    sessionId: 'agent-1',
    sessionDir,
  });

  assert.ok(rewritten.includes('![graph](/api/sessions/agent-1/artifacts/uploads/chart.png)'));
  assert.ok(rewritten.includes('[notes](/api/sessions/agent-1/artifacts/screenshots/run%201.png)'));
  assert.ok(rewritten.includes('/api/sessions/agent-1/artifacts/uploads/raw.log.png'));
});

test('normalizeAssistantContent rewrites string and image parts', () => {
  const sessionDir = path.join('/tmp', 'metaclaw-session');
  const content: ContentPart[] = [
    { type: 'text', text: 'Image: ![preview](uploads/preview.png)' },
    { type: 'image_url', image_url: { url: 'generated-images/preview 1.png', detail: 'high' } },
  ];

  const normalized = normalizeAssistantContent(content, {
    sessionId: 'agent-1',
    sessionDir,
  }) as ContentPart[];

  assert.equal(normalized[0].type, 'text');
  assert.ok((normalized[0] as Extract<ContentPart, { type: 'text'; }>).text.includes('/api/sessions/agent-1/artifacts/uploads/preview.png'));
  assert.equal(
    (normalized[1] as Extract<ContentPart, { type: 'image_url'; }>).image_url.url,
    '/api/sessions/agent-1/artifacts/generated-images/preview%201.png',
  );
});
