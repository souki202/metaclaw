import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, notFound } from '../../../../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);

    if (!agent) {
      const config = getConfigSafe();
      const session = config.sessions[id];

      if (!session) {
        return notFound('Session not found');
      }

      const servers = session.mcpServers || {};
      const states = Object.entries(servers).map(([serverId, cfg]) => ({
        id: serverId,
        config: cfg,
        status: cfg.enabled === false ? 'stopped' : 'stopped',
        error: 'Session not running',
      }));

      return NextResponse.json(states);
    }

    return NextResponse.json(agent.getMcpManager().getServerStates());
  } catch (error) {
    return handleError(error);
  }
}
