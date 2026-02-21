import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, notFound, badRequest } from '../../../helpers';
import { saveConfig } from '../../../../../src/config';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const config = getConfigSafe();
    const session = config.sessions[params.id];

    if (!session) {
      return notFound('Session not found');
    }

    return NextResponse.json(session.mcpServers || {});
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const config = getConfigSafe();
    const session = config.sessions[params.id];

    if (!session) {
      return notFound('Session not found');
    }

    const body = await request.json();
    const serverId = body.id;

    if (!serverId) {
      return badRequest('Server ID required');
    }
    if (!body.command) {
      return badRequest('Command required');
    }

    if (!session.mcpServers) session.mcpServers = {};
    if (session.mcpServers[serverId]) {
      return badRequest('MCP server already exists');
    }

    session.mcpServers[serverId] = {
      command: body.command,
      args: body.args || [],
      env: body.env || {},
      enabled: body.enabled !== false,
    };

    saveConfig(config);
    return NextResponse.json({ ok: true, server: session.mcpServers[serverId] });
  } catch (error) {
    return handleError(error);
  }
}
