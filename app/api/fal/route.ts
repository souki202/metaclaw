import { NextResponse } from 'next/server';
import { getConfigSafe, getSessionManagerSafe, handleError } from '../helpers';
import { DEFAULT_FAL_BASE_URL, DEFAULT_FAL_EDIT_MODEL, DEFAULT_FAL_IMAGE_MODEL, DEFAULT_FAL_TIMEOUT_MS, saveConfig, setFalConfig } from '../../../src/config';
import type { FalAiConfig } from '../../../src/types';

export async function GET() {
  try {
    const config = getConfigSafe();
    const falAi = config.falAi || {
      enabled: false,
      apiKey: '',
      baseUrl: DEFAULT_FAL_BASE_URL,
      defaultImageModel: DEFAULT_FAL_IMAGE_MODEL,
      defaultEditModel: DEFAULT_FAL_EDIT_MODEL,
      timeoutMs: DEFAULT_FAL_TIMEOUT_MS,
    };

    return NextResponse.json({
      enabled: falAi.enabled !== false,
      apiKey: falAi.apiKey ? `${falAi.apiKey.slice(0, 8)}***` : '',
      baseUrl: falAi.baseUrl || DEFAULT_FAL_BASE_URL,
      defaultImageModel: falAi.defaultImageModel || DEFAULT_FAL_IMAGE_MODEL,
      defaultEditModel: falAi.defaultEditModel || DEFAULT_FAL_EDIT_MODEL,
      timeoutMs: falAi.timeoutMs || DEFAULT_FAL_TIMEOUT_MS,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const config = getConfigSafe();
    const existing = config.falAi || {
      enabled: false,
      apiKey: '',
      baseUrl: DEFAULT_FAL_BASE_URL,
      defaultImageModel: DEFAULT_FAL_IMAGE_MODEL,
      defaultEditModel: DEFAULT_FAL_EDIT_MODEL,
      timeoutMs: DEFAULT_FAL_TIMEOUT_MS,
    };
    const body = await request.json();

    const falAi: FalAiConfig = {
      enabled: body.enabled !== false,
      apiKey:
        body.apiKey !== undefined && !String(body.apiKey).includes('***')
          ? body.apiKey
          : existing.apiKey,
      baseUrl: body.baseUrl || DEFAULT_FAL_BASE_URL,
      defaultImageModel: body.defaultImageModel || DEFAULT_FAL_IMAGE_MODEL,
      defaultEditModel: body.defaultEditModel || DEFAULT_FAL_EDIT_MODEL,
      timeoutMs: Number(body.timeoutMs) > 0 ? Number(body.timeoutMs) : DEFAULT_FAL_TIMEOUT_MS,
    };

    setFalConfig(config, falAi);
    saveConfig(config);

    const sessions = getSessionManagerSafe();
    sessions.reloadConfig(config);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
