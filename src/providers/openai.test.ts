import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from './openai.js';
import type { ChatMessage, ProviderConfig, ToolDefinition } from '../types.js';

const baseConfig: ProviderConfig = {
  endpoint: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  model: 'gpt-5-mini',
};

function makeProvider(): OpenAIProvider {
  return new OpenAIProvider(baseConfig);
}

test('chat uses responses.create and maps tools and multimodal messages', async () => {
  const provider = makeProvider() as any;
  let capturedParams: any;

  provider.client = {
    responses: {
      create: async (params: any) => {
        capturedParams = params;
        return {
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'done' }],
            },
            {
              type: 'function_call',
              call_id: 'call_abc',
              name: 'read_file',
              arguments: '{"path":"README.md"}',
            },
          ],
        };
      },
    },
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    },
  };

  const messages: ChatMessage[] = [
    { role: 'system', content: 'system prompt' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'check image' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc', detail: 'high' } },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'call_prev',
      name: 'read_file',
      content: [
        { type: 'text', text: '{"ok":true}' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,toolimg', detail: 'high' } },
      ],
    },
  ];

  const tools: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    },
  ];

  const result = await provider.chat(messages, tools);

  assert.equal(result.role, 'assistant');
  assert.equal(result.content, 'done');
  assert.equal(result.tool_calls?.length, 1);
  assert.equal(result.tool_calls?.[0].id, 'call_abc');
  assert.equal(result.tool_calls?.[0].function.name, 'read_file');

  assert.equal(capturedParams.model, baseConfig.model);
  assert.ok(Array.isArray(capturedParams.input));
  assert.ok(capturedParams.input.some((i: any) => i.type === 'function_call_output' && i.call_id === 'call_prev'));
  const toolOutput = capturedParams.input.find((i: any) => i.type === 'function_call_output' && i.call_id === 'call_prev');
  assert.equal(typeof toolOutput.output, 'string');
  const parsedToolOutput = JSON.parse(toolOutput.output);
  assert.equal(parsedToolOutput.text, '{"ok":true}');
  assert.equal(parsedToolOutput.images[0].image_url, 'data:image/png;base64,toolimg');
  assert.ok(capturedParams.input.some((i: any) => i.role === 'user'));
  assert.ok(Array.isArray(capturedParams.tools));
  assert.equal(capturedParams.tools[0].name, 'read_file');
  const assistantInput = capturedParams.input.find((i: any) => i.role === 'assistant');
  assert.equal(assistantInput, undefined);
});

test('chat omits empty assistant content when tool_calls exist and preserves function_call/function_call_output ordering', async () => {
  const provider = makeProvider() as any;
  let capturedParams: any;

  provider.client = {
    responses: {
      create: async (params: any) => {
        capturedParams = params;
        return { output_text: 'ok' };
      },
    },
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    },
  };

  const messages: ChatMessage[] = [
    { role: 'user', content: 'search please' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_web_1',
          type: 'function',
          function: {
            name: 'web_search',
            arguments: '{"query":"Qwen3.5 35b a3b vs 27b"}',
          },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'call_web_1',
      name: 'web_search',
      content: 'result snippet',
    },
  ];

  const result = await provider.chat(messages, []);
  assert.equal(result.role, 'assistant');

  const assistantItems = capturedParams.input.filter((i: any) => i.role === 'assistant');
  assert.equal(assistantItems.length, 0);

  const functionCallItem = capturedParams.input.find((i: any) => i.type === 'function_call');
  const functionCallOutputItem = capturedParams.input.find((i: any) => i.type === 'function_call_output');

  assert.equal(functionCallItem.call_id, 'call_web_1');
  assert.equal(functionCallOutputItem.call_id, 'call_web_1');
});

test('chat falls back to assistant text for tool message missing tool_call_id', async () => {
  const provider = makeProvider() as any;
  let capturedParams: any;

  provider.client = {
    responses: {
      create: async (params: any) => {
        capturedParams = params;
        return { output_text: 'ok' };
      },
    },
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    },
  };

  await provider.chat([
    { role: 'user', content: 'hello' },
    { role: 'tool', name: 'web_search', content: 'legacy tool output without call id' },
  ], []);

  const functionCallOutputItems = capturedParams.input.filter((i: any) => i.type === 'function_call_output');
  assert.equal(functionCallOutputItems.length, 0);

  const assistantItems = capturedParams.input.filter((i: any) => i.role === 'assistant');
  assert.equal(assistantItems.length, 1);
  assert.equal(assistantItems[0].content[0].type, 'input_text');
});

test('chat streams output_text deltas via responses.stream', async () => {
  const provider = makeProvider() as any;

  provider.client = {
    responses: {
      stream: () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'response.output_text.delta', delta: 'Hel' };
          yield { type: 'response.output_text.delta', delta: 'lo' };
        },
        finalResponse: async () => ({
          output: [
            {
              type: 'function_call',
              call_id: 'call_stream',
              name: 'search',
              arguments: '{"q":"test"}',
            },
          ],
        }),
      }),
    },
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    },
  };

  const chunks: string[] = [];
  const result = await provider.chat([{ role: 'user', content: 'hello' }], [], (chunk: string) => {
    chunks.push(chunk);
  });

  assert.equal(chunks.join(''), 'Hello');
  assert.equal(result.content, 'Hello');
  assert.equal(result.tool_calls?.[0].id, 'call_stream');
  assert.equal(result.tool_calls?.[0].function.name, 'search');
});

test('summarize uses responses API', async () => {
  const provider = makeProvider() as any;
  let capturedParams: any;

  provider.client = {
    responses: {
      create: async (params: any) => {
        capturedParams = params;
        return { output_text: 'short summary' };
      },
    },
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    },
  };

  const summary = await provider.summarize([
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'second' },
  ]);

  assert.equal(summary, 'short summary');
  assert.equal(capturedParams.model, baseConfig.model);
  assert.ok(Array.isArray(capturedParams.input));
  assert.equal(capturedParams.input[0].role, 'system');
  assert.equal(capturedParams.input[1].role, 'user');
});

test('summarizeText allows model override', async () => {
  const provider = makeProvider() as any;
  let capturedParams: any;

  provider.client = {
    responses: {
      create: async (params: any) => {
        capturedParams = params;
        return { output_text: 'compressed recall' };
      },
    },
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    },
  };

  const result = await provider.summarizeText('raw memory corpus', {
    model: 'gpt-4.1-mini',
    systemPrompt: 'compress to keywords',
  });

  assert.equal(result, 'compressed recall');
  assert.equal(capturedParams.model, 'gpt-4.1-mini');
  assert.equal(capturedParams.input[0].role, 'system');
  assert.equal(capturedParams.input[1].role, 'user');
});
