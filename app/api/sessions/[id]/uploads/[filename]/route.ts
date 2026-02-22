import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSessionManagerSafe, handleError, notFound } from '../../../../helpers';

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

    // Sanitize filename to prevent directory traversal
    const safeName = path.basename(filename);
    const filePath = path.join(agent.getWorkspace(), 'uploads', safeName);

    if (!fs.existsSync(filePath)) {
      return notFound('Image not found');
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(safeName).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeTypes[ext] || 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
