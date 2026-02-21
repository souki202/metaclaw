import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, notFound } from '../../helpers';
import { deleteSession, saveConfig } from '../../../../src/config';

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const config = getConfigSafe();
    const sessions = getSessionManagerSafe();
    const sessionId = params.id;

    if (deleteSession(config, sessionId)) {
      saveConfig(config);
      sessions.stopSession(sessionId);
      return NextResponse.json({ ok: true });
    } else {
      return notFound('Session not found');
    }
  } catch (error) {
    return handleError(error);
  }
}
