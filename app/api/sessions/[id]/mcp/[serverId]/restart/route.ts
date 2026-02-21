import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, notFound, badRequest } from '../../../../../../helpers';

export async function POST(
  request: Request,
  { params }: { params: { id: string; serverId: string } }
) {
  try {
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(params.id);

    if (!agent) {
      return badRequest('Session not running');
    }

    const config = getConfigSafe();
    const session = config.sessions[params.id];

    if (!session?.mcpServers?.[params.serverId]) {
      return notFound('MCP server not found in config');
    }

    const mcpConfig = session.mcpServers[params.serverId];
    await agent.getMcpManager().restartServer(params.serverId, mcpConfig);

    const states = agent.getMcpManager().getServerStates();
    const state = states.find((s) => s.id === params.serverId);

    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return handleError(error);
  }
}
