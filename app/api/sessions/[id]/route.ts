import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, notFound } from '../../helpers';
import { deleteSession, saveConfig } from '../../../../src/config';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const config = getConfigSafe();
    const sessions = getSessionManagerSafe();

    if (deleteSession(config, id)) {
      saveConfig(config);
      sessions.deleteSession(id);
      return NextResponse.json({ ok: true });
    } else {
      return notFound('Session not found');
    }
  } catch (error) {
    return handleError(error);
  }
}
