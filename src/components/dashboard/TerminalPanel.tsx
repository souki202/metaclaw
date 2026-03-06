'use client';

import { useEffect, useRef } from 'react';

interface TerminalPanelProps {
  sessionId: string;
}

export function TerminalPanel({ sessionId }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const flushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current || !sessionId) return;

    let term: any = null;
    let fitAddon: any = null;
    let stream: EventSource | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let disposed = false;
    let pendingInput = '';
    let sendingInput = false;

    const terminalApiPath = `/api/sessions/${encodeURIComponent(sessionId)}/terminal`;
    const terminalStreamPath = `${terminalApiPath}/stream`;

    const sendTerminalRequest = async (payload: Record<string, unknown>) => {
      const response = await fetch(terminalApiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Terminal request failed with ${response.status}`);
      }
    };

    const flushInput = async () => {
      if (sendingInput || !pendingInput) return;
      const chunk = pendingInput;
      pendingInput = '';
      sendingInput = true;

      try {
        await sendTerminalRequest({ input: chunk });
      } catch {
        if (term && !disposed) {
          term.write('\r\n\x1b[31m[Terminal input failed]\x1b[0m\r\n');
        }
      } finally {
        sendingInput = false;
        if (pendingInput && !disposed) {
          void flushInput();
        }
      }
    };

    const queueInput = (data: string) => {
      pendingInput += data;
      if (data.includes('\r') || data.includes('\n')) {
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        void flushInput();
        return;
      }

      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        void flushInput();
      }, 25);
    };

    const sendResize = () => {
      if (!term || disposed) return;
      void sendTerminalRequest({ resize: { cols: term.cols, rows: term.rows } }).catch(() => {
        if (term && !disposed) {
          term.write('\r\n\x1b[33m[Resize sync failed]\x1b[0m\r\n');
        }
      });
    };

    (async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      if (disposed || !containerRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Consolas, "Courier New", monospace',
        cols: 80,
        rows: 24,
        theme: {
          background: '#1a1a1a',
          foreground: '#d4d4d4',
        },
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      // Use setTimeout to ensure layout is complete before fitting
      const initialFit = () => {
        if (!disposed && fitAddon) {
          try {
            fitAddon.fit();
          } catch (_) { /* ignore */ }
          term.focus();
        }
      };
      // Double rAF ensures browser has done layout
      requestAnimationFrame(() => requestAnimationFrame(initialFit));

      stream = new EventSource(terminalStreamPath);

      stream.onopen = () => {
        try { fitAddon?.fit(); } catch (_) { }
        term.focus();
        sendResize();
      };

      stream.onmessage = (e) => {
        if (!term || disposed) return;
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'output' && typeof payload.data === 'string') {
            term.write(payload.data);
          }
        } catch {
          term.write(e.data);
        }
      };

      stream.onerror = () => {
        if (term && !disposed) {
          term.write('\r\n\x1b[31m[Terminal stream disconnected; retrying...]\x1b[0m\r\n');
        }
      };

      term.onData((data: string) => {
        queueInput(data);
      });

      resizeObserver = new ResizeObserver(() => {
        try { fitAddon?.fit(); } catch (_) { }
        sendResize();
      });
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }
    })();

    return () => {
      disposed = true;
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      resizeObserver?.disconnect();
      stream?.close();
      term?.dispose();
    };
  }, [sessionId]);

  return <div ref={containerRef} className="terminal-container" />;
}
