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
  try {
    return getSessionManager();
  } catch (error) {
    throw new Error('Backend not initialized. Make sure npm run dev is starting the backend first.');
  }
}

export function getConfigSafe() {
  try {
    // Try global state first, fallback to loading from file
    try {
      return getConfig();
    } catch {
      return loadConfig();
    }
  } catch (error) {
    throw new Error('Could not load configuration');
  }
}
