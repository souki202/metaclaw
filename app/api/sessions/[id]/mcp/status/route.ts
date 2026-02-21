import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, notFound } from '../../../../helpers';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(params.id);

    if (!agent) {
      const config = getConfigSafe();
      const session = config.sessions[params.id];

      if (!session) {
        return notFound('Session not found');
      }

      const servers = session.mcpServers || {};
      const states = Object.entries(servers).map(([id, cfg]) => ({
        id,
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
