import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSessionManagerSafe, handleError, notFound, badRequest } from '../../../../helpers';

const ALLOWED_FILES = ['IDENTITY.md', 'USER.md', 'MEMORY.md'];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  try {
    const { id, filename } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);

    if (!agent) {
      return notFound('Session not found');
    }

    if (!ALLOWED_FILES.includes(filename)) {
      return badRequest('Not allowed');
    }

    const filePath = path.join(agent.getWorkspace(), filename);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ content: '' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return NextResponse.json({ content });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  try {
    const { id, filename } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);

    if (!agent) {
      return notFound('Session not found');
    }

    if (!ALLOWED_FILES.includes(filename)) {
      return badRequest('Not allowed');
    }

    const body = await request.json();
    const filePath = path.join(agent.getWorkspace(), filename);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body.content, 'utf-8');

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
