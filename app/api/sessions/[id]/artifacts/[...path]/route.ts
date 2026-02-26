import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSessionManagerSafe, handleError, notFound, badRequest } from '../../../../helpers';

function detectMime(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.pdf': 'application/pdf',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  try {
    const { id, path: segments } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);

    if (!agent) {
      return notFound('Session not found');
    }

    if (!Array.isArray(segments) || segments.length === 0) {
      return badRequest('Path required');
    }

    const decodedSegments = segments.map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

    const relativePath = decodedSegments.join('/');
    const workspaceRoot = path.resolve(agent.getWorkspace());
    const targetPath = path.resolve(workspaceRoot, relativePath);

    const inWorkspace =
      targetPath === workspaceRoot || targetPath.startsWith(`${workspaceRoot}${path.sep}`);

    if (!inWorkspace) {
      return badRequest('Invalid path');
    }

    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
      return notFound('File not found');
    }

    const data = fs.readFileSync(targetPath);
    const fileName = path.basename(targetPath);

    return new NextResponse(data, {
      headers: {
        'Content-Type': detectMime(fileName),
        'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
