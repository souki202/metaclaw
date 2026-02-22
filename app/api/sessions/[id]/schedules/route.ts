import { NextResponse } from 'next/server';
import { getSessionManagerSafe, handleError, notFound, badRequest } from '../../../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);
    if (!agent) return notFound('Session not found');

    const schedules = sessions.getSchedules(id);
    return NextResponse.json(schedules);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);
    if (!agent) return notFound('Session not found');

    const body = await request.json();
    if (!body?.startAt || !body?.memo || body?.repeatCron === undefined) {
      return badRequest('startAt, repeatCron, memo are required');
    }

    const created = sessions.createSchedule(id, {
      startAt: body.startAt,
      repeatCron: body.repeatCron,
      memo: body.memo,
      enabled: body.enabled,
    });

    return NextResponse.json({ ok: true, schedule: created });
  } catch (error) {
    return handleError(error);
  }
}
