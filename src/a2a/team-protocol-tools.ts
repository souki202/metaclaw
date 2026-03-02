/**
 * Agent Team Protocol – Tool Definitions
 *
 * Exposes the Shared State Board, Typed Message Protocol, Task Contract,
 * and Context Budget Manager to AI agents as callable tools.
 *
 * Tools follow the same pattern as existing a2a/enhanced-tools.ts.
 */

import { randomUUID } from 'crypto';
import type { ToolDefinition, ToolResult } from '../types.js';
import type { ToolContext } from '../tools/context.js';
import type { SessionManager } from '../core/sessions.js';
import { createLogger } from '../logger.js';
import { getSharedStateBoard } from './shared-state-board.js';
import { getEventDispatch } from './event-dispatch.js';
import { buildAgentContext } from './context-budget.js';
import type {
  AgentStatus,
  PendingDecision,
  Blocker,
  TypedMessage,
  TypedMessageType,
  MessagePriority,
  TaskHandoffPayload,
  TaskResultPayload,
  DecisionRequestPayload,
  DecisionResultPayload,
  StatusUpdatePayload,
  ConflictReportPayload,
  KnowledgeSharePayload,
  ReviewRequestPayload,
  ReviewResultPayload,
  FreeformPayload,
  TaskContract,
  ContractConstraint,
  AcceptanceCriterion,
} from './team-protocol-types.js';

const log = createLogger('team-protocol-tools');

// ---------------------------------------------------------------------------
// Context interface
// ---------------------------------------------------------------------------

export interface TeamProtocolToolContext extends ToolContext {
  sessionManager?: SessionManager;
}

// ---------------------------------------------------------------------------
// In-memory typed message store (per-session inbox)
// Messages are stored by recipient session ID.
// In a future version these could be persisted to disk.
// ---------------------------------------------------------------------------

const typedMessageInboxes = new Map<string, TypedMessage[]>();

function getInbox(sessionId: string): TypedMessage[] {
  if (!typedMessageInboxes.has(sessionId)) {
    typedMessageInboxes.set(sessionId, []);
  }
  return typedMessageInboxes.get(sessionId)!;
}

function deliverTypedMessage(message: TypedMessage): void {
  const recipients = Array.isArray(message.header.to)
    ? message.header.to
    : [message.header.to];

  for (const r of recipients) {
    if (r === '*') continue; // Broadcast – consumed via inbox query by all
    getInbox(r).push(message);
  }

  // For broadcasts, store in a special '*' inbox
  if (recipients.includes('*')) {
    getInbox('*').push(message);
  }
}

function getMessagesForSession(sessionId: string): TypedMessage[] {
  const direct = getInbox(sessionId);
  const broadcast = getInbox('*');
  // Deduplicate by message ID
  const seen = new Set<string>();
  const all: TypedMessage[] = [];
  for (const m of [...direct, ...broadcast]) {
    if (!seen.has(m.header.id)) {
      seen.add(m.header.id);
      all.push(m);
    }
  }
  return all.sort((a, b) => a.header.timestamp.localeCompare(b.header.timestamp));
}

