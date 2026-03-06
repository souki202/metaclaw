# mini-claw Memory

## Key Architecture
- Next.js app in `/app`, backend in `/src`
- Dashboard server: `src/dashboard/next-server.ts` (HTTP + WebSocket)
- Sessions: `src/core/sessions.ts` (SessionManager)
- Tools: `src/tools/index.ts` (buildTools/executeTool aggregator)
- Config: `next.config.js` (serverExternalPackages for native modules)

## Terminal Feature (implemented Mar 6, 2026)
- `src/tools/pty-manager.ts` - PtyManager singleton, per-session PTY with buffer/listeners/execCommand
- `src/tools/terminal.ts` - terminal_exec and terminal_send_input agent tools
- `src/dashboard/terminal-ws.ts` - WebSocket bridge: /terminal/{sessionId}
- `src/components/dashboard/TerminalPanel.tsx` - xterm.js UI component (lazy loaded)
- WS routing added to next-server.ts (pathname.startsWith('/terminal/'))
- PTY cleanup added to sessions.ts stopSession()
- Tab switcher (Chat/Terminal) in DashboardClient.tsx
- CSS in app/globals.css, xterm CSS imported at top

## Packages
- node-pty: already installed, in serverExternalPackages
- @xterm/xterm + @xterm/addon-fit: installed Mar 6 2026

## Pre-existing TS Errors
- `src/tools/unified-tools.test.ts` has ~7 type errors (pre-existing, unrelated)
