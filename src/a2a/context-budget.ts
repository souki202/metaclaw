/**
 * Context Budget Manager
 *
 * Controls what information each agent receives at the start of their turn.
 * Messages are classified into four tiers:
 *
 *   critical    – full content delivered immediately
 *   relevant    – structured summary
 *   background  – one-line digest
 *   irrelevant  – omitted entirely
 *
 * Classification follows the rules in agent-team-protocol.md §3.
 */

import { createLogger } from '../logger.js';
import { getSharedStateBoard } from './shared-state-board.js';
import type {
  TypedMessage,
  ClassifiedMessage,
  ContextTier,
  MessagePriority,
  TaskHandoffPayload,
  TaskResultPayload,
  DecisionRequestPayload,
  StatusUpdatePayload,
  ConflictReportPayload,
  KnowledgeSharePayload,
} from './team-protocol-types.js';

const log = createLogger('context-budget');

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Determine the context tier for a typed message delivered to `recipientId`.
 */
export function classifyMessage(
  message: TypedMessage,
  recipientId: string
): ContextTier {
  const { header } = message;
  const toList = Array.isArray(header.to) ? header.to : [header.to];
  const isDirectlyAddressed = toList.includes(recipientId);
  const isBroadcast = toList.includes('*');
  const isBlocking = header.priority === 'blocking';
  const isHighOrAbove = header.priority === 'high' || isBlocking;

  // Rule 1: explicitly addressed + blocking → critical
  if (isDirectlyAddressed && isBlocking) return 'critical';

  // Rule 2: explicitly addressed → relevant (or critical if blocking, already handled)
  if (isDirectlyAddressed) return 'relevant';

  // Rule 3: broadcast + high priority → relevant
  if (isBroadcast && isHighOrAbove) return 'relevant';

  // Rule 4: broadcast, normal/low → background
  if (isBroadcast) return 'background';

  // Rule 5: not addressed → irrelevant
  return 'irrelevant';
}

// ---------------------------------------------------------------------------
// Context rendering
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function oneLineDigest(message: TypedMessage): string {
  const { header, payload } = message;
  const from = header.from;
  const type = header.type;
  const ts = formatTimestamp(header.timestamp);
  const hint = header.context_summary.slice(0, 80);
  return `[${ts}] ${from} (${type}): ${hint}`;
}

function structuredSummary(message: TypedMessage, recipientId: string): string {
  const { header, payload } = message;
  const lines: string[] = [
    `[要約] ${header.from} が ${header.type} を送信。`,
    `[背景] ${header.context_summary}`,
  ];

  // Additional impact hints per type
  switch (header.type) {
    case 'STATUS_UPDATE': {
      const p = payload as StatusUpdatePayload;
      lines.push(`[影響] ${header.from} のステータス: ${p.new_status}. 残り: ${p.estimated_remaining ?? '不明'}`);
      break;
    }
    case 'TASK_RESULT': {
      const p = payload as TaskResultPayload;
      lines.push(`[影響] タスク完了 (${p.status}). 成果物: ${p.output_artifacts.join(', ') || 'なし'}`);
      break;
    }
    case 'KNOWLEDGE_SHARE': {
      const p = payload as KnowledgeSharePayload;
      if (p.actionable) {
        lines.push(`[要対応] ${p.action_suggestion ?? 'アクションを確認してください'}`);
      }
      break;
    }
    case 'CONFLICT_REPORT': {
      const p = payload as ConflictReportPayload;
      lines.push(`[影響] 重要度 ${p.severity}. 関連: ${p.conflicting_artifacts.join(', ')}`);
      break;
    }
  }

  lines.push(`[詳細が必要なら] メッセージID: ${header.id}`);
  return lines.join('\n');
}

function fullContent(message: TypedMessage): string {
  return JSON.stringify(message, null, 2);
}

/**
 * Classify and render a list of typed messages for a specific recipient.
 */
