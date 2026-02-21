import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    version: '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nodeVersion: process.version,
  });
}
