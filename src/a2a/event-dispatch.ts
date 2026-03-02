/**
 * Event-Driven Reactive Dispatch
 *
 * Watches for state changes in the SharedStateBoard and automatically
 * notifies affected agents. This layer sits above the basic A2A message
 * transport and the organization group chat.
 *
 * The dispatcher is an event emitter; the SessionManager connects to it
 * via `setAgentNotifier` to break the circular dependency.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../logger.js';
import { getSharedStateBoard } from './shared-state-board.js';
import type { TypedMessage, StatusUpdatePayload, KnowledgeSharePayload } from './team-protocol-types.js';
import { randomUUID } from 'crypto';

const log = createLogger('event-dispatch');

// ---------------------------------------------------------------------------
// Callback type used by Session Manager to deliver generated notifications
// ---------------------------------------------------------------------------

/**
 * Called when the dispatcher wants to send a notification to an agent.
 * Implementations should call `agent.processMessage(content, 'system')`.
 */
export type AgentNotifier = (sessionId: string, content: string) => Promise<void>;

/**
 * Called when the dispatcher wants to post to the org group chat.
 */
export type GroupChatPoster = (organizationId: string, senderSessionId: string, content: string) => void;

// ---------------------------------------------------------------------------
// Event catalogue (mirrors agent-team-protocol.md §5)
// ---------------------------------------------------------------------------

export type DispatchEventName =
  | 'task_completed'
  | 'task_blocked'
  | 'decision_resolved'
  | 'conflict_detected'
  | 'artifact_updated'
  | 'blocker_resolved'
  | 'agent_status_changed';

export interface TaskCompletedEvent {
  name: 'task_completed';
  orgId: string;
  agentId: string;
  taskDescription: string;
  artifactRefs: string[];
}

export interface TaskBlockedEvent {
  name: 'task_blocked';
  orgId: string;
  agentId: string;
  blockedBy: string;
  taskDescription: string | null;
}

export interface DecisionResolvedEvent {
  name: 'decision_resolved';
  orgId: string;
  decisionId: string;
  resolution: string;
  ownerAgentId: string;
}

export interface ConflictDetectedEvent {
  name: 'conflict_detected';
  orgId: string;
  reporterAgentId: string;
  conflictDescription: string;
  conflictingArtifacts: string[];
  severity: 'critical' | 'warning' | 'info';
}

export interface ArtifactUpdatedEvent {
  name: 'artifact_updated';
  orgId: string;
  agentId: string;
  artifactRef: string;
  oldVersion: number;
  newVersion: number;
  changeSummary: string;
}

export interface BlockerResolvedEvent {
  name: 'blocker_resolved';
  orgId: string;
  blockerId: string;
  resolvedBy: string;
  affectedAgents: string[];
}

export interface AgentStatusChangedEvent {
  name: 'agent_status_changed';
  orgId: string;
  agentId: string;
  oldStatus: string;
  newStatus: string;
}

export type DispatchEvent =
  | TaskCompletedEvent
  | TaskBlockedEvent
  | DecisionResolvedEvent
  | ConflictDetectedEvent
  | ArtifactUpdatedEvent
  | BlockerResolvedEvent
  | AgentStatusChangedEvent;

// ---------------------------------------------------------------------------
// EventDrivenDispatch
// ---------------------------------------------------------------------------

export class EventDrivenDispatch extends EventEmitter {
  private notifier: AgentNotifier | null = null;
  private groupChatPoster: GroupChatPoster | null = null;

  /**
   * Inject the agent notifier after construction to avoid circular deps.
   */
  setAgentNotifier(fn: AgentNotifier): void {
    this.notifier = fn;
  }

  /**
   * Inject the group chat poster after construction.
   */
  setGroupChatPoster(fn: GroupChatPoster): void {
    this.groupChatPoster = fn;
  }

  // ---- Main dispatch entry point ----

  async dispatch(event: DispatchEvent): Promise<void> {
    log.info(`Dispatching event: ${event.name} (org=${event.orgId})`);
    this.emit(event.name, event);

    switch (event.name) {
      case 'task_completed':
        await this.handleTaskCompleted(event);
        break;
      case 'task_blocked':
        await this.handleTaskBlocked(event);
        break;
      case 'decision_resolved':
        await this.handleDecisionResolved(event);
        break;
      case 'conflict_detected':
        await this.handleConflictDetected(event);
        break;
      case 'artifact_updated':
        await this.handleArtifactUpdated(event);
        break;
      case 'blocker_resolved':
        await this.handleBlockerResolved(event);
        break;
      case 'agent_status_changed':
        // Logged only; callers can subscribe via EventEmitter if needed
        break;
    }
  }

  // ---- Handlers ----

  private async handleTaskCompleted(event: TaskCompletedEvent): Promise<void> {
    const board = getSharedStateBoard(event.orgId);

    // Find agents blocked on this task
    const blockedAgents = board.getAgentsBlockedBy(event.agentId);

    for (const sessionId of blockedAgents) {
      const msg = this.buildTaskCompletedNotification(event);
      await this.notify(sessionId, msg);

      // Update their status to idle on the board
      board.updateAgentStatus(sessionId, {
        status: 'idle',
        blocked_by: null,
      });
    }

    if (blockedAgents.length > 0) {
      log.info(`Unblocked ${blockedAgents.length} agent(s) after task completion by ${event.agentId}`);
    }
  }