export function classifyMessages(
  messages: TypedMessage[],
  recipientId: string
): ClassifiedMessage[] {
  return messages
    .map(msg => {
      const tier = classifyMessage(msg, recipientId);
      let digest = '';
      if (tier === 'background') {
        digest = oneLineDigest(msg);
      } else if (tier === 'irrelevant') {
        digest = ''; // omit
      }
      return { message: msg, tier, digest } as ClassifiedMessage;
    })
    .filter(c => c.tier !== 'irrelevant');
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export interface ContextBudgetOptions {
  /** Maximum number of background entries to include */
  maxBackground?: number;
  /** Whether to include the full project state snapshot */
  includeProjectState?: boolean;
}

/**
 * Build the full structured context string for an agent's turn.
 *
 * Template from agent-team-protocol.md §3:
 *   === あなたの現在の状態 ===
 *   === 未処理の受信メッセージ (critical) ===
 *   === 最近の変更 (relevant) ===
 *   === バックグラウンド (直近N件) ===
 *   === プロジェクト全体の現在の状態 ===
 */
export function buildAgentContext(
  recipientId: string,
  orgId: string,
  pendingMessages: TypedMessage[],
  opts: ContextBudgetOptions = {}
): string {
  const {
    maxBackground = 10,
    includeProjectState = true,
  } = opts;

  const board = getSharedStateBoard(orgId);
  const state = board.read().project_state;

  // ---- My current state ----
  const myAgent = state.agents.find(a => a.id === recipientId);
  const myStatePart = myAgent
    ? [
        `=== あなたの現在の状態 ===`,
        `ID: ${myAgent.id}`,
        `Role: ${myAgent.role}`,
        `Status: ${myAgent.status}`,
        `Current task: ${myAgent.current_task ?? 'none'}`,
        `Blocked by: ${myAgent.blocked_by ?? 'none'}`,
        `Artifacts produced: ${myAgent.artifacts.map(a => `${a.ref} v${a.version}`).join(', ') || 'none'}`,
      ].join('\n')
    : `=== あなたの現在の状態 ===\n(未登録のエージェントです)`;

  // ---- Classify messages ----
  const classified = classifyMessages(pendingMessages, recipientId);
  const critical = classified.filter(c => c.tier === 'critical');
  const relevant = classified.filter(c => c.tier === 'relevant');
  const background = classified.filter(c => c.tier === 'background').slice(-maxBackground);

  // ---- Critical ----
  const criticalPart = critical.length > 0
    ? [
        `=== 未処理の受信メッセージ (critical) ===`,
        ...critical.map(c => fullContent(c.message)),
      ].join('\n\n')
    : `=== 未処理の受信メッセージ (critical) ===\n(なし)`;

  // ---- Relevant ----
  const relevantPart = relevant.length > 0
    ? [
        `=== 最近の変更 (relevant) ===`,
        ...relevant.map(c => structuredSummary(c.message, recipientId)),
      ].join('\n\n')
    : `=== 最近の変更 (relevant) ===\n(なし)`;

  // ---- Background ----
  const backgroundPart = background.length > 0
    ? [
        `=== バックグラウンド (直近${background.length}件) ===`,
        ...background.map(c => c.digest),
      ].join('\n')
    : `=== バックグラウンド ===\n(なし)`;

  // ---- Project state snapshot ----
  let projectStatePart = '';
  if (includeProjectState) {
    const recentChangelog = state.changelog.slice(-5);
    const openDecisions = state.pending_decisions.filter(d => d.status === 'open');
    const activeBlockers = state.blockers.filter(b => !b.resolved);

    projectStatePart = [
      `=== プロジェクト全体の現在の状態 ===`,
      `Goal: ${state.goal || '(未設定)'}`,
      `Phase: ${state.current_phase}`,
      `Updated: ${state.updated_at}`,
      ``,
      `Agents (${state.agents.length}):`,
      ...state.agents.map(a =>
        `  - ${a.id} [${a.status}] ${a.current_task ? `→ ${a.current_task}` : ''}`
      ),
      ``,
      `Open decisions (${openDecisions.length}):`,
      ...openDecisions.map(d => `  - [${d.id}] ${d.question} (owner: ${d.owner})`),
      ``,
      `Active blockers (${activeBlockers.length}):`,
      ...activeBlockers.map(b => `  - [${b.id}] ${b.description}`),
      ``,
      `Recent changelog:`,
      ...recentChangelog.map(e => `  [${formatTimestamp(e.timestamp)}] ${e.agent}: ${e.action}`),
    ].join('\n');
  }

  return [
    myStatePart,
    '',
    criticalPart,
    '',
    relevantPart,
    '',
    backgroundPart,
    includeProjectState ? '' : null,
    includeProjectState ? projectStatePart : null,
  ].filter(l => l !== null).join('\n');
}
