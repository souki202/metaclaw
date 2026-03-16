import fs from 'fs';
import path from 'path';
import type { FalAiConfig, ToolDefinition, ToolResult } from '../types.js';
import type { ToolContext } from './context.js';
import {
  DEFAULT_FAL_BASE_URL,
  DEFAULT_FAL_EDIT_MODEL,
  DEFAULT_FAL_IMAGE_MODEL,
  DEFAULT_FAL_TIMEOUT_MS,
} from '../config.js';

const FAL_GENERATE_TOOL = 'fal_generate_image';
const FAL_EDIT_TOOL = 'fal_edit_image';
const MAX_PREVIEW_BYTES = 1024 * 1024;
const ASPECT_RATIO_ENUM = ['21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:21'];
const OUTPUT_FORMAT_ENUM = ['jpeg', 'png'];

type FalOutputImage = {
  url?: string;
  content_type?: string;
  file_name?: string;
  width?: number;
  height?: number;
};

type PersistedImage = {
  publicUrl: string;
  relativePath: string;
  previewDataUrl?: string;
  width?: number;
  height?: number;
};

function getFalConfig(ctx: ToolContext): FalAiConfig | null {
  const configured = ctx.falAiConfig || ctx.config.falAi;
  if (!configured || configured.enabled === false || !configured.apiKey) {
    return null;
  }

  return {
    enabled: true,
    apiKey: configured.apiKey,
    baseUrl: configured.baseUrl || DEFAULT_FAL_BASE_URL,
    defaultImageModel: configured.defaultImageModel || DEFAULT_FAL_IMAGE_MODEL,
    defaultEditModel: configured.defaultEditModel || DEFAULT_FAL_EDIT_MODEL,
    timeoutMs: configured.timeoutMs || DEFAULT_FAL_TIMEOUT_MS,
  };
}

function sanitizeModelId(model: string): string {
  return model.trim().replace(/^\/+|\/+$/g, '');
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'image';
}

function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

function extFromMime(mime?: string): string {
  switch ((mime || '').toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'png';
  }
}

function parseDataUri(dataUri: string): { mime: string; bytes: Buffer; } | null {
  const match = dataUri.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  try {
    return {
      mime: match[1],
      bytes: Buffer.from(match[2], 'base64'),
    };
  } catch {
    return null;
  }
}

function toDataUri(bytes: Buffer, mime: string): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function resolveLocalApiPath(ref: string, ctx: ToolContext): string | null {
  const trimmed = ref.trim();
  let pathname = trimmed;

  try {
    pathname = new URL(trimmed).pathname;
  } catch {
    pathname = trimmed;
  }

  const parts = pathname.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });

  if (parts.length < 5 || parts[0] !== 'api' || parts[1] !== 'sessions') {
    return null;
  }

  const sessionId = parts[2];
  const routeType = parts[3];
  const sessionDir = sessionId === ctx.sessionId
    ? ctx.sessionDir
    : path.join(process.cwd(), 'data', 'sessions', sessionId);

  if (routeType === 'artifacts') {
    const artifactPath = parts.slice(4);
    if (artifactPath.length === 0) return null;
    return path.join(sessionDir, ...artifactPath);
  }

  if (routeType === 'images' && parts[4]) {
    return path.join(sessionDir, 'screenshots', parts[4]);
  }

  if (routeType === 'uploads' && parts[4]) {
    return path.join(sessionDir, 'uploads', parts[4]);
  }

  return null;
}

function resolveFileRef(ref: string, ctx: ToolContext): string | null {
  if (!ref) return null;

  const apiLocalPath = resolveLocalApiPath(ref, ctx);
  if (apiLocalPath) {
    return apiLocalPath;
  }

  if (ref.startsWith('file://')) {
    try {
      return new URL(ref).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(ref) || ref.startsWith('data:')) {
    return null;
  }

  const direct = path.isAbsolute(ref)
    ? ref
    : path.resolve(ctx.workspace, ref);

  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return direct;
  }

  const sessionRelative = path.resolve(ctx.sessionDir, ref);
  if (fs.existsSync(sessionRelative) && fs.statSync(sessionRelative).isFile()) {
    return sessionRelative;
  }

  return null;
}

