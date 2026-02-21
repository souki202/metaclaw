import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, notFound, badRequest } from '../../../../../helpers';
import { saveConfig } from '../../../../../../src/config';
import { createLogger } from '../../../../../../src/logger';

const log = createLogger('api');

export async function PUT(
  request: Request,
  { params }: { params: { id: string; serverId: string } }
) {
  try {
    const config = getConfigSafe();
    const session = config.sessions[params.id];

    if (!session) {
      return notFound('Session not found');
    }

    if (!session.mcpServers?.[params.serverId]) {
      return notFound('MCP server not found');
    }

    const body = await request.json();
    session.mcpServers[params.serverId] = {
      ...session.mcpServers[params.serverId],
      ...body,
    };

    saveConfig(config);
    return NextResponse.json({ ok: true, server: session.mcpServers[params.serverId] });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; serverId: string } }
) {
  try {
    const sessionId = params.id;
    const serverId = params.serverId;
    const sessions = getSessionManagerSafe();
    const config = getConfigSafe();

    log.info(`Deleting MCP server "${serverId}" from session "${sessionId}"...`);

    const session = config.sessions[sessionId];
    if (!session) {
      return notFound('Session not found');
    }

    if (!session.mcpServers?.[serverId]) {
      return notFound('MCP server not found');
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

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error('MCP server deletion error:', error);
    return handleError(error);
  }
}
