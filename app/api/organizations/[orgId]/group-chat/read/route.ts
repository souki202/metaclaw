import { NextResponse } from 'next/server';
import { getSessionManagerSafe, handleError, badRequest } from '../../../../helpers';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params;
    const sessions = getSessionManagerSafe();
    const body = await request.json();

    if (!body?.viewerSessionId || typeof body.viewerSessionId !== 'string') {
      return badRequest('viewerSessionId required');
    }

    const unread = sessions.markOrganizationGroupChatAsRead({
      organizationId: orgId,
      viewerSessionId: body.viewerSessionId,
    });

    return NextResponse.json({ ok: true, unread });
  } catch (error) {
    return handleError(error);
  }
}
