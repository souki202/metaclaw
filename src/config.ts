import fs from 'fs';
import path from 'path';
import type { Config, SessionConfig, ProviderConfig, SearchConfig } from './types.js';

const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');
const EXAMPLE_PATH = path.resolve(process.cwd(), 'config.example.json');

const DEFAULT_PROVIDER: ProviderConfig = {
  endpoint: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  embeddingModel: 'text-embedding-3-small',
  contextWindow: 128000,
};

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    // デフォルト設定を作成
    const defaultConfig = createDefaultConfig();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    console.log(`[config] Created config.json with default values. Please edit it before starting.`);
    process.exit(0);
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const config: Config = JSON.parse(raw);
  
  // Migrate backward capability (if it had environment but no provider, map back if we can)
  for (const session of Object.values(config.sessions)) {
    if (!session.provider) {
      // If it had environment and there were global environments in older config format
       const oldEnv = (config as any).environments?.[(session as any).environment || 'default'];
       if (oldEnv) {
         session.provider = {
           endpoint: oldEnv.endpoint,
           apiKey: oldEnv.apiKey,
           model: oldEnv.model,
           embeddingModel: oldEnv.embeddingModel,
           contextWindow: oldEnv.contextWindow,
         };
       } else {
         session.provider = { ...DEFAULT_PROVIDER };
       }
    }
  }
  
  // Clean up old environments field
  if ('environments' in config) {
    delete (config as any).environments;
    // Auto-save cleaned config
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  }
  
  validateConfig(config);
  return config;
}

function createDefaultConfig(): Config {
  return {
    dashboard: {
      enabled: true,
      port: 3000,
    },
    search: {
      provider: 'brave',
      braveApiKey: '',
    },
    sessions: {
      'default': {
        name: 'Default Agent',
        description: 'Default AI agent session',
        provider: { ...DEFAULT_PROVIDER },
        workspace: './data/sessions/default',
        restrictToWorkspace: true,
        allowSelfModify: false,
        tools: {
          exec: true,
          web: true,
          memory: true,
        },
        heartbeat: {
          enabled: false,
          interval: '0 */2 * * *',
        },
      }
    },
  };
}



function validateConfig(config: Config) {
  if (!config.sessions || Object.keys(config.sessions).length === 0) {
    throw new Error('config.json must have at least one session defined.');
  }

  for (const [id, session] of Object.entries(config.sessions)) {
    if (!session.provider) {
      throw new Error(`Session "${id}" must have "provider" defined.`);
    }
    if (!session.workspace) throw new Error(`Session "${id}" missing workspace`);
  }
}

export function resolveWorkspace(sessionConfig: SessionConfig): string {
  const ws = sessionConfig.workspace;
  if (path.isAbsolute(ws)) return ws;
  return path.resolve(process.cwd(), ws);
}

export function getSessionWorkspace(sessionId: string, config: Config): string {
  const sessionConfig = config.sessions[sessionId];
  if (!sessionConfig) throw new Error(`Session "${sessionId}" not found`);
  return resolveWorkspace(sessionConfig);
}

export function resolveProvider(sessionConfig: SessionConfig, config: Config): ProviderConfig {
  if (sessionConfig.provider) {
    return sessionConfig.provider;
  }
  
  throw new Error('No provider configuration found for session');
}

export function reloadConfig(): Config {
  return loadConfig();
}

// 設定を保存
export function saveConfig(config: Config): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// セッション設定を追加・更新
export function setSession(config: Config, sessionId: string, session: SessionConfig): Config {
  config.sessions[sessionId] = session;
  return config;
}

// セッション設定を削除
export function deleteSession(config: Config, sessionId: string): boolean {
  if (!config.sessions[sessionId]) {
    return false;
  }
  delete config.sessions[sessionId];
  return true;
}

// 検索設定を更新
export function setSearchConfig(config: Config, search: SearchConfig): Config {
  config.search = search;
  return config;
}