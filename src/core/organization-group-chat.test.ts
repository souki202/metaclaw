import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import { SessionManager } from './sessions.js';

function createManager() {
  const manager = Object.create(SessionManager.prototype) as any;
  manager.config = {
    dashboard: { enabled: true, port: 3020 },
    sessions: {
      alpha: {
        organizationId: 'org-main',
        name: 'Alpha',
        provider: { endpoint: '', apiKey: '', model: '' },
        workspace: './data/sessions/alpha',
        restrictToWorkspace: true,
        allowSelfModify: false,
        tools: { exec: true, web: true, memory: true },
      },
      beta: {
        organizationId: 'org-main',
        name: 'Beta Worker',
        provider: { endpoint: '', apiKey: '', model: '' },
        workspace: './data/sessions/beta',
        restrictToWorkspace: true,
        allowSelfModify: false,
        tools: { exec: true, web: true, memory: true },
      },
      gamma: {
        organizationId: 'org-other',
        name: 'Gamma',
        provider: { endpoint: '', apiKey: '', model: '' },
        workspace: './data/sessions/gamma',
        restrictToWorkspace: true,
        allowSelfModify: false,
        tools: { exec: true, web: true, memory: true },
      },
    },
  };

  manager.organizationGroupChats = new Map([
    ['org-main', { messages: [], readStates: {} }],
    ['org-other', { messages: [], readStates: {} }],
  ]);
  manager.pendingMentionNotifications = new Map();
  manager.mentionDeliveryInFlight = new Set();

  return manager as SessionManager & any;
}

test('postOrganizationGroupChatMessage extracts mentions by session name and id', () => {
  const manager = createManager();
  const mkdirMock = mock.method(fs, 'mkdirSync', () => undefined as any);
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);

  try {
    const message = manager.postOrganizationGroupChatMessage({
      organizationId: 'org-main',
      senderType: 'ai',
      senderSessionId: 'alpha',
      content: 'Please review @Beta Worker and @beta',
    });

    assert.equal(message.senderName, 'Alpha');
    assert.deepEqual(message.mentionSessionIds, ['beta']);
    assert.deepEqual(message.mentionSessionNames, ['Beta Worker']);
    assert.equal(mkdirMock.mock.callCount() > 0, true);
    assert.equal(writeMock.mock.callCount() > 0, true);
  } finally {
    mkdirMock.mock.restore();
    writeMock.mock.restore();
  }
});

test('postOrganizationGroupChatMessage extracts mentions in Japanese sentence context and full-width at mark', () => {
  const manager = createManager();
  const mkdirMock = mock.method(fs, 'mkdirSync', () => undefined as any);
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);

  try {
    const message = manager.postOrganizationGroupChatMessage({
      organizationId: 'org-main',
      senderType: 'ai',
      senderSessionId: 'alpha',
      content: '進捗共有です、＠Beta Worker、確認お願いします。あと、@betaも見てください。',
    });

    assert.deepEqual(message.mentionSessionIds, ['beta']);
    assert.deepEqual(message.mentionSessionNames, ['Beta Worker']);
  } finally {
    mkdirMock.mock.restore();
    writeMock.mock.restore();
  }
});

test('unread counters count non-self messages and guarantee mention counters', () => {
  const manager = createManager();
  const mkdirMock = mock.method(fs, 'mkdirSync', () => undefined as any);
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);

  try {
    manager.postOrganizationGroupChatMessage({
      organizationId: 'org-main',
      senderType: 'ai',
      senderSessionId: 'alpha',
      content: 'self message',
    });
    manager.postOrganizationGroupChatMessage({
      organizationId: 'org-main',
      senderType: 'ai',
      senderSessionId: 'beta',
      content: 'ping @Alpha',
    });

    const unread = manager.getOrganizationGroupChatUnreadCount('org-main', 'alpha');
    assert.equal(unread.total, 1);
    assert.equal(unread.mentions, 1);

    const mentionOnly = manager.getOrganizationGroupChatMessages({
      organizationId: 'org-main',
      viewerSessionId: 'alpha',
      mentionsOnly: true,
    });

    assert.equal(mentionOnly.messages.length, 1);
    assert.equal(mentionOnly.messages[0].senderSessionId, 'beta');

    const unreadAfterMark = manager.markOrganizationGroupChatAsRead({
      organizationId: 'org-main',
      viewerSessionId: 'alpha',
    });

    assert.equal(unreadAfterMark.total, 0);
    assert.equal(unreadAfterMark.mentions, 0);
  } finally {
    mkdirMock.mock.restore();
    writeMock.mock.restore();
  }
});