function clearTypedMessage(recipientId: string, messageId: string): void {
  const inbox = getInbox(recipientId);
  const idx = inbox.findIndex(m => m.header.id === messageId);
  if (idx >= 0) inbox.splice(idx, 1);
  // Also remove from broadcast inbox
  const broadcast = getInbox('*');
  const bi = broadcast.findIndex(m => m.header.id === messageId);
  if (bi >= 0) broadcast.splice(bi, 1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireOrg(ctx: TeamProtocolToolContext): string | null {
  return ctx.sessionManager?.getSessionOrganizationId(ctx.sessionId) ?? null;
}

function isSameOrg(ctx: TeamProtocolToolContext, targetId: string): boolean {
  return ctx.sessionManager?.isSameOrganization(ctx.sessionId, targetId) ?? false;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

// ---- 1. read_project_state ----

export async function readProjectState(ctx: TeamProtocolToolContext): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization for this session.' };

    const board = getSharedStateBoard(orgId);
    const state = board.read().project_state;

    const lines = [
      `=== Shared State Board: ${orgId} ===`,
      `Goal: ${state.goal || '(not set)'}`,
      `Phase: ${state.current_phase}`,
      `Updated: ${state.updated_at}`,
      ``,
      `--- Agents (${state.agents.length}) ---`,
      ...state.agents.map(a => [
        `  ${a.id} [${a.status}] ${a.role}`,
        `    Task: ${a.current_task ?? 'none'}`,
        `    Blocked by: ${a.blocked_by ?? 'none'}`,
        `    Artifacts: ${a.artifacts.map(ar => `${ar.ref} v${ar.version}`).join(', ') || 'none'}`,
      ].join('\n')),
      ``,
      `--- Pending Decisions (${state.pending_decisions.filter(d => d.status === 'open').length} open) ---`,
      ...state.pending_decisions.map(d =>
        `  [${d.id}] ${d.status === 'open' ? '🔴' : '✅'} "${d.question}" (owner: ${d.owner})`
        + (d.resolution ? ` → ${d.resolution}` : '')
      ),
      ``,
      `--- Active Blockers (${state.blockers.filter(b => !b.resolved).length}) ---`,
      ...state.blockers.filter(b => !b.resolved).map(b =>
        `  [${b.id}] ${b.description} (affects: ${b.affected_agents.join(', ')})`
      ),
      ``,
      `--- Recent Changelog (last 10) ---`,
      ...state.changelog.slice(-10).map(e =>
        `  [${e.timestamp}] ${e.agent}: ${e.action}`
      ),
    ];

    return { success: true, output: lines.join('\n') };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 2. update_my_status ----

export async function updateMyStatus(
  ctx: TeamProtocolToolContext,
  args: {
    status: AgentStatus;
    current_task?: string | null;
    blocked_by?: string | null;
    role?: string;
    artifact_ref?: string;
    artifact_description?: string;
    artifact_path?: string;
  }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    const board = getSharedStateBoard(orgId);
    const dispatch = getEventDispatch();

    // Read previous status for event dispatching
    const prevState = board.read().project_state;
    const prevAgent = prevState.agents.find(a => a.id === ctx.sessionId);
    const prevStatus = prevAgent?.status ?? 'idle';

    const artifacts = args.artifact_ref
      ? [{
          ref: args.artifact_ref,
          description: args.artifact_description ?? '',
          version: (prevAgent?.artifacts.find(a => a.ref === args.artifact_ref)?.version ?? 0) + 1,
          path: args.artifact_path ?? '',
        }]
      : undefined;

    // Register self if not yet in board
    if (!prevAgent && args.role) {
      board.registerAgent(ctx.sessionId, {
        id: ctx.sessionId,
        role: args.role,
        status: args.status,
        current_task: args.current_task ?? null,
        blocked_by: args.blocked_by ?? null,
        artifacts: [],
      });
    }

    const { state, isNowUnblocked } = board.updateAgentStatus(ctx.sessionId, {
      status: args.status,
      current_task: args.current_task,
      blocked_by: args.blocked_by,
      artifacts,
    });

    // Fire events
    await dispatch.dispatch({
      name: 'agent_status_changed',
      orgId,
      agentId: ctx.sessionId,
      oldStatus: prevStatus,
      newStatus: args.status,
    });

    if (args.status === 'completed' && prevStatus !== 'completed') {
      const myAgent = state.project_state.agents.find(a => a.id === ctx.sessionId);
      await dispatch.dispatch({
        name: 'task_completed',
        orgId,
        agentId: ctx.sessionId,
        taskDescription: myAgent?.current_task ?? '',
        artifactRefs: myAgent?.artifacts.map(a => a.ref) ?? [],
      });
    }

    if (args.status === 'blocked' && args.blocked_by) {
      const myAgent = state.project_state.agents.find(a => a.id === ctx.sessionId);
      await dispatch.dispatch({
        name: 'task_blocked',
        orgId,
        agentId: ctx.sessionId,
        blockedBy: args.blocked_by,
        taskDescription: myAgent?.current_task ?? null,
      });
    }

    if (artifacts && artifacts.length > 0) {
      for (const art of artifacts) {
        await dispatch.dispatch({
          name: 'artifact_updated',
          orgId,
          agentId: ctx.sessionId,
          artifactRef: art.ref,
          oldVersion: art.version - 1,
          newVersion: art.version,
          changeSummary: art.description,
        });
      }
    }

    return {
      success: true,
      output: [
        `Status updated: ${args.status}`,
        args.current_task ? `Current task: ${args.current_task}` : '',
        args.blocked_by ? `Blocked by: ${args.blocked_by}` : '',
        artifacts ? `Artifact registered: ${artifacts.map(a => `${a.ref} v${a.version}`).join(', ')}` : '',
      ].filter(Boolean).join('\n'),
    };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 3. update_project ----

export async function updateProject(
  ctx: TeamProtocolToolContext,
  args: { goal?: string; current_phase?: string }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    if (!args.goal && !args.current_phase) {
      return { success: false, output: 'Provide at least one of: goal, current_phase' };
    }

    const board = getSharedStateBoard(orgId);
    board.updateProject(ctx.sessionId, args);

    return {
      success: true,
      output: [
        `Project updated.`,
        args.goal ? `Goal: ${args.goal}` : '',
        args.current_phase ? `Phase: ${args.current_phase}` : '',
      ].filter(Boolean).join('\n'),
    };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 4. send_typed_message ----

export async function sendTypedMessage(
  ctx: TeamProtocolToolContext,
  args: {
    type: TypedMessageType;
    to: string | string[];
    priority?: MessagePriority;
    context_summary: string;
    payload: Record<string, unknown>;
  }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    // Validate recipients are in the same org
    const toList = Array.isArray(args.to) ? args.to : [args.to];
    if (!toList.includes('*')) {
      for (const targetId of toList) {
        if (!isSameOrg(ctx, targetId)) {
          return {
            success: false,
            output: `Cross-organization messaging is not allowed (${targetId}).`,
          };
        }
      }
    }

    const message: TypedMessage = {
      header: {
        id: randomUUID(),
        type: args.type,
        from: ctx.sessionId,
        to: args.to,
        priority: args.priority ?? 'normal',
        timestamp: new Date().toISOString(),
        context_summary: args.context_summary,
        related_state_refs: [],
      },
      payload: args.payload as any,
    };

    deliverTypedMessage(message);

    // For TASK_HANDOFF, status update events, etc. – also notify agent directly
    if (args.priority === 'blocking' || args.priority === 'high') {
      for (const targetId of toList.filter(t => t !== '*')) {
        const targetAgent = ctx.sessionManager?.getAgent(targetId);
        if (targetAgent) {
          const notification = [
            `[TEAM PROTOCOL – ${args.type}] priority=${args.priority}`,
            args.context_summary,
            `From: ${ctx.sessionId}`,
            `Message ID: ${message.header.id}`,
            `Use read_typed_messages to get the full message.`,
          ].join('\n');
          targetAgent.processMessage(notification, 'system').catch(e =>
            log.error(`Failed to notify ${targetId}:`, e)
          );
        }
      }
    }

    // Broadcast org notifications via group chat if '*'
    if (toList.includes('*') && ctx.sessionManager && args.priority !== 'low') {
      try {
        ctx.sessionManager.postOrganizationGroupChatMessage({
          organizationId: orgId,
          content: `[BROADCAST ${args.type}] ${args.context_summary}`,
          senderType: 'ai',
          senderSessionId: ctx.sessionId,
        });
      } catch { /* non-fatal */ }
    }

    return {
      success: true,
      output: [
        `Typed message sent.`,
        `ID: ${message.header.id}`,
        `Type: ${args.type}`,
        `To: ${Array.isArray(args.to) ? args.to.join(', ') : args.to}`,
        `Priority: ${message.header.priority}`,
      ].join('\n'),
    };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 5. read_typed_messages ----

export async function readTypedMessages(
  ctx: TeamProtocolToolContext,
  args: { filter_type?: TypedMessageType; mark_read?: boolean; message_id?: string }
): Promise<ToolResult> {
  try {
    let messages = getMessagesForSession(ctx.sessionId);

    if (args.message_id) {
      messages = messages.filter(m => m.header.id === args.message_id);
    }

    if (args.filter_type) {
      messages = messages.filter(m => m.header.type === args.filter_type);
    }

    if (messages.length === 0) {
      return { success: true, output: 'No typed messages found.' };
    }

    const lines: string[] = [`You have ${messages.length} typed message(s):\n`];

    for (const msg of messages) {
      lines.push(`--- [${msg.header.type}] ${msg.header.id} ---`);
      lines.push(`From: ${msg.header.from}`);
      lines.push(`Priority: ${msg.header.priority}`);
      lines.push(`Time: ${msg.header.timestamp}`);
      lines.push(`Summary: ${msg.header.context_summary}`);
      lines.push(`Payload:\n${JSON.stringify(msg.payload, null, 2)}`);
      lines.push('');
    }

    if (args.mark_read) {
      for (const msg of messages) {
        clearTypedMessage(ctx.sessionId, msg.header.id);
      }
      lines.push(`Cleared ${messages.length} message(s) from inbox.`);
    }

    return { success: true, output: lines.join('\n') };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 6. add_pending_decision ----

export async function addPendingDecision(
  ctx: TeamProtocolToolContext,
  args: {
    question: string;
    owner: string;
    options?: Array<{ label: string; pros: string; cons: string }>;
    deadline?: string | null;
  }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    const decisionId = `D-${Date.now().toString(36).toUpperCase()}`;
    const board = getSharedStateBoard(orgId);

    board.addDecision(ctx.sessionId, {
      id: decisionId,
      question: args.question,
      owner: args.owner,
      options: args.options ?? [],
      deadline: args.deadline ?? null,
    });

    // Notify the owner
    const ownerAgent = ctx.sessionManager?.getAgent(args.owner);
    if (ownerAgent) {
      ownerAgent.processMessage(
        [
          `[TEAM PROTOCOL – DECISION_REQUEST]`,
          `A decision has been requested from you (ID: ${decisionId}).`,
          `Question: ${args.question}`,
          `Requestor: ${ctx.sessionId}`,
          `Use resolve_decision tool with ID "${decisionId}" to respond.`,
        ].join('\n'),
        'system'
      ).catch(e => log.error(`Failed to notify decision owner ${args.owner}:`, e));
    }

    return {
      success: true,
      output: [
        `Decision added: ${decisionId}`,
        `Question: ${args.question}`,
        `Owner: ${args.owner}`,
      ].join('\n'),
    };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 7. resolve_decision ----

export async function resolveDecision(
  ctx: TeamProtocolToolContext,
  args: { decision_id: string; resolution: string; notify_all?: boolean }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    const board = getSharedStateBoard(orgId);
    const { found } = board.resolveDecision(ctx.sessionId, args.decision_id, args.resolution);

    if (!found) {
      return { success: false, output: `Decision "${args.decision_id}" not found.` };
    }

    const dispatch = getEventDispatch();
    await dispatch.dispatch({
      name: 'decision_resolved',
      orgId,
      decisionId: args.decision_id,
      resolution: args.resolution,
      ownerAgentId: ctx.sessionId,
    });

    return {
      success: true,
      output: [
        `Decision "${args.decision_id}" resolved.`,
        `Resolution: ${args.resolution}`,
        `All affected agents have been notified.`,
      ].join('\n'),
    };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 8. report_blocker ----

export async function reportBlocker(
  ctx: TeamProtocolToolContext,
  args: {
    description: string;
    affected_agents?: string[];
  }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    const blockerId = `BLK-${Date.now().toString(36).toUpperCase()}`;
    const affected = args.affected_agents ?? [ctx.sessionId];
    const board = getSharedStateBoard(orgId);

    board.addBlocker(ctx.sessionId, {
      id: blockerId,
      description: args.description,
      affected_agents: affected,
      created_at: new Date().toISOString(),
    });

    // Mark affected agents as blocked
    for (const agentId of affected) {
      board.updateAgentStatus(agentId, { status: 'blocked', blocked_by: blockerId });
    }

    return {
      success: true,
      output: [
        `Blocker reported: ${blockerId}`,
        `Description: ${args.description}`,
        `Affects: ${affected.join(', ')}`,
      ].join('\n'),
    };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 9. resolve_blocker ----

export async function resolveBlocker(
  ctx: TeamProtocolToolContext,
  args: { blocker_id: string }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    const board = getSharedStateBoard(orgId);
    const { found, affectedAgents } = board.resolveBlocker(ctx.sessionId, args.blocker_id);

    if (!found) {
      return { success: false, output: `Blocker "${args.blocker_id}" not found or already resolved.` };
    }

    const dispatch = getEventDispatch();
    await dispatch.dispatch({
      name: 'blocker_resolved',
      orgId,
      blockerId: args.blocker_id,
      resolvedBy: ctx.sessionId,
      affectedAgents,
    });

    return {
      success: true,
      output: [
        `Blocker "${args.blocker_id}" resolved.`,
        `Affected agents notified: ${affectedAgents.join(', ')}`,
      ].join('\n'),
    };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 10. create_task_contract ----

export async function createTaskContract(
  ctx: TeamProtocolToolContext,
  args: {
    assignee: string;
    description: string;
    input_artifacts?: string[];
    constraints?: Array<{ constraint: string; hard: boolean }>;
    assumptions?: string[];
    output_format: string;
    deliverables: string[];
    acceptance_criteria: Array<{ criterion: string; verification_method: string }>;
    autonomous_decisions?: string[];
    must_consult?: string[];
    escalation_triggers?: string[];
    on_blocked?: string;
    on_partial_completion?: string;
    on_assumption_violation?: string;
    max_retries?: number | null;
    max_steps?: number | null;
    on_timeout?: string;
  }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    if (!isSameOrg(ctx, args.assignee)) {
      return { success: false, output: 'Cannot delegate to a session in a different organization.' };
    }

    const contractId = `TC-${Date.now().toString(36).toUpperCase()}`;
    const contract: TaskContract = {
      id: contractId,
      delegator: ctx.sessionId,
      assignee: args.assignee,
      created_at: new Date().toISOString(),
      status: 'pending',

      inputs: {
        description: args.description,
        artifacts: args.input_artifacts ?? [],
        constraints: args.constraints ?? [],
        assumptions: args.assumptions ?? [],
      },

      expected_output: {
        format: args.output_format,
        schema: null,
        deliverables: args.deliverables,
      },

      acceptance_criteria: args.acceptance_criteria,

      authority: {
        autonomous_decisions: args.autonomous_decisions ?? [],
        must_consult: args.must_consult ?? [],
        escalation_triggers: args.escalation_triggers ?? [],
      },

      failure_handling: {
        on_blocked: args.on_blocked ?? 'Report blocker and wait.',
        on_partial_completion: args.on_partial_completion ?? 'Return partial results with explanation.',
        on_assumption_violation: args.on_assumption_violation ?? 'Immediately report and pause.',
        max_retries: args.max_retries ?? null,
      },

      timeout: {
        max_steps: args.max_steps ?? null,
        on_timeout: args.on_timeout ?? 'Report current progress as partial.',
      },
    };

    const board = getSharedStateBoard(orgId);
    board.saveContract(orgId, contract);

    // Notify the assignee
    const assigneeAgent = ctx.sessionManager?.getAgent(args.assignee);
    if (assigneeAgent) {
      assigneeAgent.processMessage(
        [
          `[TEAM PROTOCOL – TASK_HANDOFF]`,
          `You have been assigned a task contract (ID: ${contractId}).`,
          ``,
          `Task: ${args.description}`,
          `From: ${ctx.sessionId}`,
          `Output format: ${args.output_format}`,
          `Deliverables: ${args.deliverables.join(', ')}`,
          ``,
          `Use get_task_contract with ID "${contractId}" to read the full contract.`,
          `Use accept_task_contract to accept and begin work.`,
        ].join('\n'),
        'system'
      ).catch(e => log.error(`Failed to notify assignee ${args.assignee}:`, e));
    }

    return {
      success: true,
      output: [
        `Task contract created: ${contractId}`,
        `Assignee: ${args.assignee}`,
        `Task: ${args.description}`,
        `Deliverables: ${args.deliverables.join(', ')}`,
        `The assignee has been notified.`,
      ].join('\n'),
    };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 11. get_task_contract ----

export async function getTaskContract(
  ctx: TeamProtocolToolContext,
  args: { contract_id: string }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    const board = getSharedStateBoard(orgId);
    const contract = board.loadContract(orgId, args.contract_id);

    if (!contract) {
      return { success: false, output: `Contract "${args.contract_id}" not found.` };
    }

    // Verify access: only delegator or assignee may read
    if (contract.delegator !== ctx.sessionId && contract.assignee !== ctx.sessionId) {
      return { success: false, output: 'Access denied: you are not party to this contract.' };
    }

    return { success: true, output: JSON.stringify(contract, null, 2) };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 12. accept_task_contract ----

export async function acceptTaskContract(
  ctx: TeamProtocolToolContext,
  args: { contract_id: string }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    const board = getSharedStateBoard(orgId);
    const contract = board.loadContract(orgId, args.contract_id);

    if (!contract) return { success: false, output: `Contract "${args.contract_id}" not found.` };
    if (contract.assignee !== ctx.sessionId) {
      return { success: false, output: 'Only the assignee can accept this contract.' };
    }
    if (contract.status !== 'pending') {
      return { success: false, output: `Contract is already in status: ${contract.status}.` };
    }

    contract.status = 'in_progress';
    board.saveContract(orgId, contract);

    // Update own status
    board.updateAgentStatus(ctx.sessionId, {
      status: 'working',
      current_task: contract.inputs.description,
    });

    // Notify delegator
    const delegatorAgent = ctx.sessionManager?.getAgent(contract.delegator);
    if (delegatorAgent) {
      delegatorAgent.processMessage(
        `[TEAM PROTOCOL – STATUS_UPDATE] Contract "${args.contract_id}" accepted by ${ctx.sessionId}. Work has begun.`,
        'system'
      ).catch(() => {});
    }

    return {
      success: true,
      output: [
        `Contract "${args.contract_id}" accepted. Status: in_progress.`,
        `Your task: ${contract.inputs.description}`,
        `Constraints:`,
        ...contract.inputs.constraints.map(c => `  - [${c.hard ? 'HARD' : 'soft'}] ${c.constraint}`),
        `Acceptance criteria:`,
        ...contract.acceptance_criteria.map(ac => `  - ${ac.criterion}`),
        `Authority: you may autonomously decide: ${contract.authority.autonomous_decisions.join(', ') || 'anything not listed below'}`,
        `Must consult before: ${contract.authority.must_consult.join(', ') || 'none'}`,
        `Escalate immediately if: ${contract.authority.escalation_triggers.join(', ') || 'none'}`,
      ].join('\n'),
    };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 13. complete_task_contract ----

export async function completeTaskContract(
  ctx: TeamProtocolToolContext,
  args: {
    contract_id: string;
    status: 'completed' | 'partial' | 'failed';
    summary: string;
    artifacts?: string[];
    deviations?: string[];
  }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    const board = getSharedStateBoard(orgId);
    const contract = board.loadContract(orgId, args.contract_id);

    if (!contract) return { success: false, output: `Contract "${args.contract_id}" not found.` };
    if (contract.assignee !== ctx.sessionId) {
      return { success: false, output: 'Only the assignee can complete this contract.' };
    }

    contract.status = args.status;
    contract.result = {
      status: args.status,
      summary: args.summary,
      artifacts: args.artifacts ?? [],
      deviations: args.deviations ?? [],
      completed_at: new Date().toISOString(),
    };
    board.saveContract(orgId, contract);

    // Update own status
    board.updateAgentStatus(ctx.sessionId, {
      status: args.status === 'completed' ? 'completed' : args.status === 'partial' ? 'idle' : 'error',
      current_task: null,
    });

    // Notify delegator
    const delegatorAgent = ctx.sessionManager?.getAgent(contract.delegator);
    if (delegatorAgent) {
      delegatorAgent.processMessage(
        [
          `[TEAM PROTOCOL – TASK_RESULT] Contract "${args.contract_id}" completed.`,
          `Status: ${args.status}`,
          `Summary: ${args.summary}`,
          args.artifacts?.length ? `Artifacts: ${args.artifacts.join(', ')}` : '',
          args.deviations?.length ? `Deviations: ${args.deviations.join('; ')}` : '',
          `Run get_task_contract "${args.contract_id}" for full details.`,
        ].filter(Boolean).join('\n'),
        'system'
      ).catch(() => {});
    }

    if (args.status === 'completed') {
      const dispatch = getEventDispatch();
      await dispatch.dispatch({
        name: 'task_completed',
        orgId,
        agentId: ctx.sessionId,
        taskDescription: contract.inputs.description,
        artifactRefs: args.artifacts ?? [],
      });
    }

    return {
      success: true,
      output: [
        `Contract "${args.contract_id}" marked as ${args.status}.`,
        `Summary: ${args.summary}`,
        `Delegator (${contract.delegator}) has been notified.`,
      ].join('\n'),
    };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 14. list_task_contracts ----

export async function listTaskContracts(
  ctx: TeamProtocolToolContext,
  args: { role?: 'delegator' | 'assignee' | 'all'; status_filter?: TaskContract['status'] }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    const board = getSharedStateBoard(orgId);
    let contracts = board.listContracts(orgId).filter(c =>
      c.delegator === ctx.sessionId || c.assignee === ctx.sessionId
    );

    const role = args.role ?? 'all';
    if (role === 'delegator') contracts = contracts.filter(c => c.delegator === ctx.sessionId);
    if (role === 'assignee') contracts = contracts.filter(c => c.assignee === ctx.sessionId);
    if (args.status_filter) contracts = contracts.filter(c => c.status === args.status_filter);

    if (contracts.length === 0) {
      return { success: true, output: 'No task contracts found.' };
    }

    const lines = [`Task contracts (${contracts.length}):\n`];
    for (const c of contracts) {
      lines.push(`[${c.id}] ${c.status} | ${c.delegator} → ${c.assignee}`);
      lines.push(`  Task: ${c.inputs.description.slice(0, 80)}`);
      if (c.result) lines.push(`  Result: ${c.result.status} – ${c.result.summary.slice(0, 60)}`);
      lines.push('');
    }

    return { success: true, output: lines.join('\n') };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- 15. get_my_context_budget ----

export async function getMyContextBudget(
  ctx: TeamProtocolToolContext,
  args: { include_project_state?: boolean }
): Promise<ToolResult> {
  try {
    const orgId = requireOrg(ctx);
    if (!orgId) return { success: false, output: 'Cannot determine organization.' };

    const pendingMessages = getMessagesForSession(ctx.sessionId);
    const contextText = buildAgentContext(ctx.sessionId, orgId, pendingMessages, {
      includeProjectState: args.include_project_state !== false,
    });

    return { success: true, output: contextText };
  } catch (err) {
    return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Tool registry wiring (same pattern as enhanced-tools.ts)
// ---------------------------------------------------------------------------

export function buildTeamProtocolTools(ctx: TeamProtocolToolContext): ToolDefinition[] {
  const orgId = ctx.sessionManager?.getSessionOrganizationId(ctx.sessionId);
  if (!orgId) return [];

  return [
    {
      type: 'function',
      function: {
        name: 'read_project_state',
        description: 'Read the team\'s Shared State Board: project goal, phase, all agent statuses, pending decisions, blockers, and changelog. Call this at the start of each work session (Read-on-Entry).',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_my_status',
        description: 'Update your own entry in the Shared State Board. Call this whenever your status changes (working, blocked, completed, idle, error). Also use to register new artifacts you have produced.',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['idle', 'working', 'blocked', 'completed', 'error'],
              description: 'Your new status.',
            },
            current_task: { type: ['string', 'null'], description: 'Brief description of what you are working on.' },
            blocked_by: { type: ['string', 'null'], description: 'ID of the task, blocker, or agent you are waiting on.' },
            role: { type: 'string', description: 'Your role description (used for first-time registration).' },
            artifact_ref: { type: 'string', description: 'Unique ID of an artifact you are registering.' },
            artifact_description: { type: 'string', description: 'Description of the artifact.' },
            artifact_path: { type: 'string', description: 'File path or URI of the artifact.' },
          },
          required: ['status'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_project',
        description: 'Update the project-level goal and/or phase in the Shared State Board.',
        parameters: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: 'The project\'s overall goal.' },
            current_phase: { type: 'string', description: 'Current project phase name.' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'send_typed_message',
        description: 'Send a structured typed message to one or more agents. Use this for formal handoffs, status updates, decision requests, conflict reports, and knowledge sharing.',
        parameters: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['TASK_HANDOFF', 'TASK_RESULT', 'DECISION_REQUEST', 'DECISION_RESULT', 'STATUS_UPDATE', 'CONFLICT_REPORT', 'KNOWLEDGE_SHARE', 'REVIEW_REQUEST', 'REVIEW_RESULT', 'FREEFORM'],
              description: 'Message type.',
            },
            to: {
              oneOf: [
                { type: 'string', description: 'Single recipient session ID, or "*" for all.' },
                { type: 'array', items: { type: 'string' }, description: 'Multiple recipients.' },
              ],
            },
            priority: {
              type: 'string',
              enum: ['blocking', 'high', 'normal', 'low'],
              description: 'Delivery priority (blocking = immediate interrupt).',
            },
            context_summary: { type: 'string', description: '1–2 sentence background for this message.' },
            payload: { type: 'object', description: 'Message-type-specific payload. See agent-team-protocol.md for schemas.' },
          },
          required: ['type', 'to', 'context_summary', 'payload'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_typed_messages',
        description: 'Read incoming typed protocol messages from other agents.',
        parameters: {
          type: 'object',
          properties: {
            filter_type: {
              type: 'string',
              enum: ['TASK_HANDOFF', 'TASK_RESULT', 'DECISION_REQUEST', 'DECISION_RESULT', 'STATUS_UPDATE', 'CONFLICT_REPORT', 'KNOWLEDGE_SHARE', 'REVIEW_REQUEST', 'REVIEW_RESULT', 'FREEFORM'],
              description: 'Optionally filter by message type.',
            },
            mark_read: { type: 'boolean', description: 'Clear messages after reading.' },
            message_id: { type: 'string', description: 'Fetch a specific message by ID.' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'add_pending_decision',
        description: 'Add a decision that needs to be made to the Shared State Board. Notifies the owner agent.',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The decision question.' },
            owner: { type: 'string', description: 'Session ID of the agent responsible for deciding.' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  pros: { type: 'string' },
                  cons: { type: 'string' },
                },
                required: ['label', 'pros', 'cons'],
              },
              description: 'Available options (optional).',
            },
            deadline: { type: ['string', 'null'], description: 'ISO8601 deadline.' },
          },
          required: ['question', 'owner'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'resolve_decision',
        description: 'Resolve a pending decision. Automatically notifies all active team members.',
        parameters: {
          type: 'object',
          properties: {
            decision_id: { type: 'string', description: 'Decision ID (e.g. "D-ABC123").' },
            resolution: { type: 'string', description: 'The chosen resolution or explanation.' },
          },
          required: ['decision_id', 'resolution'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'report_blocker',
        description: 'Report a blocker that is preventing progress. Marks the affected agents as blocked on the State Board.',
        parameters: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'What is blocking progress.' },
            affected_agents: {
              type: 'array',
              items: { type: 'string' },
              description: 'Session IDs of blocked agents (defaults to yourself).',
            },
          },
          required: ['description'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'resolve_blocker',
        description: 'Resolve a blocker. Unblocks affected agents and notifies them automatically.',
        parameters: {
          type: 'object',
          properties: {
            blocker_id: { type: 'string', description: 'Blocker ID (e.g. "BLK-ABC123").' },
          },
          required: ['blocker_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_task_contract',
        description: 'Create a formal task contract for another agent. Defines inputs, expected outputs, acceptance criteria, authority scope, and failure handling. The assignee is notified automatically.',
        parameters: {
          type: 'object',
          properties: {
            assignee: { type: 'string', description: 'Session ID of the agent to assign the task to.' },
            description: { type: 'string', description: 'Full task description.' },
            input_artifacts: { type: 'array', items: { type: 'string' }, description: 'Artifact ref IDs that the assignee will use as input.' },
            constraints: {
              type: 'array',
              items: { type: 'object', properties: { constraint: { type: 'string' }, hard: { type: 'boolean' } }, required: ['constraint', 'hard'] },
              description: 'Constraints on the task.',
            },
            assumptions: { type: 'array', items: { type: 'string' }, description: 'Assumptions the assignee may rely on.' },
            output_format: { type: 'string', description: 'Expected output format (e.g. "TypeScript files").' },
            deliverables: { type: 'array', items: { type: 'string' }, description: 'List of specific deliverables.' },
            acceptance_criteria: {
              type: 'array',
              items: { type: 'object', properties: { criterion: { type: 'string' }, verification_method: { type: 'string' } }, required: ['criterion', 'verification_method'] },
              description: 'List of acceptance criteria.',
            },
            autonomous_decisions: { type: 'array', items: { type: 'string' }, description: 'Things the assignee can decide independently.' },
            must_consult: { type: 'array', items: { type: 'string' }, description: 'Things the assignee must ask before deciding.' },
            escalation_triggers: { type: 'array', items: { type: 'string' }, description: 'Conditions that warrant immediate escalation.' },
            on_blocked: { type: 'string' },
            on_partial_completion: { type: 'string' },
            on_assumption_violation: { type: 'string' },
            max_retries: { type: ['number', 'null'] },
            max_steps: { type: ['number', 'null'] },
            on_timeout: { type: 'string' },
          },
          required: ['assignee', 'description', 'output_format', 'deliverables', 'acceptance_criteria'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_task_contract',
        description: 'Read the full details of a task contract you are party to.',
        parameters: {
          type: 'object',
          properties: {
            contract_id: { type: 'string', description: 'Contract ID (e.g. "TC-ABC123").' },
          },
          required: ['contract_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'accept_task_contract',
        description: 'Accept a task contract assigned to you and begin work. Updates your status to "working".',
        parameters: {
          type: 'object',
          properties: {
            contract_id: { type: 'string', description: 'Contract ID to accept.' },
          },
          required: ['contract_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'complete_task_contract',
        description: 'Mark a task contract as completed, partial, or failed. Notifies the delegator.',
        parameters: {
          type: 'object',
          properties: {
            contract_id: { type: 'string', description: 'Contract ID to complete.' },
            status: { type: 'string', enum: ['completed', 'partial', 'failed'], description: 'Completion status.' },
            summary: { type: 'string', description: 'Summary of what was done.' },
            artifacts: { type: 'array', items: { type: 'string' }, description: 'Artifact refs produced.' },
            deviations: { type: 'array', items: { type: 'string' }, description: 'Deviations from the original contract.' },
          },
          required: ['contract_id', 'status', 'summary'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_task_contracts',
        description: 'List task contracts you are involved in as delegator or assignee.',
        parameters: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['delegator', 'assignee', 'all'], description: 'Filter by your role.' },
            status_filter: { type: 'string', enum: ['pending', 'accepted', 'in_progress', 'completed', 'partial', 'failed', 'cancelled'], description: 'Filter by contract status.' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_my_context_budget',
        description: 'Get your full structured context: your state, all pending typed messages (classified by priority tier), and the current Shared State Board snapshot. Call this when starting a work session.',
        parameters: {
          type: 'object',
          properties: {
            include_project_state: { type: 'boolean', description: 'Include full project state snapshot (default: true).' },
          },
          required: [],
        },
      },
    },
  ];
}

export async function executeTeamProtocolTool(
  name: string,
  args: Record<string, unknown>,
  ctx: TeamProtocolToolContext
): Promise<ToolResult | null> {
  switch (name) {
    case 'read_project_state':
      return readProjectState(ctx);
    case 'update_my_status':
      return updateMyStatus(ctx, args as any);
    case 'update_project':
      return updateProject(ctx, args as any);
    case 'send_typed_message':
      return sendTypedMessage(ctx, args as any);
    case 'read_typed_messages':
      return readTypedMessages(ctx, args as any);
    case 'add_pending_decision':
      return addPendingDecision(ctx, args as any);
    case 'resolve_decision':
      return resolveDecision(ctx, args as any);
    case 'report_blocker':
      return reportBlocker(ctx, args as any);
    case 'resolve_blocker':
      return resolveBlocker(ctx, args as any);
    case 'create_task_contract':
      return createTaskContract(ctx, args as any);
    case 'get_task_contract':
      return getTaskContract(ctx, args as any);
    case 'accept_task_contract':
      return acceptTaskContract(ctx, args as any);
    case 'complete_task_contract':
      return completeTaskContract(ctx, args as any);
    case 'list_task_contracts':
      return listTaskContracts(ctx, args as any);
    case 'get_my_context_budget':
      return getMyContextBudget(ctx, args as any);
    default:
      return null;
  }
}
