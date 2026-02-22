# Next.js Development Mode Setup

## Overview

The metaclaw application now supports proper Next.js development mode with `next dev`, which provides:
- Hot module reloading for frontend React components
- Fast refresh for backend changes
- Better development experience with Next.js devtools

## How It Works

The development setup uses a hybrid architecture:

1. **Backend Process** (`tsx src/index.ts`):
   - Initializes SessionManager and AI agents
   - Sets up Discord bot connections
   - Manages configuration and state
   - Stores global state for API routes to access

2. **Next.js Dev Server** (`next dev`):
   - Serves the React frontend
   - Handles API routes in `app/api/`
   - Provides hot module reloading
   - Accesses backend state via global singleton

## Running in Development Mode

```bash
npm run dev
```

This will:
1. Start the backend (initializes SessionManager, Discord, etc.)
2. Wait 2 seconds for backend initialization
3. Start Next.js dev server on the configured port (default: 8080)

Both processes run simultaneously, and stopping one will stop the other.

## Architecture

### Global State Pattern

The `src/global-state.ts` module provides a singleton pattern that allows Next.js API routes to access the SessionManager instance initialized by the backend:

```typescript
// Backend (src/index.ts) sets the state
setGlobalState(sessions, config);

// API routes access it
const sessions = getSessionManager();
```

### API Route Structure

All API endpoints have been converted to Next.js API routes in `app/api/`:

```
app/api/
├── helpers.ts                              # Shared helper functions
├── sessions/
│   ├── route.ts                            # GET /api/sessions, POST /api/sessions
│   └── [id]/
│       ├── route.ts                        # DELETE /api/sessions/:id
│       ├── history/route.ts                # GET/DELETE /api/sessions/:id/history
│       ├── message/route.ts                # POST /api/sessions/:id/message
│       ├── config/route.ts                 # GET/PUT /api/sessions/:id/config
│       ├── discord/route.ts                # PUT /api/sessions/:id/discord
│       ├── files/[filename]/route.ts       # GET/PUT /api/sessions/:id/files/:filename
│       ├── memory/route.ts                 # GET /api/sessions/:id/memory
│       ├── skills/route.ts                 # GET /api/sessions/:id/skills
│       └── mcp/
│           ├── route.ts                    # GET/POST /api/sessions/:id/mcp
│           ├── status/route.ts             # GET /api/sessions/:id/mcp/status
│           └── [serverId]/
│               ├── route.ts                # PUT/DELETE /api/sessions/:id/mcp/:serverId
│               └── restart/route.ts        # POST /api/sessions/:id/mcp/:serverId/restart
├── config/route.ts                         # GET /api/config
├── search/route.ts                         # GET/PUT /api/search
└── system/route.ts                         # GET /api/system
```

## Production Mode

For production, use the custom server with WebSocket support:

```bash
npm start
```

This runs `scripts/runner.js` which uses the custom Next.js server defined in `src/dashboard/next-server.ts`. The custom server:
- Supports WebSocket connections for real-time updates
- Handles API routes via `src/dashboard/api-routes.ts`
- Provides hot reload for backend changes via file watching

## Environment Variables

- `NEXT_DEV_MODE=true` - Signals to backend to skip starting Next.js custom server
- `NODE_ENV=development` - Enables development features

## Troubleshooting

### "SessionManager not initialized" error

This means the backend hasn't finished initializing yet. The dev script waits 2 seconds before starting Next.js, but you might need to increase this if your backend takes longer to initialize.

Edit `scripts/dev.js` and increase the timeout:

```javascript
setTimeout(() => {
  // ...
}, 3000); // Increase from 2000 to 3000
```

### Port conflicts

The dev server uses the port specified in `config.json` under `dashboard.port`. If you get a port conflict:

1. Check if another process is using the port
2. Change the port in `config.json`
3. Restart `npm run dev`

### API routes return 404

Make sure:
1. The backend process is running (you should see "meta-claw ready!" in the console)
2. The global state has been initialized (happens automatically in `src/index.ts`)
3. You're accessing the correct API path

## Benefits of This Setup

1. **Fast Refresh**: React components reload instantly without losing state
2. **Better DX**: Next.js devtools, better error messages, type-aware API routes
3. **Separation of Concerns**: Backend logic separate from frontend serving
4. **Production Ready**: Custom server still available for WebSocket support
5. **Hot Reload**: Backend changes automatically trigger restart

## Migration Notes

- All Express routes have been converted to Next.js API routes
- WebSocket functionality is disabled in dev mode (use custom server for that)
- The dashboard HTML has been moved to `public/dashboard.html`
- API route parameters use Next.js conventions (`[id]` instead of `:id`)
