import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import * as McpClientModule from './mcp-client.js';
const { McpClientManager } = McpClientModule;
import type { SearchConfig } from '../types.js';

let capturedParams: any;

test('built-in consult MCP server exposes tool and sends base64 images', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  const imagePath = path.join(workspace, 'image.png');
  fs.writeFileSync(imagePath, 'pngdata');

  const searchConfig: SearchConfig = { provider: 'brave', braveApiKey: 'brave-key' };
  const manager = new McpClientManager(searchConfig, workspace);

  // Mock createOpenAIClient static method
  mock.method(McpClientManager, 'createOpenAIClient', () => {
    return {
      responses: {
        create: async (params: any) => {
          capturedParams = params;
          return {
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: 'ok' }],
              },
            ],
          };
        },
      },
    } as any;
  });

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

    if (!result || !result.success) {
      console.error('Tool call failed:', result);
    }
    assert.ok(result && result.success);
    assert.equal(result?.output, 'ok');
    assert.ok(capturedParams);
    assert.equal(capturedParams.model, 'gpt-test');
    assert.equal(capturedParams.input.length, 2);
    assert.equal(capturedParams.input[0].role, 'system');
    assert.equal(capturedParams.input[1].role, 'user');
    
    const userContent = capturedParams.input[1].content;
    assert.ok(Array.isArray(userContent));
    assert.equal(userContent[0].text, 'Hello world');
    assert.ok(userContent[1].image_url.startsWith('data:image/png;base64,'));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
