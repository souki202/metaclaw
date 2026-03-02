/**
 * Team Protocol – Unit Tests
 *
 * Tests for SharedStateBoard, EventDrivenDispatch, ContextBudgetManager,
 * and the agent-facing tools.
 */

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { SharedStateBoard, getSharedStateBoard } from './shared-state-board.js';
import { EventDrivenDispatch } from './event-dispatch.js';
import { classifyMessage, classifyMessages, buildAgentContext } from './context-budget.js';
import {
  updateMyStatus,
  readProjectState,
  sendTypedMessage,
  readTypedMessages,
  addPendingDecision,
  resolveDecision,
} from './team-protocol-tools.js';
import type {
  TypedMessage,
  AgentStatus,
  StatusUpdatePayload,
} from './team-protocol-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFs() {
  const mkdirMock = mock.method(fs, 'mkdirSync', () => undefined as any);
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);
  const readMock = mock.method(fs, 'readFileSync', (_path: any) => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  const existsMock = mock.method(fs, 'existsSync', () => false);
  return { mkdirMock, writeMock, readMock, existsMock };
}

function restoreMocks(...mocks: Array<{ mock: { restore(): void } }>) {
  for (const m of mocks) m.mock.restore();
}

function makeTypedMessage(
  overrides: Partial<TypedMessage['header']> & { payload?: Record<string, unknown> }
): TypedMessage {
  const defaultPayload: StatusUpdatePayload = {
    task_ref: null,
    new_status: 'idle',
    progress_summary: '',
    estimated_remaining: null,
    blockers: null,
  };
  return {
    header: {
      id: overrides.id ?? 'msg-1',
      type: overrides.type ?? 'STATUS_UPDATE',
      from: overrides.from ?? 'agent-a',
      to: overrides.to ?? 'agent-b',
      priority: overrides.priority ?? 'normal',
      timestamp: overrides.timestamp ?? new Date().toISOString(),
      context_summary: overrides.context_summary ?? 'test summary',
      related_state_refs: overrides.related_state_refs ?? [],
    },
    payload: (overrides.payload as any) ?? defaultPayload,
  };
}

// ---------------------------------------------------------------------------
// SharedStateBoard tests
// ---------------------------------------------------------------------------

test('SharedStateBoard: read returns default state when file missing', () => {
  const { mkdirMock, writeMock, readMock, existsMock } = mockFs();
  try {
    const board = new SharedStateBoard('test-org');
    const state = board.read();
    assert.equal(state.project_state.current_phase, 'initializing');
    assert.deepEqual(state.project_state.agents, []);
    assert.deepEqual(state.project_state.pending_decisions, []);
    assert.deepEqual(state.project_state.blockers, []);
  } finally {
    restoreMocks(mkdirMock, writeMock, readMock, existsMock);
  }
});

test('SharedStateBoard: updateAgentStatus auto-registers unknown agent', () => {
  const { mkdirMock, existsMock } = mockFs();
  let written: string | null = null;
  const writeMock = mock.method(fs, 'writeFileSync', (_p: any, data: any) => {
    written = data as string;
  });
  // readFileSync will throw ENOENT → default state used
  const readMock = mock.method(fs, 'readFileSync', () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });

  try {
    const board = new SharedStateBoard('test-org');
    const { state } = board.updateAgentStatus('new-agent', { status: 'working', current_task: 'do stuff' });
    const agent = state.project_state.agents.find(a => a.id === 'new-agent');
    assert.ok(agent, 'agent should be auto-registered');
    assert.equal(agent!.status, 'working');
    assert.equal(agent!.current_task, 'do stuff');
    assert.ok(written, 'state should be persisted');
  } finally {
    restoreMocks(mkdirMock, writeMock, readMock, existsMock);
  }
});

