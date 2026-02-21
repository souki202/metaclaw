import { NextResponse } from 'next/server';
import { getSessionManager, getConfig } from '../../src/global-state';
import { loadConfig } from '../../src/config';

export function handleError(error: unknown) {
  console.error('API Error:', error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Internal server error' },
    { status: 500 }
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
