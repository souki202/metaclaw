import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { listAgents, sendToAgent } from './tools.js';
import {
  createSession,
  sendMessageToSession,
  postOrganizationGroupChat,
  readOrganizationGroupChat,
  searchOrganizationGroupChat,
  listOrganizationGroupChatMembers,
} from './enhanced-tools.js';
import type { AgentCard } from './types.js';

function makeCard(sessionId: string): AgentCard {
  return {
    sessionId,
    agentName: `Agent-${sessionId}`,
    description: `Session ${sessionId}`,
    capabilities: [],
    specializations: [],
    availableTools: [],
    status: 'idle',
    lastUpdated: new Date().toISOString(),
  };
}

test('list_agents returns only same-organization agents', async () => {
  const result = await listAgents({
    sessionId: 'alpha',
    a2aRegistry: {
      getAllCards: () => [makeCard('alpha'), makeCard('beta'), makeCard('gamma')],
    } as any,
    sessionManager: {
      getSessionOrganizationId: (sessionId: string) => {
        if (sessionId === 'alpha' || sessionId === 'beta') return 'org-main';
        if (sessionId === 'gamma') return 'org-other';
        return null;
      },
    } as any,
  } as any);

  assert.equal(result.success, true);
  assert.match(result.output, /beta/);
  assert.doesNotMatch(result.output, /gamma/);
});

test('send_to_agent blocks cross-organization requests', async () => {
  const createRequestMock = mock.fn(() => ({ id: 'req-1' }));
  const sendMessageMock = mock.fn(async () => {});

  const result = await sendToAgent(
    {
      sessionId: 'alpha',
      a2aRegistry: {
        getCard: () => makeCard('gamma'),
        createRequest: createRequestMock,
        sendMessage: sendMessageMock,
      } as any,
      sessionManager: {
        isSameOrganization: () => false,
      } as any,
    } as any,
    {
      target_session: 'gamma',
      task: 'please help',
    }
  );

  assert.equal(result.success, false);
  assert.match(result.output, /Cross-organization communication is not allowed/);
  assert.equal(createRequestMock.mock.callCount(), 0);
  assert.equal(sendMessageMock.mock.callCount(), 0);
});

test('send_message_to_session blocks cross-organization messaging', async () => {
  const sendMessageMock = mock.fn(() => ({ id: 'msg-1' }));

  const result = await sendMessageToSession(
    {
      sessionId: 'alpha',
      commsManager: {
        sendMessage: sendMessageMock,
      } as any,
      sessionManager: {
        getAgent: () => ({ processMessage: async () => {} }),
        isSameOrganization: () => false,
      } as any,
    } as any,
    {
      target_session: 'gamma',
      message: 'hello',
    }
  );

  assert.equal(result.success, false);
  assert.match(result.output, /Cross-organization communication is not allowed/);
  assert.equal(sendMessageMock.mock.callCount(), 0);
});

test('create_session blocks creation into another organization', async () => {
  const result = await createSession(
    {
      sessionId: 'alpha',
      sessionManager: {
        getConfig: () => ({
          providerTemplates: {
            openai: {
              name: 'OpenAI',
              endpoint: 'https://api.openai.com/v1',
              apiKey: 'k',
              availableModels: ['gpt-4o'],
              defaultModel: 'gpt-4o',
            },
          },
          sessions: {},
        }),
        getSessionOrganizationId: () => 'org-main',
      } as any,
    } as any,
    {
      sessionId: 'new-agent',
      organizationId: 'org-other',
      name: 'New Agent',
      providerTemplate: 'openai',
    }
  );

  assert.equal(result.success, false);
  assert.match(result.output, /Cross-organization session creation is not allowed/);
});

test('post_organization_group_chat posts within same organization', async () => {
  const result = await postOrganizationGroupChat(
    {
      sessionId: 'alpha',
      sessionManager: {
        getSessionOrganizationId: () => 'org-main',
        postOrganizationGroupChatMessage: () => ({
          id: 'msg-1',
          organizationId: 'org-main',
          senderType: 'ai',
          senderSessionId: 'alpha',
          senderName: 'Alpha',
          content: 'hello @Beta',
          mentionSessionIds: ['beta'],
          mentionSessionNames: ['Beta'],
          timestamp: new Date().toISOString(),
        }),
      } as any,
    } as any,
    {
      message: 'hello @Beta',
    }
  );

  assert.equal(result.success, true);
  assert.match(result.output, /Posted to organization group chat: org-main/);
  assert.match(result.output, /Mentions: Beta/);
});

test('read_organization_group_chat returns unread summary and marks as read', async () => {
  const markReadMock = mock.fn(() => ({ total: 0, mentions: 0 }));

  const result = await readOrganizationGroupChat(
    {
      sessionId: 'alpha',
      sessionManager: {
        getSessionOrganizationId: () => 'org-main',
        getOrganizationGroupChatMessages: () => ({
          unread: { total: 2, mentions: 1 },
          messages: [
            {
              id: '1',
              organizationId: 'org-main',
              senderType: 'ai',
              senderSessionId: 'beta',
              senderName: 'Beta',
              content: 'Ping @Alpha',
              mentionSessionIds: ['alpha'],
              mentionSessionNames: ['Alpha'],
              timestamp: '2026-02-28T00:00:00.000Z',
            },
          ],
        }),
        markOrganizationGroupChatAsRead: markReadMock,
      } as any,
    } as any,
    {
      unread_only: true,
      mentions_only: true,
      mark_as_read: true,
    }
  );

  assert.equal(result.success, true);
  assert.match(result.output, /Unread: total=2, mentions=1/);
  assert.match(result.output, /Ping @Alpha/);
  assert.match(result.output, /Marked as read\. Remaining unread: total=0, mentions=0/);
  assert.equal(markReadMock.mock.callCount(), 1);
});

test('search_organization_group_chat supports semantic mode and formats results', async () => {
  const result = await searchOrganizationGroupChat(
    {
      sessionId: 'alpha',
      sessionManager: {
        getSessionOrganizationId: () => 'org-main',
        searchOrganizationGroupChatMessages: async () => ({
          mode: 'semantic',
          hits: [
            {
              score: 0.88,
              message: {
                id: 'm-1',
                organizationId: 'org-main',
                senderType: 'ai',
                senderSessionId: 'beta',
                senderName: 'Beta',
                content: 'Investigate latency issue',
                mentionSessionIds: ['alpha'],
                mentionSessionNames: ['Alpha'],
                timestamp: '2026-02-28T00:00:00.000Z',
              },
            },
          ],
        }),
      } as any,
    } as any,
    {
      query: 'latency',
      mode: 'semantic',
    }
  );

  assert.equal(result.success, true);
  assert.match(result.output, /Mode: semantic/);
  assert.match(result.output, /Investigate latency issue/);
});

test('list_organization_group_chat_members outputs mention targets and unread counters', async () => {
  const result = await listOrganizationGroupChatMembers(
    {
      sessionId: 'alpha',
      sessionManager: {
        getSessionOrganizationId: () => 'org-main',
        getOrganizationSessions: () => [
          { id: 'alpha', name: 'Alpha' },
          { id: 'beta', name: 'Beta Worker' },
        ],
        getOrganizationGroupChatUnreadCount: () => ({ total: 3, mentions: 1 }),
      } as any,
    } as any,
  );

  assert.equal(result.success, true);
  assert.match(result.output, /Unread: total=3, mentions=1/);
  assert.match(result.output, /@Beta Worker/);
});
