import next from 'next';
import { createServer } from 'http';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import type { SessionManager } from '../core/sessions.js';
import type { DashboardEvent } from '../types.js';
import { createLogger } from '../logger.js';
import { setupApiRoutes } from './api-routes.js';

const log = createLogger('dashboard');
const dev = process.env.NODE_ENV !== 'production';

export class DashboardServer {
  private server: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private nextApp: ReturnType<typeof next> | null = null;
  private sessions: SessionManager;
  private clients = new Set<WebSocket>();

  constructor(sessions: SessionManager) {
    this.sessions = sessions;
  }

  broadcast(event: DashboardEvent) {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  async start(port: number): Promise<void> {
    // Initialize Next.js
    this.nextApp = next({
      dev,
      dir: process.cwd(),
      hostname: 'localhost',
      port
    });

    const handle = this.nextApp.getRequestHandler();

    await this.nextApp.prepare();

    // Create HTTP server
    this.server = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url!, true);
        const { pathname } = parsedUrl;

        // Handle API routes
        if (pathname?.startsWith('/api/')) {
          const handled = await setupApiRoutes(req, res, this.sessions);
          if (handled) return;
        }

        // Let Next.js handle all other routes
        await handle(req, res, parsedUrl);
      } catch (err) {
        log.error('Error handling request:', err);
        res.statusCode = 500;
        res.end('Internal server error');
      }
    });

    // Setup WebSocket
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      log.debug(`Dashboard client connected (total: ${this.clients.size})`);

      ws.on('close', () => {
        this.clients.delete(ws);
        log.debug(`Dashboard client disconnected (total: ${this.clients.size})`);
      });

      ws.on('error', (e) => log.debug('WS error:', e));
    });

    // Start listening
    return new Promise((resolve) => {
      this.server!.listen(port, () => {
        log.info(`Dashboard running at http://localhost:${port}`);
        resolve();
      });
    });
  }

  stop() {
    this.wss?.close();
    this.server?.close();
  }
}
