#!/usr/bin/env node
/**
 * Development server for meta-claw with Next.js
 * This starts the backend (sessions, discord) and Next.js dev server separately
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// Load config to get the port
let port = 3000;
try {
  const configPath = path.join(ROOT, 'config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    port = config.dashboard?.port || 3000;
  }
} catch (e) {
  console.warn('[dev] Could not load config.json, using default port 3000');
}

// Start backend (which initializes SessionManager and global state)
console.log('[dev] Starting backend...');
const backend = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsx', '--watch', 'src/index.ts'],
  {
    stdio: 'inherit',
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NEXT_DEV_MODE: 'true', // Signal to skip Next.js server in backend
    },
  }
);

// Wait a bit for backend to initialize before starting Next.js
setTimeout(() => {
  console.log(`[dev] Starting Next.js dev server on port ${port}...`);
  const nextDev = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['next', 'dev', '-p', String(port)],
    {
      stdio: 'inherit',
      cwd: ROOT,
    }
  );

  nextDev.on('close', (code) => {
    console.log(`[dev] Next.js dev server exited with code ${code}`);
    backend.kill();
    process.exit(code || 0);
  });
}, 2000);

backend.on('close', (code) => {
  console.log(`[dev] Backend exited with code ${code}`);
  process.exit(code || 0);
});

process.on('SIGINT', () => {
  backend.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  backend.kill('SIGTERM');
  process.exit(0);
});
