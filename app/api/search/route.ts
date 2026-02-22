import { NextResponse } from 'next/server';
import { getConfigSafe, handleError } from '../helpers';
import { setSearchConfig, saveConfig } from '../../../src/config';
import type { SearchConfig } from '../../../src/types';

export async function GET() {
  try {
    const config = getConfigSafe();
    const search = config.search || { provider: 'brave' };

    return NextResponse.json({
      ...search,
      braveApiKey: search.braveApiKey ? `${search.braveApiKey.slice(0, 8)}***` : '',
      serperApiKey: search.serperApiKey ? `${search.serperApiKey.slice(0, 8)}***` : '',
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const config = getConfigSafe();
    const existing = (config.search || { provider: 'brave' }) as SearchConfig;
    const body = await request.json();

    const searchConfig: SearchConfig = {
      provider: body.provider || 'brave',
      braveApiKey:
        body.braveApiKey !== undefined && !body.braveApiKey.includes('***')
          ? body.braveApiKey
          : existing.braveApiKey,
      serperApiKey:
        body.serperApiKey !== undefined && !body.serperApiKey.includes('***')
          ? body.serperApiKey
          : existing.serperApiKey,
      vertexProjectId: body.vertexProjectId,
      vertexLocation: body.vertexLocation,
      vertexDataStoreId: body.vertexDataStoreId,
    };

    setSearchConfig(config, searchConfig);
    saveConfig(config);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
