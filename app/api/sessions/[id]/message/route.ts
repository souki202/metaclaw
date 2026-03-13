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

    const editHistoryIndex = Number.isInteger(body.editHistoryIndex)
      ? Number(body.editHistoryIndex)
      : null;

    if (editHistoryIndex !== null && agent.isProcessing()) {
      return NextResponse.json(
        { error: 'Cannot edit the last user message while a response is still in progress.' },
        { status: 409 },
      );
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

    // Pass media files (audio/video) if provided
    let mediaFiles: { name: string; url: string; mimeType: string; }[] | undefined;
    if (Array.isArray(body.mediaFiles) && body.mediaFiles.length > 0) {
      mediaFiles = (body.mediaFiles as { name: string; url: string; mimeType: string; }[]).filter(
        mf => mf.url && mf.mimeType,
      );
      if (mediaFiles.length === 0) mediaFiles = undefined;
    }

    if (editHistoryIndex !== null) {
      const result = await agent.resendEditedLastUserMessage(
        editHistoryIndex,
        body.message,
        'dashboard',
        {
          noMemory: body.noMemory === true,
          noRecall: body.noRecall === true,
          systemPrompt: body.systemPrompt as string | undefined,
        },
      );
      return NextResponse.json(result);
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
      mediaFiles,
    );
    return NextResponse.json({ response });
  } catch (error) {
    return handleError(error);
  }
}
