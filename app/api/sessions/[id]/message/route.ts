import { NextResponse } from 'next/server';
import { getSessionManagerSafe, handleError, notFound, badRequest } from '../../../helpers';

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

    const body = await request.json();
    if (!body.message) {
      return badRequest('message required');
    }

    const response = await agent.processMessage(body.message, 'dashboard');
    return NextResponse.json({ response });
  } catch (error) {
    return handleError(error);
  }
}