  private async handleTaskBlocked(event: TaskBlockedEvent): Promise<void> {
    // Notify the blocking source agent (if it's another session ID)
    const board = getSharedStateBoard(event.orgId);
    const state = board.read().project_state;
    const sourceName = event.blockedBy;

    // Try to inform the source agent if they're registered
    const sourceAgent = state.agents.find(a => a.id === sourceName);
    if (sourceAgent) {
      const msg = [
        `[TEAM PROTOCOL – KNOWLEDGE_SHARE]`,
        `Agent "${event.agentId}" is blocked waiting for your output.`,
        `Blocked on: ${sourceName}`,
        event.taskDescription ? `Their current task: ${event.taskDescription}` : '',
        `Please prioritize if possible.`,
      ].filter(Boolean).join('\n');
      await this.notify(sourceName, msg);
    }
  }

  private async handleDecisionResolved(event: DecisionResolvedEvent): Promise<void> {
    const board = getSharedStateBoard(event.orgId);
    const state = board.read().project_state;

    // Notify all active (non-idle, non-completed) agents about the resolution
    const relevantAgents = state.agents.filter(
      a => a.id !== event.ownerAgentId && a.status !== 'completed'
    );

    for (const agent of relevantAgents) {
      const msg = [
        `[TEAM PROTOCOL – DECISION_RESOLVED]`,
        `Decision "${event.decisionId}" has been resolved.`,
        `Resolution: ${event.resolution}`,
        `Resolved by: ${event.ownerAgentId}`,
        `Check if this affects your current task and update your approach accordingly.`,
      ].join('\n');
      await this.notify(agent.id, msg);
    }
  }

  private async handleConflictDetected(event: ConflictDetectedEvent): Promise<void> {
    // For critical conflicts, post to group chat to ensure visibility
    if (event.severity === 'critical' && this.groupChatPoster) {
      const msg = [
        `⚠️ CRITICAL CONFLICT DETECTED by ${event.reporterAgentId}`,
        `Description: ${event.conflictDescription}`,
        `Conflicting artifacts: ${event.conflictingArtifacts.join(', ')}`,
        `All agents: please review and pause related work until resolved.`,
      ].join('\n');
      this.groupChatPoster(event.orgId, event.reporterAgentId, msg);
    }

    // Notify artifact owners
    const board = getSharedStateBoard(event.orgId);
    const state = board.read().project_state;

    for (const artifactRef of event.conflictingArtifacts) {
      // Find the agent that owns this artifact
      const owner = state.agents.find(a =>
        a.artifacts.some(art => art.ref === artifactRef)
      );
      if (owner && owner.id !== event.reporterAgentId) {
        const msg = [
          `[TEAM PROTOCOL – CONFLICT_REPORT] severity=${event.severity}`,
          `Conflict involving your artifact "${artifactRef}":`,
          event.conflictDescription,
          `Reporter: ${event.reporterAgentId}`,
          `Please investigate and respond.`,
        ].join('\n');
        await this.notify(owner.id, msg);
      }
    }
  }

  private async handleArtifactUpdated(event: ArtifactUpdatedEvent): Promise<void> {
    const board = getSharedStateBoard(event.orgId);
    const state = board.read().project_state;

    // Notify agents whose input_artifacts reference this artifact
    // (We check task contracts stored on disk)
    const contracts = board.listContracts(event.orgId);
    const dependentSessions = new Set<string>();

    for (const contract of contracts) {
      if (
        contract.inputs.artifacts.includes(event.artifactRef) &&
        contract.assignee !== event.agentId &&
        contract.status === 'in_progress'
      ) {
        dependentSessions.add(contract.assignee);
      }
    }

    for (const sessionId of dependentSessions) {
      const msg = [
        `[TEAM PROTOCOL – ARTIFACT_UPDATED]`,
        `A dependency you rely on has been updated:`,
        `Artifact: ${event.artifactRef} (v${event.oldVersion} → v${event.newVersion})`,
        `Changed by: ${event.agentId}`,
        `Change summary: ${event.changeSummary}`,
        `Please check whether your current work needs adjustments.`,
      ].join('\n');
      await this.notify(sessionId, msg);
    }
  }

  private async handleBlockerResolved(event: BlockerResolvedEvent): Promise<void> {
    for (const sessionId of event.affectedAgents) {
      const board = getSharedStateBoard(event.orgId);
      board.updateAgentStatus(sessionId, { status: 'idle', blocked_by: null });

      const msg = [
        `[TEAM PROTOCOL – BLOCKER_RESOLVED]`,
        `Blocker "${event.blockerId}" has been resolved by ${event.resolvedBy}.`,
        `You can now resume your work.`,
        `Read the project state board to get the latest context before proceeding.`,
      ].join('\n');
      await this.notify(sessionId, msg);
    }
  }

  // ---- Notification helpers ----

  private async notify(sessionId: string, content: string): Promise<void> {
    if (!this.notifier) {
      log.warn(`No agent notifier set; cannot deliver notification to "${sessionId}"`);
      return;
    }
    try {
      await this.notifier(sessionId, content);
    } catch (err) {
      log.error(`Failed to notify agent "${sessionId}":`, err);
    }
  }

  private buildTaskCompletedNotification(event: TaskCompletedEvent): string {
    return [
      `[TEAM PROTOCOL – STATUS_UPDATE: task_completed]`,
      `Agent "${event.agentId}" has completed their task.`,
      `Task: ${event.taskDescription}`,
      event.artifactRefs.length > 0
        ? `Produced artifacts: ${event.artifactRefs.join(', ')}`
        : '',
      ``,
      `A dependency you were blocked on is now resolved.`,
      `Read the Shared State Board to get the latest artifacts, then resume your work.`,
    ].filter(l => l !== undefined).join('\n');
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let _instance: EventDrivenDispatch | null = null;

export function getEventDispatch(): EventDrivenDispatch {
  if (!_instance) {
    _instance = new EventDrivenDispatch();
  }
  return _instance;
}
