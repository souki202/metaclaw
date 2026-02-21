/**
 * Process wrapper for mini-claw.
 * Handles graceful restarts when the AI triggers self-modification.
 * Exit code 75 = restart requested by AI
 */
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RESTART_CODE = 75;
const MAX_QUICK_RESTARTS = 5;
const QUICK_RESTART_WINDOW_MS = 10_000;

let quickRestarts = 0;
let windowStart = Date.now();

function startProcess() {
  const now = Date.now();
  if (now - windowStart > QUICK_RESTART_WINDOW_MS) {
    quickRestarts = 0;
    windowStart = now;
  }

  // On Windows, .cmd files require shell:true or explicit cmd invocation
  const isWindows = process.platform === 'win32';
  const child = spawn(
    isWindows ? 'cmd.exe' : 'npx',
    isWindows ? ['/d', '/s', '/c', 'npx tsx src/index.ts'] : ['tsx', 'src/index.ts'],
    { stdio: 'inherit', cwd: ROOT, shell: !isWindows }
  );

  const startTime = Date.now();

  child.on('close', (code) => {
    if (code === RESTART_CODE) {
      const uptime = Date.now() - startTime;
      if (uptime < QUICK_RESTART_WINDOW_MS) {
        quickRestarts++;
        if (quickRestarts >= MAX_QUICK_RESTARTS) {
          console.error(`[runner] Too many quick restarts (${quickRestarts}). Stopping.`);
          process.exit(1);
        }
      }
      console.log(`[runner] Restart requested. Starting in 2s... (attempt ${quickRestarts})`);
      setTimeout(startProcess, 2000);
    } else {
      process.exit(code ?? 0);
    }
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

startProcess();
