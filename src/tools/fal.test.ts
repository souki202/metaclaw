import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildTools, executeTool } from './index.js';
import type { ToolContext } from './context.js';

function createToolContext(rootDir: string): ToolContext {
  const workspace = path.join(rootDir, 'workspace');
  const sessionDir = path.join(rootDir, 'session');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  return {
    sessionId: 'test',
    workspace,
    sessionDir,
    config: {
      organizationId: 'default',
      name: 'Test Session',
      provider: {
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5-mini',
      },
      workspace,
      restrictToWorkspace: true,
      allowSelfModify: false,
      tools: {
        exec: false,
        web: false,
        memory: false,
      },
      falAi: {
        enabled: true,
        apiKey: 'fal_key_test',
        baseUrl: 'https://fal.run',
        defaultImageModel: 'fal-ai/gemini-3.1-flash-image-preview',
        defaultEditModel: 'fal-ai/gemini-3.1-flash-image-preview/edit',
        timeoutMs: 120000,
      },
    },
  };
}

test('buildTools exposes fal image tools when fal.ai is configured', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-claw-fal-tools-'));
  const ctx = createToolContext(rootDir);

  const tools = await buildTools(ctx);
  const names = tools.map((tool) => tool.function.name);

  assert.ok(names.includes('fal_generate_image'));
  assert.ok(names.includes('fal_edit_image'));
});

test('fal_generate_image saves generated images as session artifacts', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-claw-fal-generate-'));
  const ctx = createToolContext(rootDir);
  const originalFetch = globalThis.fetch;
  const generatedBytes = Buffer.from('generated-image');
  const generatedDataUrl = `data:image/png;base64,${generatedBytes.toString('base64')}`;
  let capturedBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(
      JSON.stringify({
        images: [
          {
            url: generatedDataUrl,
            content_type: 'image/png',
            width: 1024,
            height: 1024,
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as typeof fetch;

  try {
    const result = await executeTool('fal_generate_image', {
      prompt: 'a cinematic city skyline at sunset',
      aspect_ratio: '16:9',
      num_images: 1,
      seed: 42,
      output_format: 'png',
      additional_input: {
        expand_prompt: true,
      },
    }, ctx);

    assert.equal(result.success, true);
    assert.ok(capturedBody);
    assert.equal(capturedBody?.prompt, 'a cinematic city skyline at sunset');
    assert.equal(capturedBody?.aspect_ratio, '16:9');
    assert.equal(capturedBody?.num_images, 1);
    assert.equal(capturedBody?.seed, 42);
    assert.equal(capturedBody?.output_format, 'png');
    assert.equal(capturedBody?.expand_prompt, true);
    assert.equal(capturedBody?.sync_mode, true);
    assert.match(result.output, /Generated 1 image\(s\) with fal\.ai\./);
    assert.ok(result.imageUrl?.startsWith('/api/sessions/test/artifacts/generated-images/'));

    const savedFiles = fs.readdirSync(path.join(ctx.sessionDir, 'generated-images'));
    assert.equal(savedFiles.length, 1);
    assert.ok(savedFiles[0].endsWith('.png'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fal_edit_image resolves local session image URLs to data URIs before calling fal.ai', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-claw-fal-edit-'));
  const ctx = createToolContext(rootDir);
  const uploadsDir = path.join(ctx.sessionDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, 'source.png'), Buffer.from('source-image'));

  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;
  const editedDataUrl = `data:image/png;base64,${Buffer.from('edited-image').toString('base64')}`;

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(
      JSON.stringify({
        images: [
          {
            url: editedDataUrl,
            content_type: 'image/png',
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as typeof fetch;

  try {
    const result = await executeTool('fal_edit_image', {
      prompt: 'remove the background and keep only the subject',
      image_urls: ['/api/sessions/test/uploads/source.png'],
      aspect_ratio: '1:1',
    }, ctx);

    assert.equal(result.success, true);
    assert.ok(Array.isArray(capturedBody?.image_urls));
    assert.equal((capturedBody?.image_urls as string[]).length, 1);
    assert.match((capturedBody?.image_urls as string[])[0], /^data:image\/png;base64,/);
    assert.equal(capturedBody?.aspect_ratio, '1:1');
    assert.match(result.output, /Edited 1 image\(s\) with fal\.ai\./);

    const savedFiles = fs.readdirSync(path.join(ctx.sessionDir, 'generated-images'));
    assert.equal(savedFiles.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
