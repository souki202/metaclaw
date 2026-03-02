import { GoogleAuth } from 'google-auth-library';
import type { ToolDefinition, ToolResult, SearchConfig } from '../types.js';
import type { ToolContext } from './context.js';
import { htmlToText } from './html-utils.js';

function normalizeFreshnessToBrave(freshness?: string): string | undefined {
  if (!freshness) return undefined;

  const trimmed = freshness.trim();
  const lower = trimmed.toLowerCase();
  const aliasMap: Record<string, string> = {
    day: 'pd',
    week: 'pw',
    month: 'pm',
    year: 'py',
    pd: 'pd',
    pw: 'pw',
    pm: 'pm',
    py: 'py',
  };

  if (aliasMap[lower]) return aliasMap[lower];
  if (/^\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2}$/i.test(trimmed)) return trimmed;
  return undefined;
}

function normalizeFreshnessToSerperTbs(freshness?: string): string | undefined {
  const braveFreshness = normalizeFreshnessToBrave(freshness);
  if (!braveFreshness) return undefined;

  const map: Record<string, string> = {
    pd: 'qdr:d',
    pw: 'qdr:w',
    pm: 'qdr:m',
    py: 'qdr:y',
  };

  return map[braveFreshness];
}

export async function webFetch(url: string | string[], selector?: string): Promise<ToolResult> {
  const urls = Array.isArray(url) ? url : [url];
  const results: string[] = [];

  for (const targetUrl of urls) {
    try {
      new URL(targetUrl);
    } catch {
      results.push(`--- Content from: ${targetUrl} ---\nInvalid URL.`);
      continue;
    }

    try {
      const response = await fetch(targetUrl, {
        headers: { 'User-Agent': 'meta-claw/1.0 (personal AI agent)' },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        results.push(`--- Content from: ${targetUrl} ---\nHTTP ${response.status}: ${response.statusText}`);
        continue;
      }

      const contentType = response.headers.get('content-type') ?? '';
      let output = '';
      if (contentType.includes('application/json')) {
        const json = await response.json();
        output = JSON.stringify(json, null, 2);
      } else {
        const text = await response.text();
        output = htmlToText(text);
      }

      // Limit per-page content to ~4000 chars to allow multiple pages in context
      results.push(`--- Content from: ${targetUrl} ---\n${output.slice(0, 4000)}`);
    } catch (e: unknown) {
      results.push(`--- Content from: ${targetUrl} ---\nFetch error: ${(e as Error).message}`);
    }
  }

  const finalOutput = results.join('\n\n');
  return {
    success: results.some(r => !r.includes('Invalid URL.') && !r.includes('HTTP ') && !r.includes('Fetch error:')),
    output: finalOutput.slice(0, 12000)
  };
}

export async function webSearch(query: string, config?: SearchConfig, freshness?: string): Promise<ToolResult> {
  const provider = config?.provider || 'brave';
  const braveFreshness = normalizeFreshnessToBrave(freshness);
  const serperTbs = normalizeFreshnessToSerperTbs(freshness);
  const hasFreshnessInput = typeof freshness === 'string' && freshness.trim().length > 0;

  if (hasFreshnessInput && !braveFreshness) {
    return {
      success: false,
      output: 'Invalid freshness value. Use day/week/month/year, pd/pw/pm/py, or YYYY-MM-DDtoYYYY-MM-DD.'
    };
  }

  try {
    if (provider === 'vertex') {
      const projectId = config?.vertexProjectId;
      const location = config?.vertexLocation || 'global';
      const datastoreId = config?.vertexDataStoreId;

      if (!projectId || !datastoreId) {
        return { success: false, output: 'Vertex AI Search requires Project ID and Datastore ID' };
      }

      const auth = new GoogleAuth({
        scopes: 'https://www.googleapis.com/auth/cloud-platform',
      });
      const client = await auth.getClient();
      const token = await client.getAccessToken();

      const url = `https://discoveryengine.googleapis.com/v1alpha/projects/${projectId}/locations/${location}/collections/default_collection/dataStores/${datastoreId}/servingConfigs/default_search:search`;

      const payload = {
        query: query,
        pageSize: 10,
        ...(hasFreshnessInput ? { orderBy: 'updateTime desc' } : {}),
        queryExpansionSpec: { condition: 'AUTO' },
        spellCorrectionSpec: { mode: 'AUTO' }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return { success: false, output: `Vertex Search API Error: ${response.statusText}` };
      }

      const data = await response.json() as any;
      const results = data.results || [];
      if (results.length === 0) return { success: true, output: 'No results found.' };

      const formatted = results.map((r: any, i: number) => {
        const doc = r.document?.structData || {};
        const title = doc.title || 'Untitled';
        const link = doc.link || doc.url || '';
        const snip = r.document?.derivedStructData?.snippets?.[0]?.snippet || '';
        return `${i + 1}. **${title}**\n   ${link}\n   ${snip.replace(/<b>/g, '').replace(/<\/b>/g, '')}`;
      }).join('\n\n');

      const note = hasFreshnessInput
        ? 'Note: Vertex provider does not expose a native freshness filter in this endpoint. Applied orderBy=updateTime desc as best effort.\n\n'
        : '';

      return { success: true, output: `${note}${formatted || 'No results found.'}` };
    }

    if (provider === 'serper') {
      const apiKey = config?.serperApiKey;
      if (!apiKey) return { success: false, output: 'Serper requires an API Key' };

      const url = 'https://google.serper.dev/search';
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: query,
          ...(serperTbs ? { tbs: serperTbs } : {}),
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json() as any;
        const results = data.organic || [];
        const formatted = results
          .map((r: any, i: number) => `${i + 1}. **${r.title}**\n   ${r.link}\n   ${r.snippet || ''}`)
          .join('\n\n');
        const note = hasFreshnessInput && !serperTbs
          ? 'Note: Serper supports day/week/month/year recency only; custom date ranges were not applied.\n\n'
          : '';
        return { success: true, output: `${note}${formatted || 'No results found.'}` };
      } else {
        return { success: false, output: `Serper Error: ${response.statusText}` };
      }
    }

    if (provider === 'brave' && config?.braveApiKey) {
      const params = new URLSearchParams({
        q: query,
        count: '10',
        safesearch: 'off',
        ...(braveFreshness ? { freshness: braveFreshness } : {}),
      });
      const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
      const response = await fetch(url, {
        headers: { 'X-Subscription-Token': config.braveApiKey, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const data = await response.json() as any;
        const results = data.web?.results ?? [];
        const formatted = results
          .map((r: any, i: number) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
          .join('\n\n');
        return { success: true, output: formatted || 'No results found.' };
      }
    }
  } catch (err: unknown) {
    return { success: false, output: `Search provider error: ${(err as Error).message}` };
  }

  // Fallback to DuckDuckGo (always available without keys for testing/light use)
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return { success: false, output: 'Search unavailable.' };
    const data = await response.json() as {
      AbstractText?: string;
      AbstractURL?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string; }>;
    };
    const lines: string[] = [];
    if (data.AbstractText) lines.push(`**Summary:** ${data.AbstractText}\n${data.AbstractURL ?? ''}`);
    if (data.RelatedTopics) {
      data.RelatedTopics.slice(0, 5).forEach((t, i) => {
        if (t.Text) lines.push(`${i + 1}. ${t.Text}\n   ${t.FirstURL ?? ''}`);
      });
    }
    const note = hasFreshnessInput
      ? 'Note: DuckDuckGo fallback endpoint does not support freshness filtering in this tool path.\n\n'
      : '';
    return { success: true, output: `${note}${lines.join('\n\n') || 'No results found.'}` };
  } catch (e: unknown) {
    return { success: false, output: `Search error: ${(e as Error).message}` };
  }
}

export function buildWebTools(ctx: ToolContext): ToolDefinition[] {
  if (!ctx.config.tools.web) return [];

  const provider = ctx.searchConfig?.provider || 'brave';
  const providerLabel = provider === 'vertex'
    ? 'Vertex AI Search'
    : provider === 'serper'
      ? 'Serper (Google)'
      : 'Brave Search';
  const freshnessHint = provider === 'brave'
    ? 'Freshness: day/week/month/year, pd/pw/pm/py, YYYY-MM-DDtoYYYY-MM-DD.'
    : provider === 'serper'
      ? 'Freshness: day/week/month/year or pd/pw/pm/py.'
      : 'Freshness: best effort (sorted by latest update time).';

  return [
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch content from a URL without using a browser.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              oneOf: [
                { type: 'string', description: 'URL to fetch.' },
                { type: 'array', items: { type: 'string' }, description: 'List of URLs to fetch.' }
              ]
            },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: `Search the web using ${providerLabel}. ${freshnessHint}`,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query.' },
            freshness: {
              type: 'string',
              description: 'Recency filter. Supports day/week/month/year, pd/pw/pm/py, or custom range YYYY-MM-DDtoYYYY-MM-DD (Brave only).'
            },
          },
          required: ['query'],
        },
      },
    },
  ];
}

export async function executeWebTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult | null> {
  switch (name) {
    case 'web_fetch':
      return webFetch(args.url as string | string[]);
    case 'web_search':
      return webSearch(args.query as string, ctx.searchConfig, args.freshness as string | undefined);
    default:
      return null;
  }
}
