import { NextResponse } from 'next/server';
import { getConfigSafe, handleError } from '../helpers';

export async function GET() {
  try {
    const config = getConfigSafe();

    return NextResponse.json({
      dashboard: config.dashboard,
      search: config.search,
      sessionCount: Object.keys(config.sessions).length,
    });
  } catch (error) {
    return handleError(error);
  }
}