test('read state is tracked per session', () => {
  const manager = createManager();
  const mkdirMock = mock.method(fs, 'mkdirSync', () => undefined as any);
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);

  try {
    manager.postOrganizationGroupChatMessage({
      organizationId: 'org-main',
      senderType: 'ai',
      senderSessionId: 'alpha',
      content: 'status update',
    });

    const betaBefore = manager.getOrganizationGroupChatUnreadCount('org-main', 'beta');
    assert.equal(betaBefore.total, 1);

    manager.markOrganizationGroupChatAsRead({
      organizationId: 'org-main',
      viewerSessionId: 'alpha',
    });

    const alphaAfter = manager.getOrganizationGroupChatUnreadCount('org-main', 'alpha');
    const betaAfter = manager.getOrganizationGroupChatUnreadCount('org-main', 'beta');
    assert.equal(alphaAfter.total, 0);
    assert.equal(betaAfter.total, 1);
  } finally {
    mkdirMock.mock.restore();
    writeMock.mock.restore();
  }
});

test('markOrganizationGroupChatAsRead cancels pending mention delivery for that session', () => {
  const manager = createManager();
  const mkdirMock = mock.method(fs, 'mkdirSync', () => undefined as any);
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);

  try {
    manager.postOrganizationGroupChatMessage({
      organizationId: 'org-main',
      senderType: 'ai',
      senderSessionId: 'alpha',
      content: 'please review @Beta Worker',
    });

    assert.equal((manager.pendingMentionNotifications.get('beta') || []).length, 1);

    const unreadAfterMark = manager.markOrganizationGroupChatAsRead({
      organizationId: 'org-main',
      viewerSessionId: 'beta',
    });

    assert.equal(unreadAfterMark.total, 0);
    assert.equal((manager.pendingMentionNotifications.get('beta') || []).length, 0);
  } finally {
    mkdirMock.mock.restore();
    writeMock.mock.restore();
  }
});

test('postOrganizationGroupChatMessage blocks cross-organization posting', () => {
  const manager = createManager();
  const mkdirMock = mock.method(fs, 'mkdirSync', () => undefined as any);
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);

  try {
    assert.throws(() => {
      manager.postOrganizationGroupChatMessage({
        organizationId: 'org-main',
        senderType: 'ai',
        senderSessionId: 'gamma',
        content: 'invalid cross-org post',
      });
    }, /Cross-organization group chat posting is not allowed/);
  } finally {
    mkdirMock.mock.restore();
    writeMock.mock.restore();
  }
});

test('searchOrganizationGroupChatMessages supports substring and fuzzy modes', async () => {
  const manager = createManager();
  const mkdirMock = mock.method(fs, 'mkdirSync', () => undefined as any);
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);

  try {
    manager.postOrganizationGroupChatMessage({
      organizationId: 'org-main',
      senderType: 'human',
      senderSessionId: 'alpha',
      content: 'Deployment checklist is ready',
    });
    manager.postOrganizationGroupChatMessage({
      organizationId: 'org-main',
      senderType: 'ai',
      senderSessionId: 'beta',
      content: 'Please deploy patch now',
    });

    const substring = await manager.searchOrganizationGroupChatMessages({
      organizationId: 'org-main',
      viewerSessionId: 'alpha',
      query: 'deploy',
      mode: 'substring',
      limit: 10,
    });
    assert.equal(substring.hits.length >= 1, true);

    const fuzzy = await manager.searchOrganizationGroupChatMessages({
      organizationId: 'org-main',
      viewerSessionId: 'alpha',
      query: 'dploy patc',
      mode: 'fuzzy',
      limit: 10,
    });
    assert.equal(fuzzy.hits.length >= 1, true);
  } finally {
    mkdirMock.mock.restore();
    writeMock.mock.restore();
  }
});

test('searchOrganizationGroupChatMessages supports semantic mode via vector index mapping', async () => {
  const manager = createManager();
  const mkdirMock = mock.method(fs, 'mkdirSync', () => undefined as any);
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);

  try {
    const message = manager.postOrganizationGroupChatMessage({
      organizationId: 'org-main',
      senderType: 'ai',
      senderSessionId: 'beta',
      content: 'Investigate websocket reconnection issue',
    });

    manager.getOrganizationGroupVectorMemory = () => ({
      search: async () => [
        {
          score: 0.91,
          entry: {
            id: 'vector-1',
            text: `[group_chat_message_id:${message.id}] indexed text`,
            embedding: [0.1, 0.2],
            metadata: { timestamp: new Date().toISOString() },
          },
        },
      ],
    });

    const semantic = await manager.searchOrganizationGroupChatMessages({
      organizationId: 'org-main',
      viewerSessionId: 'alpha',
      query: 'websocket reconnect',
      mode: 'semantic',
      limit: 5,
    });

    assert.equal(semantic.hits.length, 1);
    assert.equal(semantic.hits[0].message.id, message.id);
    assert.equal(semantic.hits[0].score, 0.91);
  } finally {
    mkdirMock.mock.restore();
    writeMock.mock.restore();
  }
});

