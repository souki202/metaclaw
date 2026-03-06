import * as pty from 'node-pty';
import { createLogger } from '../logger.js';

const log = createLogger('pty-manager');

// Circular buffer size for output history (reconnecting clients replay this)
const BUFFER_SIZE = 200;

// Strip ANSI escape codes for clean tool output
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export interface PtyInstance {
  pty: pty.IPty;
  buffer: string[];
  dataListeners: Set<(data: string) => void>;
}

// Use globalThis to survive Next.js HMR module reloads
const g = globalThis as typeof globalThis & { __ptyManager?: PtyManager };

export class PtyManager {
  private ptys = new Map<string, PtyInstance>();

  static getInstance(): PtyManager {
    if (!g.__ptyManager) {
      g.__ptyManager = new PtyManager();
    }
    return g.__ptyManager;
  }

  getOrCreate(sessionId: string, workspace: string): PtyInstance {
    const existing = this.ptys.get(sessionId);
    if (existing) return existing;

    const shell = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL ?? '/bin/bash');
    const args = process.platform === 'win32' ? [] : [];

    log.info(`Creating PTY for session ${sessionId} in ${workspace}`);

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workspace,
      env: process.env as Record<string, string>,
    });

    const instance: PtyInstance = {
      pty: ptyProcess,
      buffer: [],
      dataListeners: new Set(),
    };

    ptyProcess.onData((data) => {
      // Add to circular buffer
      instance.buffer.push(data);
      if (instance.buffer.length > BUFFER_SIZE) {
        instance.buffer.shift();
      }
      // Deliver to all listeners
      for (const listener of instance.dataListeners) {
        try {
          listener(data);
        } catch (e) {
          log.debug('Data listener error:', e);
        }
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      log.info(`PTY for session ${sessionId} exited with code ${exitCode}`);
      this.ptys.delete(sessionId);
    });

    this.ptys.set(sessionId, instance);
    return instance;
  }

  write(sessionId: string, data: string): void {
    const instance = this.ptys.get(sessionId);
    if (instance) {
      instance.pty.write(data);
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const instance = this.ptys.get(sessionId);
    if (instance) {
      instance.pty.resize(cols, rows);
    }
  }

  kill(sessionId: string): void {
    const instance = this.ptys.get(sessionId);
    if (instance) {
      log.info(`Killing PTY for session ${sessionId}`);
      try {
        instance.pty.kill();
      } catch (e) {
        log.debug('Error killing PTY:', e);
      }
      this.ptys.delete(sessionId);
    }
  }

  has(sessionId: string): boolean {
    return this.ptys.has(sessionId);
  }

  addDataListener(sessionId: string, listener: (data: string) => void): () => void {
    const instance = this.ptys.get(sessionId);
    if (!instance) return () => {};
    instance.dataListeners.add(listener);
    return () => instance.dataListeners.delete(listener);
  }

  /**
   * Execute a command in the PTY and wait for completion using a sentinel pattern.
   * Returns cleaned output and exit code.
   */
  async execCommand(
    sessionId: string,
    workspace: string,
    command: string,
    timeout = 30000
  ): Promise<{ output: string; exitCode: number }> {
    const instance = this.getOrCreate(sessionId, workspace);

    return new Promise((resolve) => {
      let output = '';
      let done = false;
      let timer: NodeJS.Timeout;

      // Unique sentinel to detect completion
      const sentinel = `__DONE_${Date.now()}__`;

      // Wrap command with sentinel echo
      const wrappedCommand = process.platform === 'win32'
        ? `${command} & echo ${sentinel}_%ERRORLEVEL%_\r\n`
        : `${command}; echo ${sentinel}_$?_\n`;

      const listener = (data: string) => {
        output += data;
        const sentinelMatch = output.match(new RegExp(`${sentinel}_(\\d+)_`));
        if (sentinelMatch && !done) {
          done = true;
          clearTimeout(timer);
          instance.dataListeners.delete(listener);

          const exitCode = parseInt(sentinelMatch[1], 10);
          // Strip sentinel line from output
          const cleaned = output
            .replace(new RegExp(`.*${sentinel}_\\d+_.*[\r\n]*`, 'g'), '')
            // Strip the echoed command itself
            .replace(wrappedCommand.trimEnd(), '')
            .replace(ANSI_REGEX, '')
            .trim();

          resolve({ output: cleaned, exitCode });
        }
      };

      instance.dataListeners.add(listener);

      timer = setTimeout(() => {
        if (!done) {
          done = true;
          instance.dataListeners.delete(listener);
          const cleaned = output.replace(ANSI_REGEX, '').trim();
          resolve({ output: cleaned + '\n[TIMEOUT]', exitCode: -1 });
        }
      }, timeout);

      instance.pty.write(wrappedCommand);
    });
  }
}
