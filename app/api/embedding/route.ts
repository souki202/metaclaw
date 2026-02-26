import { NextResponse } from 'next/server';
import { getConfigSafe, getSessionManagerSafe, handleError } from '../helpers';
import { setEmbeddingConfig, saveConfig } from '../../../src/config';
import type { EmbeddingConfig } from '../../../src/types';

export async function GET() {
  try {
    const config = getConfigSafe();
    const embedding = config.embedding || { endpoint: '', apiKey: '', model: '' };

    return NextResponse.json({
      endpoint: embedding.endpoint,
      apiKey: embedding.apiKey ? `${embedding.apiKey.slice(0, 8)}***` : '',
      model: embedding.model,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const config = getConfigSafe();
    const existing = (config.embedding || { endpoint: '', apiKey: '', model: '' }) as EmbeddingConfig;
    const body = await request.json();

    const embeddingConfig: EmbeddingConfig = {
      endpoint: body.endpoint || '',
      apiKey:
        body.apiKey !== undefined && !body.apiKey.includes('***')
          ? body.apiKey
          : existing.apiKey,
      model: body.model || '',
    };

    setEmbeddingConfig(config, embeddingConfig);
    saveConfig(config);

    const sessions = getSessionManagerSafe();
    sessions.reloadConfig(config);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}