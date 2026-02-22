import { NextResponse } from 'next/server';
import { getSessionManagerSafe, handleError, notFound } from '../../../helpers';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);

    if (!agent) {
      return notFound('Session not found');
    }

    agent.cancelProcessing();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
