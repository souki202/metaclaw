/**
 * AI Agent Team Coordination Protocol – Type Definitions
 *
 * Implements the Typed Message Protocol, Shared State Board schema,
 * and Task Contract schema described in agent-team-protocol.md.
 */

// ---------------------------------------------------------------------------
// Shared State Board
// ---------------------------------------------------------------------------

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'completed' | 'error';

export interface ProjectStateAgent {
  id: string; // session ID
  role: string;
  status: AgentStatus;
  /** Current task description – null when idle */
  current_task: string | null;
  /** Reference to blocking cause (task ID, blocker ID, or description) */
  blocked_by: string | null;
  /** Artifacts produced by this agent */
  artifacts: ArtifactRef[];
}

export interface ArtifactRef {
  /** Unique identifier scoped to the project */
  ref: string;
  description: string;
  version: number;
  path: string;
}

export interface PendingDecision {
  id: string; // e.g. "D-012"
  question: string;
  options: DecisionOption[];
  owner: string; // agent session ID
  deadline: string | null; // ISO8601
  status: 'open' | 'resolved';
  resolution: string | null;
}

export interface DecisionOption {
  label: string;
  pros: string;
  cons: string;
}

export interface Blocker {
  id: string;
  description: string;
  affected_agents: string[];
  created_at: string; // ISO8601
  resolved: boolean;
}

export interface ChangelogEntry {
  timestamp: string; // ISO8601
  agent: string;
  action: string;
  diff_summary: string;
}

export interface ProjectState {
  project_state: {
    goal: string;
    current_phase: string;
    updated_at: string;
    agents: ProjectStateAgent[];
    pending_decisions: PendingDecision[];
    blockers: Blocker[];
    /** Capped at last 50 entries */
    changelog: ChangelogEntry[];
  };
}

// ---------------------------------------------------------------------------
// Typed Message Protocol
// ---------------------------------------------------------------------------

export type TypedMessageType =
  | 'TASK_HANDOFF'
  | 'TASK_RESULT'
  | 'DECISION_REQUEST'
  | 'DECISION_RESULT'
  | 'STATUS_UPDATE'
  | 'CONFLICT_REPORT'
  | 'KNOWLEDGE_SHARE'
  | 'REVIEW_REQUEST'
  | 'REVIEW_RESULT'
  | 'FREEFORM';

export type MessagePriority = 'blocking' | 'high' | 'normal' | 'low';

export interface StateRef {
  type: 'agent' | 'decision' | 'blocker' | 'artifact';
  id: string;
}

export interface TypedMessageHeader {
  id: string;
  type: TypedMessageType;
  from: string;
  /** Single agent ID or array; an organization-level broadcast uses '*' */
  to: string | string[];
  priority: MessagePriority;
  timestamp: string;
  context_summary: string;
  related_state_refs: StateRef[];
}

// ---- Payload types ----

export interface TaskHandoffPayload {
  task_description: string;
  input_artifacts: string[];
  expected_output: {
    format: string;
    success_criteria: string[];
  };
  constraints: string[];
  authority_scope: string;
  fallback_on_failure: string;
  /** Optional full task contract (Phase 3) */
  task_contract_id?: string;
}

export interface TaskResultPayload {
  original_task_ref: string;
  status: 'completed' | 'partial' | 'failed';
  output_artifacts: string[];
  summary: string;
  deviations: string[] | null;
  open_questions: string[] | null;
}

export interface DecisionRequestPayload {
  decision_id: string;
  question: string;
  options: DecisionRequestOption[];
  recommended: string | null;
  deadline_steps: number | null;
}

export interface DecisionRequestOption {
  label: string;
  analysis: string;
  recommendation_score: number | null;
}

export interface DecisionResultPayload {
  decision_id: string;
  chosen_option: string;
  rationale: string;
  additional_constraints: string[] | null;
}

export interface StatusUpdatePayload {
  task_ref: string | null;
  new_status: AgentStatus;
  progress_summary: string;
  estimated_remaining: string | null;
  blockers: string[] | null;
}

export interface ConflictReportPayload {
  conflict_description: string;
  conflicting_artifacts: string[];
  conflicting_decisions: string[] | null;
  suggested_resolution: string | null;
  severity: 'critical' | 'warning' | 'info';
}

export interface KnowledgeSharePayload {
  topic: string;
  content: string;
  relevance_to_recipients: string;
  actionable: boolean;
  action_suggestion: string | null;
}

export interface ReviewRequestPayload {
  artifact_ref: string;
  review_focus: string[];
  blocking: boolean;
}

export type ReviewVerdict = 'approved' | 'changes_requested' | 'rejected';

export interface ReviewFinding {
  severity: 'critical' | 'major' | 'minor' | 'suggestion';
  location: string;
  description: string;
  suggested_fix: string | null;
}

export interface ReviewResultPayload {
  artifact_ref: string;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  summary: string;
}

export interface FreeformPayload {
  intent_hint: string;
  body: string;
  requires_response: boolean;
  urgency: MessagePriority;
}

export type TypedMessagePayload =
  | TaskHandoffPayload
  | TaskResultPayload
  | DecisionRequestPayload
  | DecisionResultPayload
  | StatusUpdatePayload
  | ConflictReportPayload
  | KnowledgeSharePayload
  | ReviewRequestPayload
  | ReviewResultPayload
  | FreeformPayload;

export interface TypedMessage {
  header: TypedMessageHeader;
  payload: TypedMessagePayload;
}

// ---------------------------------------------------------------------------
// Task Contract (Contract-Based Delegation)
// ---------------------------------------------------------------------------

export interface ContractConstraint {
  constraint: string;
  /** true = must never violate; false = best effort */
  hard: boolean;
}

export interface AcceptanceCriterion {
  criterion: string;
  verification_method: string;
}

export interface TaskContract {
  id: string;
  delegator: string;
  assignee: string;
  created_at: string;
  status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'partial' | 'failed' | 'cancelled';

  inputs: {
    description: string;
    artifacts: string[];
    constraints: ContractConstraint[];
    assumptions: string[];
  };

  expected_output: {
    format: string;
    schema: string | null;
    deliverables: string[];
  };

  acceptance_criteria: AcceptanceCriterion[];

  authority: {
    autonomous_decisions: string[];
    must_consult: string[];
    escalation_triggers: string[];
  };

  failure_handling: {
    on_blocked: string;
    on_partial_completion: string;
    on_assumption_violation: string;
    max_retries: number | null;
  };

  timeout: {
    max_steps: number | null;
    on_timeout: string;
  };

  /** Result populated when contract is completed/partial/failed */
  result?: {
    status: 'completed' | 'partial' | 'failed';
    summary: string;
    artifacts: string[];
    deviations: string[];
    completed_at: string;
  };
}

// ---------------------------------------------------------------------------
// Context Budget Manager
// ---------------------------------------------------------------------------

export type ContextTier = 'critical' | 'relevant' | 'background' | 'irrelevant';

export interface ClassifiedMessage {
  message: TypedMessage;
  tier: ContextTier;
  /** Digest used for background/irrelevant tiers */
  digest: string;
}
