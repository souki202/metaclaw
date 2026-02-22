import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, notFound } from '../../../helpers';
import { setSession, saveConfig } from '../../../../../src/config';
import type { SessionConfig } from '../../../../../src/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const config = getConfigSafe();
    const session = config.sessions[id];

    if (!session) {
      return notFound('Session not found');
    }

    return NextResponse.json(session);
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const config = getConfigSafe();
    const existing = config.sessions[id];

    if (!existing) {
      return notFound('Session not found');
    }

    const body = await request.json();
    const updated: SessionConfig = { ...existing, ...body };

    setSession(config, id, updated);
    saveConfig(config);

    const sessions = getSessionManagerSafe();
    sessions.getAgent(id)?.updateConfig(updated);

    return NextResponse.json({ ok: true, session: updated });
  } catch (error) {
    return handleError(error);
  }
}
