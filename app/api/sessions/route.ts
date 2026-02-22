import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, badRequest } from '../helpers';
import { setSession, saveConfig } from '../../../src/config';
import type { SessionConfig, DashboardEvent } from '../../../src/types';
import { broadcastSseEvent } from '../../../src/global-state';

export async function GET() {
  try {
    const sessions = getSessionManagerSafe();
    const ids = sessions.getSessionIds();
    const configs = sessions.getSessionConfigs();

    const sessionList = ids.map((id) => ({
      id,
      name: configs[id]?.name ?? id,
      description: configs[id]?.description ?? '',
      model: configs[id]?.provider?.model || '',
      workspace: sessions.resolveWorkspace(configs[id]),
      provider: configs[id]?.provider,
      tools: configs[id]?.tools,
      allowSelfModify: configs[id]?.allowSelfModify,
      discord: configs[id]?.discord,
    }));

    return NextResponse.json(sessionList);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const config = getConfigSafe();
    const body = await request.json();
    const sessionId = body.id || `session_${Date.now()}`;

    if (config.sessions[sessionId]) {
      return badRequest('Session already exists');
    }

    const newSession: SessionConfig = {
      name: body.name || sessionId,
      description: body.description,
      provider: body.provider || {
        endpoint: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o',
        embeddingModel: 'text-embedding-3-small',
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

    const sessions = getSessionManagerSafe();
    sessions.startSession(sessionId, newSession, (event) => {
      broadcastSseEvent({
        type: event.type as DashboardEvent['type'],
        sessionId: event.sessionId,
        data: event.data,
        timestamp: new Date().toISOString(),
      });
    });

    return NextResponse.json({ ok: true, id: sessionId, session: newSession });
  } catch (error) {
    return handleError(error);
  }
}
