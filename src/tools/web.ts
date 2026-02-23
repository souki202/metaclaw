import { GoogleAuth } from 'google-auth-library';
import type { ToolResult, SearchConfig } from '../types.js';
import { htmlToText } from './html-utils.js';

export async function webFetch(url: string, selector?: string): Promise<ToolResult> {
  try {
    new URL(url);
  } catch {
    return { success: false, output: 'Invalid URL.' };
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'meta-claw/1.0 (personal AI agent)' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { success: false, output: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const json = await response.json();
      return { success: true, output: JSON.stringify(json, null, 2).slice(0, 8000) };
    }

    const text = await response.text();
    const clean = htmlToText(text).slice(0, 8000);

    return { success: true, output: clean };
  } catch (e: unknown) {
    return { success: false, output: `Fetch error: ${(e as Error).message}` };
  }
}

export async function webSearch(query: string, config?: SearchConfig): Promise<ToolResult> {
  const provider = config?.provider || 'brave';

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

      return { success: true, output: formatted || 'No results found.' };
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
        body: JSON.stringify({ q: query }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json() as any;
        const results = data.organic || [];
        const formatted = results
          .map((r: any, i: number) => `${i + 1}. **${r.title}**\n   ${r.link}\n   ${r.snippet || ''}`)
          .join('\n\n');
        return { success: true, output: formatted || 'No results found.' };
      } else {
        return { success: false, output: `Serper Error: ${response.statusText}` };
      }
    }

    if (provider === 'brave' && config?.braveApiKey) {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
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
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };
    const lines: string[] = [];
    if (data.AbstractText) lines.push(`**Summary:** ${data.AbstractText}\n${data.AbstractURL ?? ''}`);
    if (data.RelatedTopics) {
      data.RelatedTopics.slice(0, 5).forEach((t, i) => {
        if (t.Text) lines.push(`${i + 1}. ${t.Text}\n   ${t.FirstURL ?? ''}`);
      });
    }
    return { success: true, output: lines.join('\n\n') || 'No results found.' };
  } catch (e: unknown) {
    return { success: false, output: `Search error: ${(e as Error).message}` };
  }
}
