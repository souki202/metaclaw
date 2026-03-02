import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSessionManagerSafe, handleError, notFound, badRequest } from '../../../helpers';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; }>; }
) {
  try {
    const { id } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);

    if (!agent) {
      return notFound('Session not found');
    }

    const body = await request.json();
    if (!body.message) {
      return badRequest('message required');
    }

    // Resolve text file contents from uploaded file URLs
    let textFiles: { name: string; content: string; }[] | undefined;
    if (Array.isArray(body.textFiles) && body.textFiles.length > 0) {
      textFiles = [];
      for (const tf of body.textFiles as { name: string; url: string; }[]) {
        // URL format: /api/sessions/:id/uploads/texts/:filename
        const urlMatch = tf.url.match(/\/api\/sessions\/[^/]+\/uploads\/(.+)$/);
        if (!urlMatch) continue;

        const relPath = decodeURIComponent(urlMatch[1]);
        // Security: only allow uploads/ subdirectory files
        const normalized = relPath.replace(/\\/g, '/');
        if (normalized.includes('..') || normalized.includes('//')) continue;

        const filePath = path.join(agent.getWorkspace(), 'uploads', normalized);
        if (!fs.existsSync(filePath)) continue;

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          textFiles.push({ name: tf.name, content });
        } catch {
          // Skip files that can't be read as text
        }
      }
      if (textFiles.length === 0) textFiles = undefined;
    }

    const response = await agent.processMessage(
      body.message,
      'dashboard',
      body.imageUrls,
      {
        noMemory: body.noMemory === true,
        noRecall: body.noRecall === true,
        systemPrompt: body.systemPrompt as string | undefined,
      },
      textFiles,
    );
    return NextResponse.json({ response });
  } catch (error) {
    return handleError(error);
  }
}
