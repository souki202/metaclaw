import { NextResponse } from 'next/server';
import { PtyManager } from '../../../../../src/tools/pty-manager';
import { getSessionManagerSafe, handleError, notFound, badRequest } from '../../../helpers';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessions = getSessionManagerSafe();
    const config = sessions.getSessionConfig(id);

    if (!config) {
      return notFound('Session not found');
    }

    const workspace = sessions.resolveWorkspace(config);
    const manager = PtyManager.getInstance();
    manager.getOrCreate(id, workspace);

    const body = await request.json().catch(() => ({}));

    if (typeof body.input === 'string') {
      manager.write(id, body.input);
      return NextResponse.json({ ok: true });
    }

    if (
      body.resize &&
      typeof body.resize.cols === 'number' &&
      typeof body.resize.rows === 'number'
    ) {
      manager.resize(id, body.resize.cols, body.resize.rows);
      return NextResponse.json({ ok: true });
    }

    return badRequest('input or resize required');
  } catch (error) {
    return handleError(error);
  }
}