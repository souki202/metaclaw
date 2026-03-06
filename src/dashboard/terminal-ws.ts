import { WebSocket } from 'ws';
import type { SessionManager } from '../core/sessions.js';
import { PtyManager } from '../tools/pty-manager.js';
import { createLogger } from '../logger.js';

const log = createLogger('terminal-ws');

export function handleTerminalWs(
  ws: WebSocket,
  sessionId: string,
  sessions: SessionManager
): void {
  const config = sessions.getSessionConfig(sessionId);
  if (!config) {
    log.warn(`Terminal WS: session not found: ${sessionId}`);
    ws.close(1008, 'Session not found');
    return;
  }

  let workspace: string;
  try {
    workspace = sessions.resolveWorkspace(config);
  } catch (err) {
    log.error(`Terminal WS: failed to resolve workspace for ${sessionId}:`, err);
    ws.close(1011, 'Internal error');
    return;
  }

  const manager = PtyManager.getInstance();
  let instance: ReturnType<typeof manager.getOrCreate>;
  try {
    instance = manager.getOrCreate(sessionId, workspace);
  } catch (err) {
    log.error(`Terminal WS: failed to get/create PTY for ${sessionId}:`, err);
    ws.close(1011, 'PTY error');
    return;
  }

  log.info(`Terminal WS connected for session ${sessionId} (buf=${instance.buffer.length})`);

  // Replay buffer so reconnecting clients see recent output
  for (const chunk of instance.buffer) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(chunk); } catch (_) { }
    }
  }

  // If buffer is empty, nudge the shell to re-print its prompt
  if (instance.buffer.length === 0) {
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        manager.write(sessionId, process.platform === 'win32' ? '\r\n' : '\n');
      }
    }, 200);
  }

  // PTY → WebSocket
  const unsub = manager.addDataListener(sessionId, (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(data); } catch (_) { }
    }
  });

  // WebSocket → PTY
  ws.on('message', (msg) => {
    const str = msg.toString();
    try {
      const obj = JSON.parse(str);
      if (obj.type === 'resize' && typeof obj.cols === 'number' && typeof obj.rows === 'number') {
        manager.resize(sessionId, obj.cols, obj.rows);
        return;
      }
    } catch {
      // Not JSON — treat as raw terminal input
    }
    manager.write(sessionId, str);
  });

  ws.on('close', () => {
    log.debug(`Terminal WS disconnected for session ${sessionId}`);
    unsub();
  });

  ws.on('error', (e) => {
    log.debug(`Terminal WS error for session ${sessionId}:`, e);
    unsub();
  });
}
