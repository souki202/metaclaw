import fs from 'fs';
import path from 'path';
import type { Config, SessionConfig } from './types.js';

const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');
const EXAMPLE_PATH = path.resolve(process.cwd(), 'config.example.json');

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    if (fs.existsSync(EXAMPLE_PATH)) {
      fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
      console.log(`[config] Created config.json from example. Please edit it before starting.`);
      process.exit(0);
    }
    throw new Error(`config.json not found. Create one from config.example.json.`);
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const config: Config = JSON.parse(raw);
  validateConfig(config);
  return config;
}

function validateConfig(config: Config) {
  if (!config.sessions || Object.keys(config.sessions).length === 0) {
    throw new Error('config.json must have at least one session defined.');
  }
  for (const [id, session] of Object.entries(config.sessions)) {
    if (!session.provider?.endpoint) throw new Error(`Session "${id}" missing provider.endpoint`);
    if (!session.provider?.apiKey) throw new Error(`Session "${id}" missing provider.apiKey`);
    if (!session.provider?.model) throw new Error(`Session "${id}" missing provider.model`);
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

export function reloadConfig(): Config {
  delete require.cache[require.resolve(CONFIG_PATH)];
  return loadConfig();
}
