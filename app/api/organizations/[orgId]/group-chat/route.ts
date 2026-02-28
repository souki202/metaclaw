import { NextResponse } from 'next/server';
import { getSessionManagerSafe, handleError, badRequest } from '../../../helpers';
import { broadcastSseEvent } from '../../../../../src/global-state';
import type { DashboardEvent } from '../../../../../src/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params;
    const sessions = getSessionManagerSafe();
    const url = new URL(request.url);

    const viewerSessionId = url.searchParams.get('viewerSessionId') || undefined;
    const limitParam = url.searchParams.get('limit');
    const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
    const mentionsOnly = url.searchParams.get('mentionsOnly') === 'true';
    const query = url.searchParams.get('q') || undefined;
    const searchMode = (url.searchParams.get('searchMode') || 'substring') as 'semantic' | 'fuzzy' | 'substring';

    const limit = limitParam ? Number(limitParam) : undefined;
    if (limitParam && (!Number.isFinite(limit) || Number.isNaN(limit!))) {
      return badRequest('limit must be a number');
    }

    if (!['semantic', 'fuzzy', 'substring'].includes(searchMode)) {
      return badRequest('searchMode must be one of: semantic, fuzzy, substring');
    }

    if (query) {
      const search = await sessions.searchOrganizationGroupChatMessages({
        organizationId: orgId,
        query,
        mode: searchMode,
        viewerSessionId,
        limit,
      });

      const unread = sessions.getOrganizationGroupChatUnreadCount(orgId, viewerSessionId);

      return NextResponse.json({
        organizationId: orgId,
        viewerSessionId: viewerSessionId ?? null,
        unread,
        search,
      });
    }

    const result = sessions.getOrganizationGroupChatMessages({
      organizationId: orgId,
      viewerSessionId,
      limit,
      unreadOnly,
      mentionsOnly,
    });

    return NextResponse.json({
      organizationId: orgId,
      viewerSessionId: viewerSessionId ?? null,
      messages: result.messages,
      unread: result.unread,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params;
    const sessions = getSessionManagerSafe();
    const body = await request.json();

    if (!body?.content || typeof body.content !== 'string') {
      return badRequest('content required');
    }

    const senderType = body.senderType === 'ai' ? 'ai' : 'human';
    const senderSessionId = typeof body.senderSessionId === 'string' ? body.senderSessionId : undefined;
    const senderName = typeof body.senderName === 'string' ? body.senderName : undefined;

    const message = sessions.postOrganizationGroupChatMessage({
      organizationId: orgId,
      content: body.content,
      senderType,
      senderSessionId,
      senderName,
    });

    const event: DashboardEvent = {
      type: 'organization_group_chat',
      sessionId: senderSessionId || `org:${orgId}`,
      data: {
        organizationId: orgId,
        message,
      },
      timestamp: new Date().toISOString(),
    };
    broadcastSseEvent(event);

    return NextResponse.json({ ok: true, message });
  } catch (error) {
    return handleError(error);
  }
}
