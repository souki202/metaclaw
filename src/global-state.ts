import type { SessionManager } from './core/sessions.js';
import type { Config, DashboardEvent } from './types.js';

interface GlobalState {
  sessions: SessionManager | null;
  config: Config | null;
  initialized: boolean;
  sseClients: Set<ReadableStreamDefaultController>;
}

// Next.js では HMR などでモジュールが再ロードされることがあるため
// Node.js グローバルオブジェクトにシングルトンを保持する
const g = globalThis as typeof globalThis & { __metaclaw?: GlobalState };
if (!g.__metaclaw) {
  g.__metaclaw = {
    sessions: null,
    config: null,
    initialized: false,
    sseClients: new Set(),
  };
}
const state = g.__metaclaw;

export function setGlobalState(sessions: SessionManager, config: Config) {
  state.sessions = sessions;
  state.config = config;
  state.initialized = true;
}

export function getGlobalState(): GlobalState {
  return state;
}

export function getSessionManager(): SessionManager {
  if (!state.sessions) {
    throw new Error('SessionManager not initialized.');
  }
  return state.sessions;
}

export function getConfig(): Config {
  if (!state.config) {
    throw new Error('Config not initialized.');
  }
  return state.config;
}

// ==================== SSE サポート ====================

export function addSseClient(controller: ReadableStreamDefaultController) {
  state.sseClients.add(controller);
}

export function removeSseClient(controller: ReadableStreamDefaultController) {
  state.sseClients.delete(controller);
}

export function broadcastSseEvent(event: DashboardEvent) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const encoded = new TextEncoder().encode(data);
  const dead: ReadableStreamDefaultController[] = [];
  for (const controller of state.sseClients) {
    try {
      controller.enqueue(encoded);
    } catch {
      dead.push(controller);
    }
  }
  for (const c of dead) state.sseClients.delete(c);
}
