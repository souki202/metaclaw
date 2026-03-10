import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSessionManagerSafe, handleError, notFound } from '../../../../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; filename: string; }>; }
) {
  try {
    const { id, filename } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);

    if (!agent) {
      return notFound('Session not found');
    }

    // Sanitize filename — strip directory traversal but allow 'texts/' prefix
    const decoded = decodeURIComponent(filename);
    const normalized = decoded.replace(/\\/g, '/');
    // Only allow direct file or texts/file format
    const allowedPattern = /^(?:texts\/)?[^/]+$/;
    if (!allowedPattern.test(normalized)) {
      return notFound('Invalid path');
    }
    const safeName = normalized;
    const filePath = path.join(agent.getWorkspace(), 'uploads', safeName);

    if (!fs.existsSync(filePath)) {
      return notFound('File not found');
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(safeName).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xml': 'text/xml',
      '.html': 'text/html',
      '.htm': 'text/html',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.log': 'text/plain',
      '.rst': 'text/plain',
      '.tsv': 'text/tab-separated-values',
      // Audio
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.aac': 'audio/aac',
      '.m4a': 'audio/mp4',
      '.opus': 'audio/opus',
      '.weba': 'audio/webm',
      // Video
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.ogv': 'video/ogg',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska',
    };

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
