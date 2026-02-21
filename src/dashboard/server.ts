import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import type { SessionManager } from '../core/sessions.js';
import type { DashboardEvent } from '../types.js';
import { createLogger } from '../logger.js';

const log = createLogger('dashboard');

export class DashboardServer {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocketServer;
  private sessions: SessionManager;
  private clients = new Set<WebSocket>();

  constructor(sessions: SessionManager) {
    this.sessions = sessions;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.setupExpress();
    this.setupWebSocket();
  }

  private setupExpress() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // API: list sessions
    this.app.get('/api/sessions', (_req, res) => {
      const ids = this.sessions.getSessionIds();
      const configs = this.sessions.getSessionConfigs();
      res.json(
        ids.map((id) => ({
          id,
          name: configs[id]?.name ?? id,
          description: configs[id]?.description ?? '',
          model: configs[id]?.provider.model ?? '',
          workspace: this.sessions.resolveWorkspace(configs[id]),
          tools: configs[id]?.tools,
          allowSelfModify: configs[id]?.allowSelfModify,
        }))
      );
    });

    // API: get session history
    this.app.get('/api/sessions/:id/history', (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });
      res.json(agent.getHistory());
    });

    // API: send message to session
    this.app.post('/api/sessions/:id/message', async (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });

      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'message required' });

      try {
        const response = await agent.processMessage(message, 'dashboard');
        res.json({ response });
      } catch (e: unknown) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    // API: clear session history
    this.app.delete('/api/sessions/:id/history', (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });
      agent.clearHistory();
      res.json({ ok: true });
    });

    // API: read workspace file
    this.app.get('/api/sessions/:id/files/:filename', (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });

      const allowed = ['IDENTITY.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md'];
      const filename = req.params.filename;
      if (!allowed.includes(filename)) return res.status(403).json({ error: 'Not allowed' });

      const filePath = path.join(agent.getWorkspace(), filename);
      if (!fs.existsSync(filePath)) return res.json({ content: '' });
      res.json({ content: fs.readFileSync(filePath, 'utf-8') });
    });

    // API: write workspace file
    this.app.put('/api/sessions/:id/files/:filename', (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });

      const allowed = ['IDENTITY.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md'];
      const filename = req.params.filename;
      if (!allowed.includes(filename)) return res.status(403).json({ error: 'Not allowed' });

      const { content } = req.body;
      const filePath = path.join(agent.getWorkspace(), filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      res.json({ ok: true });
    });

    // API: get long-term memory list
    this.app.get('/api/sessions/:id/memory', (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });
      // Read vectors.json directly
      const vectorPath = path.join(agent.getWorkspace(), 'memory', 'vectors.json');
      if (!fs.existsSync(vectorPath)) return res.json([]);
      try {
        const entries = JSON.parse(fs.readFileSync(vectorPath, 'utf-8'));
        // Return without embeddings (too large for API)
        res.json(entries.map((e: { id: string; text: string; metadata: unknown }) => ({ id: e.id, text: e.text, metadata: e.metadata })));
      } catch {
        res.json([]);
      }
    });

    // API: system info
    this.app.get('/api/system', (_req, res) => {
      res.json({
        version: '1.0.0',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        sessions: this.sessions.getSessionIds().length,
      });
    });

    // Fallback to SPA
    this.app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      log.debug(`Dashboard client connected (total: ${this.clients.size})`);

      ws.on('close', () => {
        this.clients.delete(ws);
        log.debug(`Dashboard client disconnected (total: ${this.clients.size})`);
      });

      ws.on('error', (e) => log.debug('WS error:', e));
    });
  }

  broadcast(event: DashboardEvent) {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, () => {
        log.info(`Dashboard running at http://localhost:${port}`);
        resolve();
      });
    });
  }

  stop() {
    this.wss.close();
    this.server.close();
  }
}
