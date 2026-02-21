import { NextResponse } from 'next/server';
import { getConfigSafe, handleError, notFound } from '../../../helpers';
import { saveConfig } from '../../../../../src/config';

export async function PUT(
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

    const body = await request.json();
    session.discord = {
      enabled: body.enabled ?? false,
      token: body.token,
      channels: body.channels || [],
      guilds: body.guilds || [],
      allowFrom: body.allowFrom || [],
      prefix: body.prefix,
    };

    saveConfig(config);
    return NextResponse.json({ ok: true, discord: session.discord });
  } catch (error) {
    return handleError(error);
  }
}
