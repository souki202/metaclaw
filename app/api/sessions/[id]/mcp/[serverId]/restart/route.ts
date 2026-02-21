import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, notFound, badRequest } from '../../../../../helpers';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; serverId: string }> }
) {
  try {
    const { id, serverId } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);

    if (!agent) {
      return badRequest('Session not running');
    }

    const config = getConfigSafe();
    const session = config.sessions[id];

    if (!session?.mcpServers?.[serverId]) {
      return notFound('MCP server not found in config');
    }

    const mcpConfig = session.mcpServers[serverId];
    await agent.getMcpManager().restartServer(serverId, mcpConfig);

    const states = agent.getMcpManager().getServerStates();
    const state = states.find((s) => s.id === serverId);

    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return handleError(error);
  }
}
