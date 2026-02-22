import { NextResponse } from 'next/server';
import { getSessionManagerSafe, handleError, notFound, badRequest } from '../../../../helpers';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; scheduleId: string }> }
) {
  try {
    const { id, scheduleId } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);
    if (!agent) return notFound('Session not found');

    const body = await request.json();
    const patch: {
      startAt?: string;
      repeatCron?: string | null;
      memo?: string;
      enabled?: boolean;
    } = {};

    if (body.startAt !== undefined) patch.startAt = body.startAt;
    if (body.repeatCron !== undefined) patch.repeatCron = body.repeatCron;
    if (body.memo !== undefined) patch.memo = body.memo;
    if (body.enabled !== undefined) patch.enabled = body.enabled;

    if (Object.keys(patch).length === 0) {
      return badRequest('No update fields provided');
    }

    const updated = sessions.updateSchedule(id, scheduleId, patch);
    return NextResponse.json({ ok: true, schedule: updated });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; scheduleId: string }> }
) {
  try {
    const { id, scheduleId } = await params;
    const sessions = getSessionManagerSafe();
    const agent = sessions.getAgent(id);
    if (!agent) return notFound('Session not found');

    const deleted = sessions.deleteSchedule(id, scheduleId);
    if (!deleted) return notFound('Schedule not found');

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
