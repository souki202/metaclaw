type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const COLORS: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

let minLevel: Level = 'info';

export function setLogLevel(level: Level) {
  minLevel = level;
}

function log(level: Level, prefix: string, ...args: unknown[]) {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const ts = new Date().toISOString().slice(11, 23);
  const color = COLORS[level];
  const tag = level.toUpperCase().padEnd(5);
  console.log(`${DIM}${ts}${RESET} ${color}${tag}${RESET} ${DIM}[${prefix}]${RESET}`, ...args);
}

export function createLogger(prefix: string) {
  return {
    debug: (...args: unknown[]) => log('debug', prefix, ...args),
    info: (...args: unknown[]) => log('info', prefix, ...args),
    warn: (...args: unknown[]) => log('warn', prefix, ...args),
    error: (...args: unknown[]) => log('error', prefix, ...args),
  };
}

export const logger = createLogger('main');
