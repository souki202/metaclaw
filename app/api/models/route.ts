import { NextResponse } from 'next/server';
import { handleError } from '../helpers';
import { normalizeModelList } from '@/src/utils/model-list';

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
      models = normalizeModelList(
        data.data.map((m: any) => (typeof m === 'string' ? m : m?.id)),
      );
    } else if (Array.isArray(data?.models)) {
      models = normalizeModelList(
        data.models.map((m: any) => (typeof m === 'string' ? m : m?.id || m?.name)),
      );
    } else if (Array.isArray(data)) {
      models = normalizeModelList(
        data.map((m: any) => (typeof m === 'string' ? m : m?.id || m?.name)),
      );
    }

    return NextResponse.json({ models });
  } catch (error) {
    return handleError(error);
  }
}