test('SharedStateBoard: resolveDecision marks decision resolved', () => {
  const { mkdirMock, existsMock } = mockFs();
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);

  // Simulate existing state with one open decision
  const existingState = JSON.stringify({
    project_state: {
      goal: 'test',
      current_phase: 'phase1',
      updated_at: new Date().toISOString(),
      agents: [],
      pending_decisions: [{
        id: 'D-001',
        question: 'Which approach?',
        options: [],
        owner: 'agent-a',
        deadline: null,
        status: 'open',
        resolution: null,
      }],
      blockers: [],
      changelog: [],
    },
  });

  const readMock = mock.method(fs, 'readFileSync', () => existingState);
  const existsMockRead = mock.method(fs, 'existsSync', () => true);

  try {
    const board = new SharedStateBoard('test-org');
    const { found, state } = board.resolveDecision('agent-a', 'D-001', 'Use option B');
    assert.equal(found, true);
    const d = state.project_state.pending_decisions.find(d => d.id === 'D-001');
    assert.equal(d!.status, 'resolved');
    assert.equal(d!.resolution, 'Use option B');
  } finally {
    restoreMocks(mkdirMock, writeMock, readMock, existsMockRead);
  }
});

test('SharedStateBoard: resolveBlocker returns affected agents', () => {
  const { mkdirMock } = mockFs();
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);

  const existingState = JSON.stringify({
    project_state: {
      goal: '',
      current_phase: 'phase1',
      updated_at: new Date().toISOString(),
      agents: [
        { id: 'agent-x', role: 'worker', status: 'blocked', current_task: 'task', blocked_by: 'BLK-001', artifacts: [] },
      ],
      pending_decisions: [],
      blockers: [{
        id: 'BLK-001',
        description: 'API is down',
        affected_agents: ['agent-x'],
        created_at: new Date().toISOString(),
        resolved: false,
      }],
      changelog: [],
    },
  });

  const readMock = mock.method(fs, 'readFileSync', () => existingState);
  const existsMock = mock.method(fs, 'existsSync', () => true);

  try {
    const board = new SharedStateBoard('test-org');
    const { found, affectedAgents } = board.resolveBlocker('agent-y', 'BLK-001');
    assert.equal(found, true);
    assert.deepEqual(affectedAgents, ['agent-x']);
  } finally {
    restoreMocks(mkdirMock, writeMock, readMock, existsMock);
  }
});

