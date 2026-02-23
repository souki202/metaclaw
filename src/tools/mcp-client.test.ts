import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { McpClientManager } from './mcp-client.js';
import type { SearchConfig } from '../types.js';

test('built-in consult MCP server exposes tool and sends base64 images', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  const imagePath = path.join(workspace, 'image.png');
  fs.writeFileSync(imagePath, 'pngdata');

  const searchConfig: SearchConfig = { provider: 'brave', braveApiKey: 'brave-key' };
  const manager = new McpClientManager(searchConfig, workspace);

    const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string, options?: any) => {
    calls.push({
      url,
      body: options?.body ? JSON.parse(options.body) : null,
      headers: options?.headers || {},
    });
    const response = {
      ok: true,
      status: 200,
      async json() {
        return { text: 'ok' };
      },
      async text() {
        return 'ok';
      },
    } as any;
    response.clone = () => response;
    return response;
  }) as any;

  try {
    await manager.startServer('consult-ai', {
      type: 'builtin-consult',
      endpointUrl: 'https://example.com/ai',
      apiKey: 'abc',
      model: 'gpt-test',
    });

    const tools = await manager.getAllTools();
    const toolNames = tools.map((t) => t.function.name);
    assert.ok(toolNames.includes('mcp_consult-ai_consult_ai'));

    const result = await manager.routeToolCall('mcp_consult-ai_consult_ai', {
      prompt: 'Hello world',
      image_url: 'image.png',
    } as any);

    assert.ok(result && result.success);
    assert.equal(result?.output, 'ok');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.com/ai');
    assert.equal(calls[0].headers.Authorization, 'Bearer abc');
    assert.equal(calls[0].body.prompt, 'Hello world');
    assert.deepEqual(calls[0].body.search, searchConfig);
    assert.equal(calls[0].body.model, 'gpt-test');
    assert.ok(typeof calls[0].body.image === 'string');
    assert.ok(calls[0].body.image.startsWith('data:image/png;base64,'));
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