async function resolveImageRef(ref: string, ctx: ToolContext): Promise<string> {
  if (!ref || typeof ref !== 'string') {
    throw new Error('Image reference must be a string.');
  }

  if (ref.startsWith('data:')) {
    return ref;
  }

  const localPath = resolveFileRef(ref, ctx);
  if (localPath) {
    const bytes = fs.readFileSync(localPath);
    const mime = mimeFromExt(path.extname(localPath));
    return toDataUri(bytes, mime);
  }

  return ref;
}

async function fetchFalJson(
  modelId: string,
  input: Record<string, unknown>,
  config: FalAiConfig
): Promise<Record<string, unknown>> {
  const response = await fetch(`${(config.baseUrl || DEFAULT_FAL_BASE_URL).replace(/\/+$/, '')}/${sanitizeModelId(modelId)}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...input,
      sync_mode: true,
    }),
    signal: AbortSignal.timeout(config.timeoutMs || DEFAULT_FAL_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`fal.ai request failed (${response.status}): ${body || response.statusText}`);
  }

  return await response.json() as Record<string, unknown>;
}

async function persistFalImages(
  images: FalOutputImage[],
  modelId: string,
  ctx: ToolContext
): Promise<PersistedImage[]> {
  const outputDir = path.join(ctx.sessionDir, 'generated-images');
  fs.mkdirSync(outputDir, { recursive: true });

  const persisted: PersistedImage[] = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    if (!image.url) continue;

    let bytes: Buffer | null = null;
    let mime = image.content_type || '';
    let previewDataUrl: string | undefined;

    if (image.url.startsWith('data:')) {
      const parsed = parseDataUri(image.url);
      if (!parsed) continue;
      bytes = parsed.bytes;
      mime = mime || parsed.mime;
      if (bytes.length <= MAX_PREVIEW_BYTES) {
        previewDataUrl = image.url;
      }
    } else {
      const response = await fetch(image.url, {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        throw new Error(`Failed to download fal.ai output image (${response.status}): ${response.statusText}`);
      }
      bytes = Buffer.from(await response.arrayBuffer());
      mime = mime || response.headers.get('content-type') || 'image/png';
      if (bytes.length <= MAX_PREVIEW_BYTES) {
        previewDataUrl = toDataUri(bytes, mime);
      }
    }

    const ext = extFromMime(mime);
    const filename = `${Date.now()}_${i}_${sanitizeFilenamePart(modelId)}.${ext}`;
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, bytes);

    persisted.push({
      publicUrl: `/api/sessions/${ctx.sessionId}/artifacts/generated-images/${encodeURIComponent(filename)}`,
      relativePath: `generated-images/${filename}`,
      previewDataUrl,
      width: image.width,
      height: image.height,
    });
  }

  return persisted;
}

function normalizeAdditionalInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

async function runFalTool(
  mode: 'generate' | 'edit',
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const falConfig = getFalConfig(ctx);
  if (!falConfig) {
    return {
      success: false,
      output: 'fal.ai is not configured globally. Set config.falAi.enabled=true and provide config.falAi.apiKey.',
    };
  }

  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) {
    return { success: false, output: 'prompt is required.' };
  }

  const modelId = sanitizeModelId(
    typeof args.model === 'string' && args.model.trim().length > 0
      ? args.model
      : mode === 'edit'
        ? (falConfig.defaultEditModel || DEFAULT_FAL_EDIT_MODEL)
        : (falConfig.defaultImageModel || DEFAULT_FAL_IMAGE_MODEL)
  );

  const requestInput: Record<string, unknown> = {
    ...normalizeAdditionalInput(args.additional_input),
    prompt,
  };

  if (typeof args.aspect_ratio === 'string' && args.aspect_ratio.trim()) {
    requestInput.aspect_ratio = args.aspect_ratio.trim();
  }
  if (typeof args.num_images === 'number' && Number.isFinite(args.num_images)) {
    requestInput.num_images = args.num_images;
  }
  if (typeof args.seed === 'number' && Number.isFinite(args.seed)) {
    requestInput.seed = args.seed;
  }
  if (typeof args.output_format === 'string' && args.output_format.trim()) {
    requestInput.output_format = args.output_format.trim();
  }
  if (typeof args.safety_tolerance === 'number' && Number.isFinite(args.safety_tolerance)) {
    requestInput.safety_tolerance = args.safety_tolerance;
  }

  if (mode === 'edit') {
    const rawImageUrls = Array.isArray(args.image_urls)
      ? args.image_urls.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];

    if (rawImageUrls.length === 0) {
      return { success: false, output: 'image_urls is required for image editing.' };
    }

    requestInput.image_urls = await Promise.all(rawImageUrls.map((ref) => resolveImageRef(ref, ctx)));
  }

  const responseJson = await fetchFalJson(modelId, requestInput, falConfig);
  const images = Array.isArray(responseJson.images)
    ? responseJson.images.filter((value): value is FalOutputImage => !!value && typeof value === 'object')
    : [];

  if (images.length === 0) {
    return {
      success: false,
      output: `fal.ai returned no images for model "${modelId}". Raw response: ${JSON.stringify(responseJson).slice(0, 4000)}`,
    };
  }

  const persisted = await persistFalImages(images, modelId, ctx);
  if (persisted.length === 0) {
    return {
      success: false,
      output: `fal.ai produced image metadata but no savable image payloads for model "${modelId}".`,
    };
  }

  const settingLines = [
    `Model: \`${modelId}\``,
    requestInput.aspect_ratio ? `Aspect ratio: \`${requestInput.aspect_ratio}\`` : null,
    requestInput.num_images ? `Number of images: \`${requestInput.num_images}\`` : null,
    requestInput.seed ? `Seed: \`${requestInput.seed}\`` : null,
    requestInput.output_format ? `Output format: \`${requestInput.output_format}\`` : null,
    requestInput.safety_tolerance ? `Safety tolerance: \`${requestInput.safety_tolerance}\`` : null,
  ].filter((line): line is string => Boolean(line));

  const imageMarkdown = persisted
    .map((image, index) => `![fal image ${index + 1}](${image.publicUrl})`)
    .join('\n\n');

  const summary = [
    mode === 'edit'
      ? `Edited ${persisted.length} image(s) with fal.ai.`
      : `Generated ${persisted.length} image(s) with fal.ai.`,
    ...settingLines,
    '',
    'Use the Markdown images below when showing the result to the user.',
    imageMarkdown,
  ].join('\n');

  return {
    success: true,
    output: summary,
    imageUrl: persisted[0].publicUrl,
    image: persisted[0].previewDataUrl,
  };
}

