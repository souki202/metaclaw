'use client';

import { useEffect, useRef } from 'react';
import type { AttachAddon } from '@xterm/addon-attach';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

interface TerminalPanelProps {
  sessionId: string;
}

export function TerminalPanel({ sessionId }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !sessionId) return;

    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let attachAddon: AttachAddon | null = null;
    let socket: WebSocket | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;
    let reconnectDelay = 500;

    const modulesPromise = Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-attach'),
    ]);

    const tryFit = () => {
      if (!fitAddon) return;
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors caused by zero-sized containers during layout thrash
      }
    };

    const sendResize = () => {
      if (!term || !socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * 1.5, 8000);
        void connect();
      }, reconnectDelay);
    };

    const connect = async () => {
      const [{ Terminal }, { FitAddon }, { AttachAddon }] = await modulesPromise;
      if (disposed || !containerRef.current) return;

      if (!term) {
        term = new Terminal({
          cursorBlink: true,
          fontSize: 13,
          fontFamily: 'Consolas, "Courier New", monospace',
          cols: 80,
          rows: 24,
          allowTransparency: true,
          theme: {
            background: '#1a1a1a',
            foreground: '#d4d4d4',
          },
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.options.disableStdin = true;
        term.open(containerRef.current);

        // Double rAF ensures layout is ready before fitting, mirroring VS Code's terminal flow
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!disposed) {
            tryFit();
            term?.focus();
          }
        }));
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/terminal/${encodeURIComponent(sessionId)}`;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      socket = ws;

      ws.addEventListener('open', () => {
        if (disposed) {
          ws.close();
          return;
        }

        reconnectDelay = 500;
        term!.options.disableStdin = false;

        // Recreate attach addon per connection to mirror VS Code's duplex pipe behaviour
        attachAddon?.dispose();
        attachAddon = new AttachAddon(ws, { bidirectional: true });
        term!.loadAddon(attachAddon);

        tryFit();
        sendResize();
        term!.focus();
      });

      ws.addEventListener('close', () => {
        if (disposed) return;
        term?.writeln('\r\n\x1b[33m[Terminal disconnected; reconnecting...]\x1b[0m');
        term?.options && (term.options.disableStdin = true);
        attachAddon?.dispose();
        attachAddon = null;
        scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        ws.close();
      });
    };

    void connect();

    resizeObserver = new ResizeObserver(() => {
      tryFit();
      sendResize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      resizeObserver?.disconnect();
      attachAddon?.dispose();
      socket?.close();
      term?.dispose();
    };
  }, [sessionId]);

  return <div ref={containerRef} className="terminal-container" />;
}
