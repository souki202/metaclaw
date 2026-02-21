import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import type { SessionManager } from '../core/sessions.js';
import type { DashboardEvent, Config, SessionConfig, SearchConfig } from '../types.js';
import { createLogger } from '../logger.js';
import { loadConfig, saveConfig, setSession, deleteSession, setSearchConfig } from '../config.js';
import { loadSkills, type Skill } from '../core/skills.js';

const log = createLogger('dashboard');

export class DashboardServer {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocketServer;
  private sessions: SessionManager;
  private clients = new Set<WebSocket>();
  private configPath: string;

  constructor(sessions: SessionManager) {
    this.sessions = sessions;
    this.configPath = path.resolve(process.cwd(), 'config.json');
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
          model: this.getSessionModel(id),
          workspace: this.sessions.resolveWorkspace(configs[id]),
          provider: configs[id]?.provider,
          tools: configs[id]?.tools,
          allowSelfModify: configs[id]?.allowSelfModify,
          discord: configs[id]?.discord,
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

    // API: get loaded skills for session
    this.app.get('/api/sessions/:id/skills', (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });
      const skills = loadSkills([process.cwd(), agent.getWorkspace()]);
      res.json(skills.map((s: Skill) => ({ name: s.name, description: s.description })));
    });

    // API: セッション設定取得
    this.app.get('/api/sessions/:id/config', (req, res) => {
      const config = this.loadCurrentConfig();
      const session = config.sessions[req.params.id];
      if (!session) return res.status(404).json({ error: 'Session not found' });
      res.json(session);
    });

    // API: セッション設定更新
    this.app.put('/api/sessions/:id/config', (req, res) => {
      try {
        const config = this.loadCurrentConfig();
        const existing = config.sessions[req.params.id];
        if (!existing) {
          return res.status(404).json({ error: 'Session not found' });
        }
        
        // 更新
        const updated: SessionConfig = {
          ...existing,
          ...req.body,
        };
        
        setSession(config, req.params.id, updated);
        saveConfig(config);
        res.json({ ok: true, session: updated });
      } catch (e: unknown) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    // API: セッションのDiscord設定更新
    this.app.put('/api/sessions/:id/discord', (req, res) => {
      try {
        const config = this.loadCurrentConfig();
        const session = config.sessions[req.params.id];
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }
        
        session.discord = {
          enabled: req.body.enabled ?? false,
          token: req.body.token,
          channels: req.body.channels || [],
          guilds: req.body.guilds || [],
          allowFrom: req.body.allowFrom || [],
          prefix: req.body.prefix,
        };
        
        saveConfig(config);
        res.json({ ok: true, discord: session.discord });
      } catch (e: unknown) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    // API: 新規セッション作成
    this.app.post('/api/sessions', (req, res) => {
      try {
        const config = this.loadCurrentConfig();
        const sessionId = req.body.id || `session_${Date.now()}`;
        
        if (config.sessions[sessionId]) {
          return res.status(400).json({ error: 'Session already exists' });
        }
        
        const newSession: SessionConfig = {
          name: req.body.name || sessionId,
          description: req.body.description,
          provider: req.body.provider || {
            endpoint: 'https://api.openai.com/v1',
            apiKey: '',
            model: 'gpt-4o',
            embeddingModel: 'text-embedding-3-small',
            contextWindow: 128000
          },
          workspace: req.body.workspace || `./data/sessions/${sessionId}`,
          restrictToWorkspace: req.body.restrictToWorkspace ?? true,
          allowSelfModify: req.body.allowSelfModify ?? false,
          tools: req.body.tools || { exec: true, web: true, memory: true },
          heartbeat: req.body.heartbeat || { enabled: false, interval: '0 */2 * * *' },
          discord: req.body.discord,
        };
        
        setSession(config, sessionId, newSession);
        saveConfig(config);
        res.json({ ok: true, id: sessionId, session: newSession });
      } catch (e: unknown) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    // API: セッション削除
    this.app.delete('/api/sessions/:id', (req, res) => {
      try {
        const config = this.loadCurrentConfig();
        if (deleteSession(config, req.params.id)) {
          saveConfig(config);
          this.sessions.stopSession(req.params.id);
          res.json({ ok: true });
        } else {
          res.status(404).json({ error: 'Session not found' });
        }
      } catch (e: unknown) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    // ==================== グローバル設定 API ====================

    // API: グローバル設定取得
    this.app.get('/api/config', (_req, res) => {
      const config = this.loadCurrentConfig();
      res.json({
        dashboard: config.dashboard,
        search: config.search,
        sessionCount: Object.keys(config.sessions).length,
      });
    });

    // API: 検索設定取得
    this.app.get('/api/search', (_req, res) => {
      const config = this.loadCurrentConfig();
      const search = config.search || { provider: 'brave' };
      res.json({
        ...search,
        braveApiKey: search.braveApiKey ? `${search.braveApiKey.slice(0, 8)}***` : '',
        serperApiKey: search.serperApiKey ? `${search.serperApiKey.slice(0, 8)}***` : '',
      });
    });

    // API: 検索設定更新
    this.app.put('/api/search', (req, res) => {
      try {
        const config = this.loadCurrentConfig();
        const existing = config.search || { provider: 'brave' } as SearchConfig;
        
        const searchConfig: SearchConfig = {
          provider: req.body.provider || 'brave',
          braveApiKey: req.body.braveApiKey !== undefined && !req.body.braveApiKey.includes('***') ? req.body.braveApiKey : existing.braveApiKey,
          serperApiKey: req.body.serperApiKey !== undefined && !req.body.serperApiKey.includes('***') ? req.body.serperApiKey : existing.serperApiKey,
          vertexProjectId: req.body.vertexProjectId,
          vertexLocation: req.body.vertexLocation,
          vertexDataStoreId: req.body.vertexDataStoreId,
        };
        
        setSearchConfig(config, searchConfig);
        saveConfig(config);
        res.json({ ok: true });
      } catch (e: unknown) {
        res.status(500).json({ error: (e as Error).message });
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

  // ヘルパー: 現在の設定を読み込む
  private loadCurrentConfig(): Config {
    return loadConfig();
  }

  // ヘルパー: セッションのモデル名を取得
  private getSessionModel(sessionId: string): string {
    const config = this.loadCurrentConfig();
    const session = config.sessions[sessionId];
    if (!session) return '';
    return session.provider?.model || '';
  }
}