test('deliverMentionNotifications sends mention immediately when target is idle', async () => {
  const manager = createManager();

  const processMessageMock = mock.fn(async () => 'ok');
  const waitForIdleMock = mock.fn(async () => undefined);
  const agent = {
    isProcessing: () => false,
    waitForIdle: waitForIdleMock,
    processMessage: processMessageMock,
  };

  manager.agents = new Map([['beta', agent]]);
  manager.organizationGroupChats = new Map([
    ['org-main', {
      messages: [{
        id: 'msg-1',
        organizationId: 'org-main',
        senderType: 'ai',
        senderSessionId: 'alpha',
        senderName: 'Alpha',
        content: 'hello @Beta Worker',
        mentionSessionIds: ['beta'],
        mentionSessionNames: ['Beta Worker'],
        timestamp: new Date().toISOString(),
      }],
      readStates: {},
    }],
  ]);
  manager.pendingMentionNotifications = new Map([
    ['beta', [{
      organizationId: 'org-main',
      messageId: 'msg-1',
      fromSessionId: 'alpha',
      fromName: 'Alpha',
      content: 'hello @Beta Worker',
      timestamp: new Date().toISOString(),
    }]],
  ]);

  await manager.deliverMentionNotifications('beta');

  assert.equal(processMessageMock.mock.callCount(), 1);
  assert.equal(waitForIdleMock.mock.callCount(), 0);
  assert.equal((manager.pendingMentionNotifications.get('beta') || []).length, 0);
});

test('deliverMentionNotifications waits for idle when target is busy', async () => {
  const manager = createManager();

  let busy = true;
  const processMessageMock = mock.fn(async () => 'ok');
  const waitForIdleMock = mock.fn(async () => {
    busy = false;
  });
  const agent = {
    isProcessing: () => busy,
    waitForIdle: waitForIdleMock,
    processMessage: processMessageMock,
  };

  manager.agents = new Map([['beta', agent]]);
  manager.organizationGroupChats = new Map([
    ['org-main', {
      messages: [{
        id: 'msg-2',
        organizationId: 'org-main',
        senderType: 'ai',
        senderSessionId: 'alpha',
        senderName: 'Alpha',
        content: 'please check this @Beta Worker',
        mentionSessionIds: ['beta'],
        mentionSessionNames: ['Beta Worker'],
        timestamp: new Date().toISOString(),
      }],
      readStates: {},
    }],
  ]);
  manager.pendingMentionNotifications = new Map([
    ['beta', [{
      organizationId: 'org-main',
      messageId: 'msg-2',
      fromSessionId: 'alpha',
      fromName: 'Alpha',
      content: 'please check this @Beta Worker',
      timestamp: new Date().toISOString(),
    }]],
  ]);

  await manager.deliverMentionNotifications('beta');

  assert.equal(waitForIdleMock.mock.callCount(), 1);
  assert.equal(processMessageMock.mock.callCount(), 1);
  assert.equal((manager.pendingMentionNotifications.get('beta') || []).length, 0);
});

test('scheduleMentionNotificationDelivery does not retry while target agent is inactive', async () => {
  const manager = createManager();

  manager.organizationGroupChats = new Map([
    ['org-main', {
      messages: [{
        id: 'msg-3',
        organizationId: 'org-main',
        senderType: 'ai',
        senderSessionId: 'alpha',
        senderName: 'Alpha',
        content: 'offline mention',
        mentionSessionIds: ['beta'],
        mentionSessionNames: ['Beta Worker'],
        timestamp: new Date().toISOString(),
      }],
      readStates: {},
    }],
  ]);
  manager.pendingMentionNotifications = new Map([
    ['beta', [{
      organizationId: 'org-main',
      messageId: 'msg-3',
      fromSessionId: 'alpha',
      fromName: 'Alpha',
      content: 'offline mention',
      timestamp: new Date().toISOString(),
    }]],
  ]);

  const timeoutMock = mock.method(global, 'setTimeout', () => ({}) as any);

  try {
    manager.scheduleMentionNotificationDelivery('beta');
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(timeoutMock.mock.callCount(), 0);
    assert.equal((manager.pendingMentionNotifications.get('beta') || []).length, 1);
  } finally {
    timeoutMock.mock.restore();
  }
});
