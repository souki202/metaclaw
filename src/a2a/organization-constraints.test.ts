import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { listAgents, sendToAgent } from './tools.js';
import { createSession, sendMessageToSession } from './enhanced-tools.js';
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
