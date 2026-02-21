import { NextResponse } from 'next/server';
import { getSessionManagerSafe, handleError, notFound } from '../../../helpers';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(params.id);

    if (!agent) {
      return notFound('Session not found');
    }

    return NextResponse.json(agent.getHistory());
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(params.id);

    if (!agent) {
      return notFound('Session not found');
    }

    agent.clearHistory();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
