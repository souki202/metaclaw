import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSessionManagerSafe, handleError, notFound, badRequest } from '../../../helpers';

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'csv', 'json', 'xml', 'html', 'htm',
  'yaml', 'yml', 'log', 'rst', 'tsv', 'ts', 'js', 'py',
  'sh', 'bash', 'sql', 'toml', 'ini', 'cfg', 'conf',
]);

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'weba', 'webm']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv']);

function isTextFile(filename: string, mimeType: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (mimeType.startsWith('text/')) return true;
  return false;
}

function isAudioFile(filename: string, mimeType: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return AUDIO_EXTENSIONS.has(ext) || mimeType.startsWith('audio/');
}

function isVideoFile(filename: string, mimeType: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(ext) || mimeType.startsWith('video/');
}

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

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // Handle multipart form upload
      const formData = await request.formData();
      const files = formData.getAll('files') as File[];
      const images = formData.getAll('images') as File[];
      const allFiles = [...images, ...files];

      if (allFiles.length === 0) {
        return badRequest('No files provided');
      }

      const uploadDir = path.join(agent.getWorkspace(), 'uploads');
      const textUploadDir = path.join(agent.getWorkspace(), 'uploads', 'texts');
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.mkdirSync(textUploadDir, { recursive: true });

      const savedImageUrls: string[] = [];
      const savedTextFiles: { name: string; url: string; size: number; }[] = [];
      const savedAudioFiles: { name: string; url: string; size: number; mimeType: string; }[] = [];
      const savedVideoFiles: { name: string; url: string; size: number; mimeType: string; }[] = [];

      for (const file of allFiles) {
        if (file.type.startsWith('image/')) {
          const ext = file.name.split('.').pop() || 'png';
          const filename = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;
          const filePath = path.join(uploadDir, filename);
          const arrayBuffer = await file.arrayBuffer();
          fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
          savedImageUrls.push(`/api/sessions/${id}/uploads/${filename}`);
        } else if (isTextFile(file.name, file.type)) {
          const ext = file.name.split('.').pop() || 'txt';
          const basename = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
          const filename = `${basename}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;
          const filePath = path.join(textUploadDir, filename);
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          fs.writeFileSync(filePath, buffer);
          savedTextFiles.push({
            name: file.name,
            url: `/api/sessions/${id}/uploads/texts/${filename}`,
            size: buffer.length,
          });
        } else if (isAudioFile(file.name, file.type)) {
          const ext = file.name.split('.').pop() || 'mp3';
          const filename = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;
          const filePath = path.join(uploadDir, filename);
          const arrayBuffer = await file.arrayBuffer();
          fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
          savedAudioFiles.push({
            name: file.name,
            url: `/api/sessions/${id}/uploads/${filename}`,
            size: arrayBuffer.byteLength,
            mimeType: file.type || `audio/${ext}`,
          });
        } else if (isVideoFile(file.name, file.type)) {
          const ext = file.name.split('.').pop() || 'mp4';
          const filename = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;
          const filePath = path.join(uploadDir, filename);
          const arrayBuffer = await file.arrayBuffer();
          fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
          savedVideoFiles.push({
            name: file.name,
            url: `/api/sessions/${id}/uploads/${filename}`,
            size: arrayBuffer.byteLength,
            mimeType: file.type || `video/${ext}`,
          });
        }
      }

      return NextResponse.json({
        ok: true,
        urls: savedImageUrls,
        textFiles: savedTextFiles,
        audioFiles: savedAudioFiles,
        videoFiles: savedVideoFiles,
      });
    } else {
      // Handle JSON with base64 data URLs (images only, legacy)
      const body = await request.json();
      const images: string[] = body.images || [];

      if (images.length === 0) {
        return badRequest('No images provided');
      }

      const uploadDir = path.join(agent.getWorkspace(), 'uploads');
      fs.mkdirSync(uploadDir, { recursive: true });

      const savedUrls: string[] = [];
      for (const dataUrl of images) {
        const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!match) continue;

        const ext = match[1];
        const data = match[2];
        const filename = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;
        const filePath = path.join(uploadDir, filename);

        fs.writeFileSync(filePath, data, 'base64');
        savedUrls.push(`/api/sessions/${id}/uploads/${filename}`);
      }

      return NextResponse.json({ ok: true, urls: savedUrls, textFiles: [] });
    }
  } catch (error) {
    return handleError(error);
  }
}
