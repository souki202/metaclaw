import { NextResponse } from 'next/server';
import { getConfigSafe, handleError } from '../helpers';
import { saveConfig } from '../../../src/config';

export async function GET() {
  try {
    const config = getConfigSafe();
    return NextResponse.json(config.providerTemplates || {});
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const config = getConfigSafe();
    const body = await request.json();

    config.providerTemplates = body;
    saveConfig(config);

    return NextResponse.json({ ok: true, providerTemplates: config.providerTemplates });
  } catch (error) {
    return handleError(error);
  }
}
