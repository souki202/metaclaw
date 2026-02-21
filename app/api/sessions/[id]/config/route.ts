import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, notFound } from '../../../helpers';
import { setSession, saveConfig } from '../../../../src/config';
import type { SessionConfig } from '../../../../src/types';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const config = getConfigSafe();
    const session = config.sessions[params.id];

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
  { params }: { params: { id: string } }
) {
  try {
    const config = getConfigSafe();
    const existing = config.sessions[params.id];

    if (!existing) {
      return notFound('Session not found');
    }

    const body = await request.json();
    const updated: SessionConfig = { ...existing, ...body };

    setSession(config, params.id, updated);
    saveConfig(config);

    return NextResponse.json({ ok: true, session: updated });
  } catch (error) {
    return handleError(error);
  }
}
