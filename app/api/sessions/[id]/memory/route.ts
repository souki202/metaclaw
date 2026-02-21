import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSessionManagerSafe, handleError, notFound } from '../../../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);

    if (!agent) {
      return notFound('Session not found');
    }

    const vectorPath = path.join(agent.getWorkspace(), 'memory', 'vectors.json');
    if (!fs.existsSync(vectorPath)) {
      return NextResponse.json([]);
    }

    const entries = JSON.parse(fs.readFileSync(vectorPath, 'utf-8'));
    const result = entries.map((e: { id: string; text: string; metadata: unknown }) => ({
      id: e.id,
      text: e.text,
      metadata: e.metadata,
    }));

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json([]);
  }
}
