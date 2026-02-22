import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSessionManagerSafe, handleError, notFound, badRequest } from '../../../helpers';

export async function POST(
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

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // Handle multipart form upload
      const formData = await request.formData();
      const files = formData.getAll('images') as File[];

      if (files.length === 0) {
        return badRequest('No images provided');
      }

      const uploadDir = path.join(agent.getWorkspace(), 'uploads');
      fs.mkdirSync(uploadDir, { recursive: true });

      const savedUrls: string[] = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;

        const ext = file.name.split('.').pop() || 'png';
        const filename = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;
        const filePath = path.join(uploadDir, filename);

        const arrayBuffer = await file.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

        // Return the API URL for serving this image
        savedUrls.push(`/api/sessions/${id}/uploads/${filename}`);
      }

      return NextResponse.json({ ok: true, urls: savedUrls });
    } else {
      // Handle JSON with base64 data URLs
      const body = await request.json();
      const images: string[] = body.images || [];

      if (images.length === 0) {
        return badRequest('No images provided');
      }

      const uploadDir = path.join(agent.getWorkspace(), 'uploads');
      fs.mkdirSync(uploadDir, { recursive: true });

      const savedUrls: string[] = [];
      for (const dataUrl of images) {
        // Parse data URL: data:image/png;base64,xxxxx
        const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!match) continue;

        const ext = match[1];
        const data = match[2];
        const filename = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;
        const filePath = path.join(uploadDir, filename);

        fs.writeFileSync(filePath, data, 'base64');
        savedUrls.push(`/api/sessions/${id}/uploads/${filename}`);
      }

      return NextResponse.json({ ok: true, urls: savedUrls });
    }
  } catch (error) {
    return handleError(error);
  }
}
