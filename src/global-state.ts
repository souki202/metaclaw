import type { SessionManager } from './core/sessions.js';
import type { Config } from './types.js';

interface GlobalState {
  sessions: SessionManager | null;
  config: Config | null;
  initialized: boolean;
}

// Global state accessible from both custom server and Next.js API routes
const globalState: GlobalState = {
  sessions: null,
  config: null,
  initialized: false,
};

export function setGlobalState(sessions: SessionManager, config: Config) {
  globalState.sessions = sessions;
  globalState.config = config;
  globalState.initialized = true;
}

export function getGlobalState(): GlobalState {
  return globalState;
}

export function getSessionManager(): SessionManager {
  if (!globalState.sessions) {
    throw new Error('SessionManager not initialized. Make sure to run the initialization first.');
  }
  return globalState.sessions;
}

export function getConfig(): Config {
  if (!globalState.config) {
    throw new Error('Config not initialized. Make sure to run the initialization first.');
  }
  return globalState.config;
}