test('SharedStateBoard: changelog is capped at 50 entries', () => {
  const { mkdirMock, existsMock } = mockFs();
  const writtenStates: string[] = [];
  const writeMock = mock.method(fs, 'writeFileSync', (_p: any, data: any) => {
    writtenStates.push(data as string);
  });
  const readMock = mock.method(fs, 'readFileSync', () => {
    if (writtenStates.length > 0) return writtenStates[writtenStates.length - 1];
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  const existsMockFn = mock.method(fs, 'existsSync', () => writtenStates.length > 0);

  try {
    const board = new SharedStateBoard('test-org');
    for (let i = 0; i < 60; i++) {
      board.updateAgentStatus(`agent-${i % 3}`, { status: 'working' });
    }
    const state = board.read();
    assert.ok(state.project_state.changelog.length <= 50, 'changelog should be capped');
  } finally {
    restoreMocks(mkdirMock, writeMock, readMock, existsMockFn);
  }
});

// ---------------------------------------------------------------------------
// EventDrivenDispatch tests
// ---------------------------------------------------------------------------

test('EventDrivenDispatch: notifies blocked agents on task_completed', async () => {
  const { mkdirMock, existsMock } = mockFs();
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);

  // State has one blocked agent
  const existingState = JSON.stringify({
    project_state: {
      goal: '',
      current_phase: 'phase1',
      updated_at: new Date().toISOString(),
      agents: [
        { id: 'agent-worker', role: 'worker', status: 'blocked', current_task: 'waiting', blocked_by: 'agent-lead', artifacts: [] },
      ],
      pending_decisions: [],
      blockers: [],
      changelog: [],
    },
  });

  const readMock = mock.method(fs, 'readFileSync', () => existingState);
  const existsMockFn = mock.method(fs, 'existsSync', () => true);

  const notified: Array<{ sessionId: string; content: string }> = [];
  const dispatch = new EventDrivenDispatch();
  dispatch.setAgentNotifier(async (sessionId, content) => {
    notified.push({ sessionId, content });
  });

  try {
    await dispatch.dispatch({
      name: 'task_completed',
      orgId: 'test-org',
      agentId: 'agent-lead',
      taskDescription: 'architecture design',
      artifactRefs: ['design-v1'],
    });

    const workerNotification = notified.find(n => n.sessionId === 'agent-worker');
    assert.ok(workerNotification, 'blocked agent should be notified');
    assert.ok(
      workerNotification!.content.includes('task_completed') ||
      workerNotification!.content.includes('agent-lead'),
      'notification should mention completing agent'
    );
  } finally {
    restoreMocks(mkdirMock, writeMock, readMock, existsMockFn);
  }
});

test('EventDrivenDispatch: emits event via EventEmitter', async () => {
  const { mkdirMock, writeMock, readMock, existsMock } = mockFs();
  const dispatch = new EventDrivenDispatch();
  dispatch.setAgentNotifier(async () => {});

  let emitted = false;
  dispatch.on('agent_status_changed', () => { emitted = true; });

  try {
    await dispatch.dispatch({
      name: 'agent_status_changed',
      orgId: 'test-org',
      agentId: 'agent-a',
      oldStatus: 'idle',
      newStatus: 'working',
    });
    assert.equal(emitted, true);
  } finally {
    restoreMocks(mkdirMock, writeMock, readMock, existsMock);
  }
});

// ---------------------------------------------------------------------------
// Context Budget Manager tests
// ---------------------------------------------------------------------------

test('classifyMessage: addressed + blocking = critical', () => {
  const msg = makeTypedMessage({ to: 'agent-b', priority: 'blocking' });
  const tier = classifyMessage(msg, 'agent-b');
  assert.equal(tier, 'critical');
});

test('classifyMessage: addressed + normal = relevant', () => {
  const msg = makeTypedMessage({ to: 'agent-b', priority: 'normal' });
  const tier = classifyMessage(msg, 'agent-b');
  assert.equal(tier, 'relevant');
});

test('classifyMessage: broadcast + high = relevant', () => {
  const msg = makeTypedMessage({ to: '*', priority: 'high' });
  const tier = classifyMessage(msg, 'agent-b');
  assert.equal(tier, 'relevant');
});

test('classifyMessage: broadcast + normal = background', () => {
  const msg = makeTypedMessage({ to: '*', priority: 'normal' });
  const tier = classifyMessage(msg, 'agent-b');
  assert.equal(tier, 'background');
});

test('classifyMessage: addressed to someone else = irrelevant', () => {
  const msg = makeTypedMessage({ to: 'agent-c', priority: 'blocking' });
  const tier = classifyMessage(msg, 'agent-b');
  assert.equal(tier, 'irrelevant');
});

test('classifyMessages: filters out irrelevant messages', () => {
  const msgs = [
    makeTypedMessage({ id: 'a', to: 'agent-b', priority: 'blocking' }),
    makeTypedMessage({ id: 'b', to: 'agent-c', priority: 'high' }),
    makeTypedMessage({ id: 'c', to: '*', priority: 'normal' }),
  ];
  const classified = classifyMessages(msgs, 'agent-b');
  assert.equal(classified.some(c => c.message.header.id === 'b'), false, 'agent-c message should be excluded');
  assert.equal(classified.length, 2);
});

test('buildAgentContext: returns structured sections', () => {
  const { mkdirMock, writeMock, readMock, existsMock } = mockFs();

  try {
    const msgs = [
      makeTypedMessage({ id: 'msg-crit', to: 'agent-x', priority: 'blocking' }),
    ];
    const context = buildAgentContext('agent-x', 'test-org', msgs);
    assert.ok(context.includes('あなたの現在の状態'), 'should have agent state section');
    assert.ok(context.includes('未処理の受信メッセージ'), 'should have critical messages section');
    assert.ok(context.includes('プロジェクト全体の現在の状態'), 'should have project state section');
  } finally {
    restoreMocks(mkdirMock, writeMock, readMock, existsMock);
  }
});

// ---------------------------------------------------------------------------
// Tool integration tests (smoke tests with mocked fs)
// ---------------------------------------------------------------------------

test('updateMyStatus tool: happy path', async () => {
  const { mkdirMock, existsMock } = mockFs();
  const writeMock = mock.method(fs, 'writeFileSync', () => undefined as any);
  const readMock = mock.method(fs, 'readFileSync', () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });

  const mockCtx: any = {
    sessionId: 'agent-test',
    config: {} as any,
    workspace: '/tmp',
    sessionDir: '/tmp',
    sessionManager: {
      getSessionOrganizationId: () => 'test-org',
      isSameOrganization: () => true,
      getAgent: () => null,
    },
  };

  try {
    const result = await updateMyStatus(mockCtx, { status: 'working', current_task: 'write tests' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('working'));
  } finally {
    restoreMocks(mkdirMock, writeMock, readMock, existsMock);
  }
});

test('readProjectState tool: returns formatted state', async () => {
  const { mkdirMock, writeMock, readMock, existsMock } = mockFs();

  const mockCtx: any = {
    sessionId: 'agent-test',
    config: {} as any,
    workspace: '/tmp',
    sessionDir: '/tmp',
    sessionManager: {
      getSessionOrganizationId: () => 'test-org',
    },
  };

  try {
    const result = await readProjectState(mockCtx);
    assert.equal(result.success, true);
    assert.ok(result.output.includes('Shared State Board'));
  } finally {
    restoreMocks(mkdirMock, writeMock, readMock, existsMock);
  }
});

test('sendTypedMessage tool: delivers to inbox', async () => {
  const { mkdirMock, writeMock, readMock, existsMock } = mockFs();

  const mockCtx: any = {
    sessionId: 'agent-sender',
    config: {} as any,
    workspace: '/tmp',
    sessionDir: '/tmp',
    sessionManager: {
      getSessionOrganizationId: () => 'test-org',
      isSameOrganization: () => true,
      getAgent: () => null,
      postOrganizationGroupChatMessage: () => {},
    },
  };

  const recipientCtx: any = {
    ...mockCtx,
    sessionId: 'agent-recipient',
  };

  try {
    const sendResult = await sendTypedMessage(mockCtx, {
      type: 'KNOWLEDGE_SHARE',
      to: 'agent-recipient',
      priority: 'normal',
      context_summary: 'Sharing some info',
      payload: {
        topic: 'API design',
        content: 'Use REST not GraphQL',
        relevance_to_recipients: 'You are building the API',
        actionable: false,
        action_suggestion: null,
      },
    });
    assert.equal(sendResult.success, true);

    const readResult = await readTypedMessages(recipientCtx, {});
    assert.equal(readResult.success, true);
    assert.ok(readResult.output.includes('KNOWLEDGE_SHARE'));
    assert.ok(readResult.output.includes('API design'));
  } finally {
    restoreMocks(mkdirMock, writeMock, readMock, existsMock);
  }
});

test('add and resolve decision: full flow', async () => {
  const writtenStates: string[] = [];
  const mkdirMock = mock.method(fs, 'mkdirSync', () => undefined as any);
  const writeMock = mock.method(fs, 'writeFileSync', (_p: any, data: any) => {
    writtenStates.push(data as string);
  });
  const readMock = mock.method(fs, 'readFileSync', () => {
    if (writtenStates.length > 0) return writtenStates[writtenStates.length - 1];
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  const existsMock = mock.method(fs, 'existsSync', () => writtenStates.length > 0);

  const ctx: any = {
    sessionId: 'agent-lead',
    config: {} as any,
    workspace: '/tmp',
    sessionDir: '/tmp',
    sessionManager: {
      getSessionOrganizationId: () => 'test-org',
      isSameOrganization: () => true,
      getAgent: () => null,
    },
  };

  try {
    // Add decision
    const addResult = await addPendingDecision(ctx, {
      question: 'Use TypeScript or JavaScript?',
      owner: 'agent-lead',
      options: [
        { label: 'TypeScript', pros: 'Type safety', cons: 'More setup' },
        { label: 'JavaScript', pros: 'Simple', cons: 'No types' },
      ],
    });
    assert.equal(addResult.success, true);
    const decisionId = addResult.output.match(/D-[A-Z0-9]+/)?.[0];
    assert.ok(decisionId, 'should extract decision ID from output');

    // Read state to verify decision was added
    const board = getSharedStateBoard('test-org');
    const state = board.read();
    const decision = state.project_state.pending_decisions.find(d => d.id === decisionId);
    assert.ok(decision, 'decision should be in state');
    assert.equal(decision!.status, 'open');

    // Resolve decision
    const resolveResult = await resolveDecision(ctx, {
      decision_id: decisionId!,
      resolution: 'TypeScript – chosen for type safety',
    });
    assert.equal(resolveResult.success, true);

    // Verify resolution
    const updatedState = board.read();
    const resolvedDecision = updatedState.project_state.pending_decisions.find(d => d.id === decisionId);
    assert.equal(resolvedDecision!.status, 'resolved');
    assert.equal(resolvedDecision!.resolution, 'TypeScript – chosen for type safety');
  } finally {
    restoreMocks(mkdirMock, writeMock, readMock, existsMock);
  }
});