export function buildFalTools(ctx: ToolContext): ToolDefinition[] {
  if (!getFalConfig(ctx)) return [];

  const sharedProperties = {
    prompt: { type: 'string', description: 'Detailed prompt describing the image to generate or edit.' },
    model: { type: 'string', description: 'Optional fal.ai model ID override. Defaults to the session falAi model.' },
    aspect_ratio: {
      type: 'string',
      enum: ASPECT_RATIO_ENUM,
      description: 'Common aspect ratio setting supported by many fal.ai image models.',
    },
    num_images: { type: 'number', description: 'Number of images to request when the model supports it.' },
    seed: { type: 'number', description: 'Optional seed for reproducible generations.' },
    output_format: {
      type: 'string',
      enum: OUTPUT_FORMAT_ENUM,
      description: 'Requested output image format when supported by the model.',
    },
    safety_tolerance: { type: 'number', description: 'Optional moderation/safety tolerance level for compatible models.' },
    additional_input: {
      type: 'object',
      description: 'Optional model-specific fal.ai input fields to merge into the request body.',
      additionalProperties: true,
    },
  } as const;

  return [
    {
      type: 'function',
      function: {
        name: FAL_GENERATE_TOOL,
        description: 'Generate images through fal.ai using the session default model or an explicitly provided fal model ID. Use this when the current chat model cannot generate images natively.',
        parameters: {
          type: 'object',
          properties: sharedProperties,
          required: ['prompt'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: FAL_EDIT_TOOL,
        description: 'Edit one or more images through fal.ai. image_urls can be dashboard upload URLs, session artifact URLs, local workspace/session file paths, data URLs, or public https URLs.',
        parameters: {
          type: 'object',
          properties: {
            ...sharedProperties,
            image_urls: {
              type: 'array',
              items: { type: 'string' },
              description: 'Input image references to edit.',
            },
          },
          required: ['prompt', 'image_urls'],
        },
      },
    },
  ];
}

export async function executeFalTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult | null> {
  switch (name) {
    case FAL_GENERATE_TOOL:
      return runFalTool('generate', args, ctx);
    case FAL_EDIT_TOOL:
      return runFalTool('edit', args, ctx);
    default:
      return null;
  }
}
