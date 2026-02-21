import type { ToolResult } from '../types.js';

export async function webFetch(url: string, selector?: string): Promise<ToolResult> {
  try {
    new URL(url);
  } catch {
    return { success: false, output: 'Invalid URL.' };
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'mini-claw/1.0 (personal AI agent)' },
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
    // Strip HTML tags for readability
    const clean = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);

    return { success: true, output: clean };
  } catch (e: unknown) {
    return { success: false, output: `Fetch error: ${(e as Error).message}` };
  }
}

export async function webSearch(query: string, braveApiKey?: string): Promise<ToolResult> {
  if (braveApiKey) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
      const response = await fetch(url, {
        headers: { 'X-Subscription-Token': braveApiKey, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const data = await response.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
        const results = data.web?.results ?? [];
        const formatted = results
          .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
          .join('\n\n');
        return { success: true, output: formatted || 'No results found.' };
      }
    } catch {
      // Fall through to DuckDuckGo
    }
  }

  // DuckDuckGo instant answer API (no key needed, limited)
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
