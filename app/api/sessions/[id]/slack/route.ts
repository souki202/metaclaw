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
    session.slack = {
      enabled: body.enabled ?? false,
      botToken: body.botToken,
      appToken: body.appToken,
      channels: body.channels || [],
      teams: body.teams || [],
      allowFrom: body.allowFrom || [],
      prefix: body.prefix,
    };

    saveConfig(config);
    return NextResponse.json({ ok: true, slack: session.slack });
  } catch (error) {
    return handleError(error);
  }
}
