import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import type { SessionManager } from '../core/sessions.js';
import type { Config, SessionConfig, SearchConfig } from '../types.js';
import { loadConfig, saveConfig, setSession, deleteSession, setSearchConfig, setEmbeddingConfig } from '../config.js';
import { loadSkills, type Skill } from '../core/skills.js';
import { createLogger } from '../logger.js';

const log = createLogger('api');

// Helper to parse request body
async function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Helper to send JSON response
function sendJson(res: ServerResponse, data: any, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// Route matcher
function matchRoute(pathname: string, pattern: string): { params: Record<string, string> } | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return { params };
}

export async function setupApiRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: SessionManager
): Promise<boolean> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method!;

  // GET /api/sessions
  if (method === 'GET' && pathname === '/api/sessions') {
    const ids = sessions.getSessionIds();
    const configs = sessions.getSessionConfigs();
    sendJson(
      res,
      ids.map((id) => ({
        id,
        name: configs[id]?.name ?? id,
        description: configs[id]?.description ?? '',
        model: configs[id]?.provider?.model || '',
        workspace: sessions.resolveWorkspace(configs[id]),
        provider: configs[id]?.provider,
        tools: configs[id]?.tools,
        allowSelfModify: configs[id]?.allowSelfModify,
        discord: configs[id]?.discord,
      }))
    );
    return true;
  }

  // GET /api/sessions/:id/history
  const historyMatch = matchRoute(pathname, '/api/sessions/:id/history');
  if (method === 'GET' && historyMatch) {
    const agent = sessions.getAgent(historyMatch.params.id);
    if (!agent) {
      sendJson(res, { error: 'Session not found' }, 404);
      return true;
    }
    sendJson(res, agent.getHistory());
    return true;
  }

  // POST /api/sessions/:id/message
  const messageMatch = matchRoute(pathname, '/api/sessions/:id/message');
  if (method === 'POST' && messageMatch) {
    const agent = sessions.getAgent(messageMatch.params.id);
    if (!agent) {
      sendJson(res, { error: 'Session not found' }, 404);
      return true;
    }

    try {
      const body = await parseBody(req);
      if (!body.message) {
        sendJson(res, { error: 'message required' }, 400);
        return true;
      }
      const response = await agent.processMessage(body.message, 'dashboard', body.imageUrls);
      sendJson(res, { response });
    } catch (e: unknown) {
      sendJson(res, { error: (e as Error).message }, 500);
    }
    return true;
  }

  // DELETE /api/sessions/:id/history
  const clearHistoryMatch = matchRoute(pathname, '/api/sessions/:id/history');
  if (method === 'DELETE' && clearHistoryMatch) {
    const agent = sessions.getAgent(clearHistoryMatch.params.id);
    if (!agent) {
      sendJson(res, { error: 'Session not found' }, 404);
      return true;
    }
    agent.clearHistory();
    sendJson(res, { ok: true });
    return true;
  }

  // GET /api/sessions/:id/files/:filename
  const getFileMatch = matchRoute(pathname, '/api/sessions/:id/files/:filename');
  if (method === 'GET' && getFileMatch) {
    const agent = sessions.getAgent(getFileMatch.params.id);
    if (!agent) {
      sendJson(res, { error: 'Session not found' }, 404);
      return true;
    }

    const allowed = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'MEMORY.md'];
    const filename = getFileMatch.params.filename;
    if (!allowed.includes(filename)) {
      sendJson(res, { error: 'Not allowed' }, 403);
      return true;
    }

    const filePath = path.join(agent.getSessionDir(), filename);
    if (!fs.existsSync(filePath)) {
      sendJson(res, { content: '' });
      return true;
    }
    sendJson(res, { content: fs.readFileSync(filePath, 'utf-8') });
    return true;
  }

  // GET /api/sessions/:id/images/:filename
  const getImagesMatch = matchRoute(pathname, '/api/sessions/:id/images/:filename');
  if (method === 'GET' && getImagesMatch) {
    const agent = sessions.getAgent(getImagesMatch.params.id);
    if (!agent) {
      sendJson(res, { error: 'Session not found' }, 404);
      return true;
    }
    const filePath = path.join(agent.getSessionDir(), 'screenshots', getImagesMatch.params.filename);
    if (!fs.existsSync(filePath)) {
      sendJson(res, { error: 'Not found' }, 404);
      return true;
    }
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  // GET /api/sessions/:id/uploads/:filename
  const getUploadsMatch = matchRoute(pathname, '/api/sessions/:id/uploads/:filename');
  if (method === 'GET' && getUploadsMatch) {
    const agent = sessions.getAgent(getUploadsMatch.params.id);
    if (!agent) {
      sendJson(res, { error: 'Session not found' }, 404);
      return true;
    }
    const filePath = path.join(agent.getSessionDir(), 'uploads', getUploadsMatch.params.filename);
    if (!fs.existsSync(filePath)) {
      sendJson(res, { error: 'Not found' }, 404);
      return true;
    }
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  // PUT /api/sessions/:id/files/:filename
  const putFileMatch = matchRoute(pathname, '/api/sessions/:id/files/:filename');
  if (method === 'PUT' && putFileMatch) {
    const agent = sessions.getAgent(putFileMatch.params.id);
    if (!agent) {
      sendJson(res, { error: 'Session not found' }, 404);
      return true;
    }

    const allowed = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'MEMORY.md'];
    const filename = putFileMatch.params.filename;
    if (!allowed.includes(filename)) {
      sendJson(res, { error: 'Not allowed' }, 403);
      return true;
    }

    try {
      const body = await parseBody(req);
      const filePath = path.join(agent.getSessionDir(), filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, body.content, 'utf-8');
      sendJson(res, { ok: true });
    } catch (e: unknown) {
      sendJson(res, { error: (e as Error).message }, 500);
    }
    return true;
  }

  // GET /api/sessions/:id/memory
  const memoryMatch = matchRoute(pathname, '/api/sessions/:id/memory');
  if (method === 'GET' && memoryMatch) {
    const agent = sessions.getAgent(memoryMatch.params.id);
    if (!agent) {
      sendJson(res, { error: 'Session not found' }, 404);
      return true;
    }
    const vectorPath = path.join(agent.getSessionDir(), 'memory', 'vectors.json');
    if (!fs.existsSync(vectorPath)) {
      sendJson(res, []);
      return true;
    }
    try {
      const entries = JSON.parse(fs.readFileSync(vectorPath, 'utf-8'));
      sendJson(
        res,
        entries.map((e: { id: string; text: string; metadata: unknown }) => ({ id: e.id, text: e.text, metadata: e.metadata }))
      );
    } catch {
      sendJson(res, []);
    }
    return true;
  }

  // GET /api/sessions/:id/skills
  const skillsMatch = matchRoute(pathname, '/api/sessions/:id/skills');
  if (method === 'GET' && skillsMatch) {
    const agent = sessions.getAgent(skillsMatch.params.id);
    if (!agent) {
      sendJson(res, { error: 'Session not found' }, 404);
      return true;
    }
    const skills = loadSkills([process.cwd(), agent.getWorkspace()]);
    sendJson(res, skills.map((s: Skill) => ({ name: s.name, description: s.description })));
    return true;
  }

  // GET /api/sessions/:id/config
  const getConfigMatch = matchRoute(pathname, '/api/sessions/:id/config');
  if (method === 'GET' && getConfigMatch) {
    const config = loadConfig();
    const session = config.sessions[getConfigMatch.params.id];
    if (!session) {
      sendJson(res, { error: 'Session not found' }, 404);
      return true;
    }
    sendJson(res, session);
    return true;
  }

  // PUT /api/sessions/:id/config
  const putConfigMatch = matchRoute(pathname, '/api/sessions/:id/config');
  if (method === 'PUT' && putConfigMatch) {
    try {
      const config = loadConfig();
      const existing = config.sessions[putConfigMatch.params.id];
      if (!existing) {
        sendJson(res, { error: 'Session not found' }, 404);
        return true;
      }

      const body = await parseBody(req);
      const updated: SessionConfig = { ...existing, ...body };
      setSession(config, putConfigMatch.params.id, updated);
      saveConfig(config);
      sendJson(res, { ok: true, session: updated });
    } catch (e: unknown) {
      sendJson(res, { error: (e as Error).message }, 500);
    }
    return true;
  }

  // PUT /api/sessions/:id/discord
  const putDiscordMatch = matchRoute(pathname, '/api/sessions/:id/discord');
  if (method === 'PUT' && putDiscordMatch) {
    try {
      const config = loadConfig();
      const session = config.sessions[putDiscordMatch.params.id];
      if (!session) {
        sendJson(res, { error: 'Session not found' }, 404);
        return true;
      }

      const body = await parseBody(req);
      session.discord = {
        enabled: body.enabled ?? false,
        token: body.token,
        channels: body.channels || [],
        guilds: body.guilds || [],
        allowFrom: body.allowFrom || [],
        prefix: body.prefix,
      };

      saveConfig(config);
      sendJson(res, { ok: true, discord: session.discord });
    } catch (e: unknown) {
      sendJson(res, { error: (e as Error).message }, 500);
    }
    return true;
  }

  // POST /api/sessions
  if (method === 'POST' && pathname === '/api/sessions') {
    try {
      const config = loadConfig();
      const body = await parseBody(req);
      const sessionId = body.id || `session_${Date.now()}`;

      if (config.sessions[sessionId]) {
        sendJson(res, { error: 'Session already exists' }, 400);
        return true;
      }

      const newSession: SessionConfig = {
        name: body.name || sessionId,
        description: body.description,
        provider: body.provider || {
          endpoint: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o',
          contextWindow: 128000,
        },
        workspace: body.workspace || `./data/sessions/${sessionId}`,
        restrictToWorkspace: body.restrictToWorkspace ?? true,
        allowSelfModify: body.allowSelfModify ?? false,
        tools: body.tools || { exec: true, web: true, memory: true },
        discord: body.discord,
      };

      setSession(config, sessionId, newSession);
      saveConfig(config);
      sendJson(res, { ok: true, id: sessionId, session: newSession });
    } catch (e: unknown) {
      sendJson(res, { error: (e as Error).message }, 500);
    }
    return true;
  }

  // DELETE /api/sessions/:id
  const deleteSessionMatch = matchRoute(pathname, '/api/sessions/:id');
  if (method === 'DELETE' && deleteSessionMatch && !pathname.includes('/history')) {
    try {
      const config = loadConfig();
      if (deleteSession(config, deleteSessionMatch.params.id)) {
        saveConfig(config);
        sessions.deleteSession(deleteSessionMatch.params.id);
        sendJson(res, { ok: true });
      } else {
        sendJson(res, { error: 'Session not found' }, 404);
      }
    } catch (e: unknown) {
      sendJson(res, { error: (e as Error).message }, 500);
    }
    return true;
  }

  // MCP Routes
  // GET /api/sessions/:id/mcp
  const getMcpMatch = matchRoute(pathname, '/api/sessions/:id/mcp');
  if (method === 'GET' && getMcpMatch && !pathname.includes('/status')) {
    const config = loadConfig();
    const session = config.sessions[getMcpMatch.params.id];
    if (!session) {
      sendJson(res, { error: 'Session not found' }, 404);
      return true;
    }
    sendJson(res, session.mcpServers || {});
    return true;
  }

  // GET /api/sessions/:id/mcp/status
  const getMcpStatusMatch = matchRoute(pathname, '/api/sessions/:id/mcp/status');
  if (method === 'GET' && getMcpStatusMatch) {
    const agent = sessions.getAgent(getMcpStatusMatch.params.id);
    if (!agent) {
      const config = loadConfig();
      const session = config.sessions[getMcpStatusMatch.params.id];
      if (!session) {
        sendJson(res, { error: 'Session not found' }, 404);
        return true;
      }
      const servers = session.mcpServers || {};
      const states = Object.entries(servers).map(([id, cfg]) => ({
        id,
        config: cfg,
        status: cfg.enabled === false ? 'stopped' : 'stopped',
        error: 'Session not running',
      }));
      sendJson(res, states);
      return true;
    }
    sendJson(res, agent.getMcpManager().getServerStates());
    return true;
  }

  // POST /api/sessions/:id/mcp
  const postMcpMatch = matchRoute(pathname, '/api/sessions/:id/mcp');
  if (method === 'POST' && postMcpMatch && !pathname.includes('/restart')) {
    try {
      const config = loadConfig();
      const session = config.sessions[postMcpMatch.params.id];
      if (!session) {
        sendJson(res, { error: 'Session not found' }, 404);
        return true;
      }

      const body = await parseBody(req);
      const serverId = body.id;
      const type = body.type || 'command';
      if (!serverId) {
        sendJson(res, { error: 'Server ID required' }, 400);
        return true;
      }
      if (type !== 'builtin-consult' && !body.command) {
        sendJson(res, { error: 'Command required' }, 400);
        return true;
      }

      if (!session.mcpServers) session.mcpServers = {};
      if (session.mcpServers[serverId]) {
        sendJson(res, { error: 'MCP server already exists' }, 400);
        return true;
      }

      session.mcpServers[serverId] = type === 'builtin-consult'
        ? {
            type: 'builtin-consult',
            endpointUrl: body.endpointUrl,
            apiKey: body.apiKey,
            model: body.model,
            enabled: body.enabled !== false,
          }
        : {
            command: body.command,
            args: body.args || [],
            env: body.env || {},
            enabled: body.enabled !== false,
          };

      saveConfig(config);
      sendJson(res, { ok: true, server: session.mcpServers[serverId] });
    } catch (e: unknown) {
      sendJson(res, { error: (e as Error).message }, 500);
    }
    return true;
  }

  // POST /api/sessions/:id/mcp/:serverId/restart
  const restartMcpMatch = matchRoute(pathname, '/api/sessions/:id/mcp/:serverId/restart');
  if (method === 'POST' && restartMcpMatch) {
    try {
      const agent = sessions.getAgent(restartMcpMatch.params.id);
      if (!agent) {
        sendJson(res, { error: 'Session not running' }, 400);
        return true;
      }

      const config = loadConfig();
      const session = config.sessions[restartMcpMatch.params.id];
      if (!session?.mcpServers?.[restartMcpMatch.params.serverId]) {
        sendJson(res, { error: 'MCP server not found in config' }, 404);
        return true;
      }

      const mcpConfig = session.mcpServers[restartMcpMatch.params.serverId];
      await agent.getMcpManager().restartServer(restartMcpMatch.params.serverId, mcpConfig);

      const states = agent.getMcpManager().getServerStates();
      const state = states.find((s) => s.id === restartMcpMatch.params.serverId);
      sendJson(res, { ok: true, state });
    } catch (e: unknown) {
      sendJson(res, { error: (e as Error).message }, 500);
    }
    return true;
  }

  // PUT /api/sessions/:id/mcp/:serverId
  const putMcpMatch = matchRoute(pathname, '/api/sessions/:id/mcp/:serverId');
  if (method === 'PUT' && putMcpMatch) {
    try {
      const config = loadConfig();
      const session = config.sessions[putMcpMatch.params.id];
      if (!session) {
        sendJson(res, { error: 'Session not found' }, 404);
        return true;
      }
      if (!session.mcpServers?.[putMcpMatch.params.serverId]) {
        sendJson(res, { error: 'MCP server not found' }, 404);
        return true;
      }

      const body = await parseBody(req);
      session.mcpServers[putMcpMatch.params.serverId] = {
        ...session.mcpServers[putMcpMatch.params.serverId],
        ...body,
      };

      saveConfig(config);
      sendJson(res, { ok: true, server: session.mcpServers[putMcpMatch.params.serverId] });
    } catch (e: unknown) {
      sendJson(res, { error: (e as Error).message }, 500);
    }
    return true;
  }

  // DELETE /api/sessions/:id/mcp/:serverId
  const deleteMcpMatch = matchRoute(pathname, '/api/sessions/:id/mcp/:serverId');
  if (method === 'DELETE' && deleteMcpMatch) {
    try {
      const sessionId = deleteMcpMatch.params.id;
      const serverId = deleteMcpMatch.params.serverId;

      log.info(`Deleting MCP server "${serverId}" from session "${sessionId}"...`);

      const config = loadConfig();
      const session = config.sessions[sessionId];
      if (!session) {
        sendJson(res, { error: 'Session not found' }, 404);
        return true;
      }
      if (!session.mcpServers?.[serverId]) {
        sendJson(res, { error: 'MCP server not found' }, 404);
        return true;
      }

      const agent = sessions.getAgent(sessionId);
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

      sendJson(res, { ok: true });
    } catch (e: unknown) {
      log.error('MCP server deletion error:', e);
      sendJson(res, { error: (e as Error).message }, 500);
    }
    return true;
  }

  // GET /api/config
  if (method === 'GET' && pathname === '/api/config') {
    const config = loadConfig();
    sendJson(res, {
      dashboard: config.dashboard,
      search: config.search,
      sessionCount: Object.keys(config.sessions).length,
    });
    return true;
  }

  // GET /api/skills
  if (method === 'GET' && pathname === '/api/skills') {
    const skills = loadSkills([process.cwd()]);
    sendJson(res, skills.map((s: Skill) => ({ name: s.name, description: s.description })));
    return true;
  }

  // GET /api/search
  if (method === 'GET' && pathname === '/api/search') {
    const config = loadConfig();
    const search = config.search || { provider: 'brave' };
    sendJson(res, {
      ...search,
      braveApiKey: search.braveApiKey ? `${search.braveApiKey.slice(0, 8)}***` : '',
      serperApiKey: search.serperApiKey ? `${search.serperApiKey.slice(0, 8)}***` : '',
    });
    return true;
  }

  // PUT /api/search
  if (method === 'PUT' && pathname === '/api/search') {
    try {
      const config = loadConfig();
      const existing = (config.search || { provider: 'brave' }) as SearchConfig;

      const body = await parseBody(req);
      const searchConfig: SearchConfig = {
        provider: body.provider || 'brave',
        braveApiKey: body.braveApiKey !== undefined && !body.braveApiKey.includes('***') ? body.braveApiKey : existing.braveApiKey,
        serperApiKey: body.serperApiKey !== undefined && !body.serperApiKey.includes('***') ? body.serperApiKey : existing.serperApiKey,
        vertexProjectId: body.vertexProjectId,
        vertexLocation: body.vertexLocation,
        vertexDataStoreId: body.vertexDataStoreId,
      };

      setSearchConfig(config, searchConfig);
      saveConfig(config);
      sendJson(res, { ok: true });
    } catch (e: unknown) {
      sendJson(res, { error: (e as Error).message }, 500);
    }
    return true;
  }

  // GET /api/embedding
  if (method === 'GET' && pathname === '/api/embedding') {
    const config = loadConfig();
    const embedding = config.embedding || { endpoint: '', apiKey: '', model: '' };
    sendJson(res, {
      endpoint: embedding.endpoint,
      apiKey: embedding.apiKey ? `${embedding.apiKey.slice(0, 8)}***` : '',
      model: embedding.model,
    });
    return true;
  }

  // PUT /api/embedding
  if (method === 'PUT' && pathname === '/api/embedding') {
    try {
      const config = loadConfig();
      const existing = config.embedding || { endpoint: '', apiKey: '', model: '' };
      const body = await parseBody(req);
      const embeddingConfig = {
        endpoint: body.endpoint ?? existing.endpoint,
        apiKey: body.apiKey !== undefined && !String(body.apiKey).includes('***') ? body.apiKey : existing.apiKey,
        model: body.model ?? existing.model,
      };
      setEmbeddingConfig(config, embeddingConfig);
      saveConfig(config);
      sendJson(res, { ok: true });
    } catch (e: unknown) {
      sendJson(res, { error: (e as Error).message }, 500);
    }
    return true;
  }

  // GET /api/system
  if (method === 'GET' && pathname === '/api/system') {
    sendJson(res, {
      version: '1.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      sessions: sessions.getSessionIds().length,
    });
    return true;
  }

  return false;
}
