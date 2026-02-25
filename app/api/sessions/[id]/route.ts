import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, notFound } from '../../helpers';
import { deleteSession, saveConfig } from '../../../../src/config';
import { broadcastSseEvent } from '../../../../src/global-state';

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

      // セッション削除をフロントエンドに通知
      broadcastSseEvent({
        type: 'session_list_update',
        sessionId: id,
        data: { action: 'deleted', id },
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({ ok: true });
    } else {
      return notFound('Session not found');
    }
  } catch (error) {
    return handleError(error);
  }
}
