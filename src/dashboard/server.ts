import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import type { SessionManager } from '../core/sessions.js';
import type { DashboardEvent, Config, SessionConfig, SearchConfig } from '../types.js';
import { createLogger } from '../logger.js';
import { loadConfig, saveConfig, setSession, deleteSession, setSearchConfig, setEmbeddingConfig, ensureBuiltinMcpServer } from '../config.js';
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

    // API: read any artifact under session workspace (safe, read-only)
    this.app.get('/api/sessions/:id/artifacts/*', (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });

      const wildcardPath = req.params[0];
      if (!wildcardPath) return res.status(400).json({ error: 'Path required' });

      const decodedPath = String(wildcardPath)
        .split('/')
        .map((segment) => {
          try {
            return decodeURIComponent(segment);
          } catch {
            return segment;
          }
        })
        .join('/');

      const workspaceRoot = path.resolve(agent.getSessionDir());
      const targetPath = path.resolve(workspaceRoot, decodedPath);
      const inWorkspace = targetPath === workspaceRoot || targetPath.startsWith(`${workspaceRoot}${path.sep}`);

      if (!inWorkspace) return res.status(400).json({ error: 'Invalid path' });
      if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
        return res.status(404).json({ error: 'Not found' });
      }

      res.sendFile(targetPath);
    });

    // API: send message to session
    this.app.post('/api/sessions/:id/message', async (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });

      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'message required' });

      try {
        const response = await agent.processMessage(message, 'dashboard', req.body.imageUrls);
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

      const allowed = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'MEMORY.md'];
      const filename = req.params.filename;
      if (!allowed.includes(filename)) return res.status(403).json({ error: 'Not allowed' });

      const filePath = path.join(agent.getSessionDir(), filename);
      if (!fs.existsSync(filePath)) return res.json({ content: '' });
      res.json({ content: fs.readFileSync(filePath, 'utf-8') });
    });

    // API: read screenshot
    this.app.get('/api/sessions/:id/images/:filename', (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });
      const filePath = path.join(agent.getSessionDir(), 'screenshots', req.params.filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
      res.sendFile(filePath);
    });

    // API: read upload
    this.app.get('/api/sessions/:id/uploads/:filename', (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });
      const filePath = path.join(agent.getSessionDir(), 'uploads', req.params.filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
      res.sendFile(filePath);
    });

    // API: write workspace file
    this.app.put('/api/sessions/:id/files/:filename', (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });

      const allowed = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'MEMORY.md'];
      const filename = req.params.filename;
      if (!allowed.includes(filename)) return res.status(403).json({ error: 'Not allowed' });

      const { content } = req.body;
      const filePath = path.join(agent.getSessionDir(), filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      res.json({ ok: true });
    });

    // API: get long-term memory list
    this.app.get('/api/sessions/:id/memory', (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Session not found' });
      // Read vectors.json directly
      const vectorPath = path.join(agent.getSessionDir(), 'memory', 'vectors.json');
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
            contextWindow: 128000
          },
          workspace: req.body.workspace || `./data/sessions/${sessionId}`,
          restrictToWorkspace: req.body.restrictToWorkspace ?? true,
          allowSelfModify: req.body.allowSelfModify ?? false,
          tools: req.body.tools || { exec: true, web: true, memory: true },
          discord: req.body.discord,
        };
        
        ensureBuiltinMcpServer(newSession);
        
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

    // ==================== MCP Server API ====================

    // API: MCPサーバー一覧
    this.app.get('/api/sessions/:id/mcp', (req, res) => {
      const config = this.loadCurrentConfig();
      const session = config.sessions[req.params.id];
      if (!session) return res.status(404).json({ error: 'Session not found' });
      res.json(session.mcpServers || {});
    });

    // API: MCPサーバーステータス取得 (MUST be before /:serverId routes)
    this.app.get('/api/sessions/:id/mcp/status', (req, res) => {
      const agent = this.sessions.getAgent(req.params.id);
      if (!agent) {
        const config = this.loadCurrentConfig();
        const session = config.sessions[req.params.id];
        if (!session) return res.status(404).json({ error: 'Session not found' });
        const servers = session.mcpServers || {};
        const states = Object.entries(servers).map(([id, cfg]) => ({
          id,
          config: cfg,
          status: cfg.enabled === false ? 'stopped' : 'stopped',
          error: 'Session not running',
        }));
        return res.json(states);
      }
      res.json(agent.getMcpManager().getServerStates());
    });

    // API: MCPサーバー追加
    this.app.post('/api/sessions/:id/mcp', (req, res) => {
      try {
        const config = this.loadCurrentConfig();
        const session = config.sessions[req.params.id];
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const serverId = req.body.id;
        const type = req.body.type || 'command';
        if (!serverId) return res.status(400).json({ error: 'Server ID required' });
        if (type !== 'builtin-consult' && !req.body.command) return res.status(400).json({ error: 'Command required' });

        if (!session.mcpServers) session.mcpServers = {};
        if (session.mcpServers[serverId]) {
          return res.status(400).json({ error: 'MCP server already exists' });
        }

        session.mcpServers[serverId] = type === 'builtin-consult'
          ? {
              type: 'builtin-consult',
              endpointUrl: req.body.endpointUrl,
              apiKey: req.body.apiKey,
              model: req.body.model,
              enabled: req.body.enabled !== false,
            }
          : {
              command: req.body.command,
              args: req.body.args || [],
              env: req.body.env || {},
              enabled: req.body.enabled !== false,
            };

        saveConfig(config);
        res.json({ ok: true, server: session.mcpServers[serverId] });
      } catch (e: unknown) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    // API: MCPサーバー再起動 (MUST be before /:serverId PUT/DELETE)
    this.app.post('/api/sessions/:id/mcp/:serverId/restart', async (req, res) => {
      try {
        const agent = this.sessions.getAgent(req.params.id);
        if (!agent) return res.status(400).json({ error: 'Session not running' });

        const config = this.loadCurrentConfig();
        const session = config.sessions[req.params.id];
        if (!session?.mcpServers?.[req.params.serverId]) {
          return res.status(404).json({ error: 'MCP server not found in config' });
        }

        const mcpConfig = session.mcpServers[req.params.serverId];
        await agent.getMcpManager().restartServer(req.params.serverId, mcpConfig);

        const states = agent.getMcpManager().getServerStates();
        const state = states.find(s => s.id === req.params.serverId);
        res.json({ ok: true, state });
      } catch (e: unknown) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    // API: MCPサーバー更新
    this.app.put('/api/sessions/:id/mcp/:serverId', async (req, res) => {
      try {
        const config = this.loadCurrentConfig();
        const session = config.sessions[req.params.id];
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!session.mcpServers?.[req.params.serverId]) {
          return res.status(404).json({ error: 'MCP server not found' });
        }

        session.mcpServers[req.params.serverId] = {
          ...session.mcpServers[req.params.serverId],
          ...req.body,
        };

        saveConfig(config);

        // If enabled was set to false, stop the running MCP server process
        if (req.body.enabled === false) {
          const agent = this.sessions.getAgent(req.params.id);
          if (agent) {
            log.info(`Stopping MCP server "${req.params.serverId}" (disabled by user)...`);
            try {
              await agent.getMcpManager().stopServer(req.params.serverId);
              log.info(`MCP server "${req.params.serverId}" stopped successfully.`);
            } catch (e) {
              log.warn(`Failed to stop MCP server "${req.params.serverId}":`, e);
            }
          }
        }

        res.json({ ok: true, server: session.mcpServers[req.params.serverId] });
      } catch (e: unknown) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    // API: MCPサーバー削除
    this.app.delete('/api/sessions/:id/mcp/:serverId', async (req, res) => {
      try {
        const sessionId = req.params.id;
        const serverId = req.params.serverId;
        
        log.info(`Deleting MCP server "${serverId}" from session "${sessionId}"...`);

        const config = this.loadCurrentConfig();
        const session = config.sessions[sessionId];
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!session.mcpServers?.[serverId]) {
          return res.status(404).json({ error: 'MCP server not found' });
        }

        // Also stop the running server if active
        const agent = this.sessions.getAgent(sessionId);
        if (agent) {
          log.info(`Stopping running MCP server "${serverId}"...`);
          try {
            await agent.getMcpManager().stopServer(serverId);
            log.info(`MCP server "${serverId}" stopped successfully.`);
          } catch (e) {
            log.warn(`Failed to stop MCP server "${serverId}":`, e);
          }
        }

        delete session.mcpServers[serverId];
        saveConfig(config);
        log.info(`MCP server "${serverId}" deleted from config.`);
        
        res.json({ ok: true });
      } catch (e: unknown) {
        log.error('MCP server deletion error:', e);
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

    // API: embedding設定取得
    this.app.get('/api/embedding', (_req, res) => {
      const config = this.loadCurrentConfig();
      const embedding = config.embedding || { endpoint: '', apiKey: '', model: '' };
      res.json({
        endpoint: embedding.endpoint,
        apiKey: embedding.apiKey ? `${embedding.apiKey.slice(0, 8)}***` : '',
        model: embedding.model,
      });
    });

    // API: embedding設定更新
    this.app.put('/api/embedding', (req, res) => {
      try {
        const config = this.loadCurrentConfig();
        const existing = config.embedding || { endpoint: '', apiKey: '', model: '' };
        const embeddingConfig = {
          endpoint: req.body.endpoint ?? existing.endpoint,
          apiKey: req.body.apiKey !== undefined && !String(req.body.apiKey).includes('***') ? req.body.apiKey : existing.apiKey,
          model: req.body.model ?? existing.model,
        };
        setEmbeddingConfig(config, embeddingConfig);
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
