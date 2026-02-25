import { NextResponse } from 'next/server';
import { handleError } from '../helpers';

export async function POST(request: Request) {
  try {
    const { endpoint, apiKey } = await request.json();

    if (!endpoint) {
      return NextResponse.json({ error: 'endpoint is required' }, { status: 400 });
    }

    // Normalize endpoint: remove trailing slash, strip /chat/completions suffix if present
    const base = endpoint.replace(/\/(chat\/completions|completions)\/?$/, '').replace(/\/$/, '');
    const modelsUrl = `${base}/models`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(modelsUrl, { headers });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Failed to fetch models: ${res.status} ${res.statusText}`, detail: text },
        { status: res.status }
      );
    }

    const data = await res.json();

    // OpenAI-compatible response: { data: [{ id: string, ... }] }
    let models: string[] = [];
    if (Array.isArray(data?.data)) {
      models = data.data
        .map((m: any) => (typeof m === 'string' ? m : m?.id))
        .filter(Boolean)
        .sort();
    } else if (Array.isArray(data?.models)) {
      models = data.models
        .map((m: any) => (typeof m === 'string' ? m : m?.id || m?.name))
        .filter(Boolean)
        .sort();
    } else if (Array.isArray(data)) {
      models = data
        .map((m: any) => (typeof m === 'string' ? m : m?.id || m?.name))
        .filter(Boolean)
        .sort();
    }

    return NextResponse.json({ models });
  } catch (error) {
    return handleError(error);
  }
}
