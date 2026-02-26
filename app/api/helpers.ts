import { NextResponse } from 'next/server';
import { getSessionManager, getConfig } from '../../src/global-state';
import { loadConfig } from '../../src/config';

export function handleError(error: unknown) {
  console.error('API Error:', error);
  const apiError = error as { status?: number; message?: string; code?: string };
  const status = typeof apiError?.status === 'number' && apiError.status >= 400 && apiError.status < 600
    ? apiError.status
    : 500;

  const message = apiError?.code === 'invalid_prompt'
    ? 'Request was blocked by provider safety/prompt restrictions. Please rephrase and try again.'
    : (error instanceof Error ? error.message : 'Internal server error');

  return NextResponse.json(
    { error: message },
    { status }
  );
}

export function notFound(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function badRequest(message = 'Bad request') {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function getSessionManagerSafe() {
  return getSessionManager();
}

export function getConfigSafe() {
  try {
    return getConfig();
  } catch {
    // フォールバック: グローバルステート未初期化時はファイルから読む
    return loadConfig();
  }
}
