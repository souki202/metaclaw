/**
 * Shared State Board
 *
 * Persistent, file-backed project state for an agent organization.
 * Stored at: data/organizations/{orgId}/project-state.json
 *
 * Implements Read-on-Entry / Write-on-Exit protocol.
 * Conflict resolution: the newer timestamp wins; callers receive
 * the latest state after an update so they can detect drift.
 *
 * Changelog is capped at MAX_CHANGELOG_ENTRIES to bound file growth.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createLogger } from '../logger.js';
import type {
  ProjectState,
  ProjectStateAgent,
  PendingDecision,
  DecisionOption,
  Blocker,
  ChangelogEntry,
  AgentStatus,
  ArtifactRef,
  TaskContract,
} from './team-protocol-types.js';

const log = createLogger('shared-state-board');
const MAX_CHANGELOG_ENTRIES = 50;
const DATA_DIR = path.resolve(process.cwd(), 'data', 'organizations');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stateFilePath(orgId: string): string {
  return path.join(DATA_DIR, orgId, 'project-state.json');
}

function contractsDirPath(orgId: string): string {
  return path.join(DATA_DIR, orgId, 'task-contracts');
}

function contractFilePath(orgId: string, contractId: string): string {
  return path.join(contractsDirPath(orgId), `${contractId}.json`);
}

function defaultState(): ProjectState {
  return {
    project_state: {
      goal: '',
      current_phase: 'initializing',
      updated_at: new Date().toISOString(),
      agents: [],
      pending_decisions: [],
      blockers: [],
      changelog: [],
    },
  };
}

// ---------------------------------------------------------------------------
// SharedStateBoard
// ---------------------------------------------------------------------------

export class SharedStateBoard {
  private orgId: string;
  private filePath: string;

  constructor(orgId: string) {
    this.orgId = orgId;
    this.filePath = stateFilePath(orgId);
  }

  // ---- Persistence ----

  /**
   * Read current project state from disk.
   * Returns a default state if the file doesn't exist yet.
   */
  read(): ProjectState {
    try {
      if (!fs.existsSync(this.filePath)) {
        return defaultState();
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as ProjectState;
    } catch (err) {
      log.warn(`Failed to read project state for org "${this.orgId}", returning default:`, err);
      return defaultState();
    }
  }

  private write(state: ProjectState): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  // ---- Project-level updates ----

  /**
   * Set the project's top-level goal and/or phase.
   */
  updateProject(
    by: string,
    patch: { goal?: string; current_phase?: string }
  ): ProjectState {
    const state = this.read();
    const ps = state.project_state;

    const changed: string[] = [];
    if (patch.goal !== undefined && patch.goal !== ps.goal) {
      ps.goal = patch.goal;
      changed.push(`goal → "${patch.goal}"`);
    }
    if (patch.current_phase !== undefined && patch.current_phase !== ps.current_phase) {
      ps.current_phase = patch.current_phase;
      changed.push(`phase → "${patch.current_phase}"`);
    }

    if (changed.length > 0) {
      this.appendChangelog(ps, {
        agent: by,
        action: `Updated project: ${changed.join(', ')}`,
        diff_summary: changed.join('; '),
      });
      ps.updated_at = new Date().toISOString();
      this.write(state);
    }
    return state;
  }

  // ---- Agent entries ----

  /**
   * Register or refresh an agent entry in the board.
   */
  registerAgent(by: string, entry: Omit<ProjectStateAgent, 'artifacts'> & { artifacts?: ArtifactRef[] }): ProjectState {
    const state = this.read();
    const ps = state.project_state;
    const idx = ps.agents.findIndex(a => a.id === entry.id);
    const full: ProjectStateAgent = { artifacts: [], ...entry };

    if (idx >= 0) {
      ps.agents[idx] = full;
    } else {
      ps.agents.push(full);
    }

    this.appendChangelog(ps, {
      agent: by,
      action: `Registered agent ${entry.id} (${entry.role})`,
      diff_summary: `agent.${entry.id}: status=${entry.status}`,
    });
    ps.updated_at = new Date().toISOString();
    this.write(state);
    return state;
  }

  /**
   * Update an agent's status, current_task, blocked_by, or add artifacts.
   */
  updateAgentStatus(
    agentId: string,
    patch: {
      status?: AgentStatus;
      current_task?: string | null;
      blocked_by?: string | null;
      artifacts?: ArtifactRef[];
    }
  ): { state: ProjectState; wasBlocked: boolean; isNowUnblocked: boolean } {
    const state = this.read();
    const ps = state.project_state;

    let agent = ps.agents.find(a => a.id === agentId);
    if (!agent) {
      // Auto-register minimal entry
      agent = {
        id: agentId,
        role: 'unknown',
        status: 'idle',
        current_task: null,
        blocked_by: null,
        artifacts: [],
      };
      ps.agents.push(agent);
    }

    const wasBlocked = agent.status === 'blocked';
    const diffParts: string[] = [];

    if (patch.status !== undefined && patch.status !== agent.status) {
      diffParts.push(`status: ${agent.status} → ${patch.status}`);
      agent.status = patch.status;
    }
    if (patch.current_task !== undefined) {
      agent.current_task = patch.current_task;
      diffParts.push(`current_task: ${patch.current_task ?? 'null'}`);
    }
    if (patch.blocked_by !== undefined) {
      agent.blocked_by = patch.blocked_by;
      diffParts.push(`blocked_by: ${patch.blocked_by ?? 'null'}`);
    }
    if (patch.artifacts && patch.artifacts.length > 0) {
      for (const newArt of patch.artifacts) {
        const existing = agent.artifacts.findIndex(a => a.ref === newArt.ref);
        if (existing >= 0) {
          agent.artifacts[existing] = newArt;
        } else {
          agent.artifacts.push(newArt);
        }
        diffParts.push(`artifact: ${newArt.ref} v${newArt.version}`);
      }
    }

    const isNowUnblocked = wasBlocked && agent.status !== 'blocked';

    if (diffParts.length > 0) {
      this.appendChangelog(ps, {
        agent: agentId,
        action: `Agent ${agentId} updated: ${diffParts.join(', ')}`,
        diff_summary: diffParts.join('; '),
      });
      ps.updated_at = new Date().toISOString();
      this.write(state);
    }

    return { state, wasBlocked, isNowUnblocked };
  }

  /**
   * Return IDs of agents that are blocked by a given source (task or blocker).
   */
  getAgentsBlockedBy(sourceRef: string): string[] {
    const ps = this.read().project_state;
    return ps.agents
      .filter(a => a.status === 'blocked' && a.blocked_by === sourceRef)
      .map(a => a.id);
  }

  // ---- Pending decisions ----

  addDecision(
    by: string,
    decision: Omit<PendingDecision, 'status' | 'resolution'>
  ): ProjectState {
    const state = this.read();
    const ps = state.project_state;

    if (ps.pending_decisions.some(d => d.id === decision.id)) {
      log.warn(`Decision ${decision.id} already exists; ignoring duplicate.`);
      return state;
    }

    ps.pending_decisions.push({ ...decision, status: 'open', resolution: null });
    this.appendChangelog(ps, {
      agent: by,
      action: `Added decision ${decision.id}: "${decision.question}"`,
      diff_summary: `decisions.${decision.id}: open, owner=${decision.owner}`,
    });
    ps.updated_at = new Date().toISOString();
    this.write(state);
    return state;
  }

  resolveDecision(
    by: string,
    decisionId: string,
    resolution: string
  ): { state: ProjectState; found: boolean } {
    const state = this.read();
    const ps = state.project_state;
    const decision = ps.pending_decisions.find(d => d.id === decisionId);

    if (!decision) {
      return { state, found: false };
    }

    decision.status = 'resolved';
    decision.resolution = resolution;

    this.appendChangelog(ps, {
      agent: by,
      action: `Resolved decision ${decisionId}: "${resolution}"`,
      diff_summary: `decisions.${decisionId}: resolved`,
    });
    ps.updated_at = new Date().toISOString();
    this.write(state);
    return { state, found: true };
  }

  // ---- Blockers ----

  addBlocker(by: string, blocker: Omit<Blocker, 'resolved'>): ProjectState {
    const state = this.read();
    const ps = state.project_state;

    if (ps.blockers.some(b => b.id === blocker.id)) {
      log.warn(`Blocker ${blocker.id} already exists; ignoring duplicate.`);
      return state;
    }

    ps.blockers.push({ ...blocker, resolved: false });
    this.appendChangelog(ps, {
      agent: by,
      action: `Added blocker ${blocker.id}: "${blocker.description}"`,
      diff_summary: `blockers.${blocker.id}: active, affects=${blocker.affected_agents.join(',')}`,
    });
    ps.updated_at = new Date().toISOString();
    this.write(state);
    return state;
  }

  resolveBlocker(
    by: string,
    blockerId: string
  ): { state: ProjectState; found: boolean; affectedAgents: string[] } {
    const state = this.read();
    const ps = state.project_state;
    const blocker = ps.blockers.find(b => b.id === blockerId);

    if (!blocker || blocker.resolved) {
      return { state, found: false, affectedAgents: [] };
    }

    blocker.resolved = true;
    const affectedAgents = [...blocker.affected_agents];

    this.appendChangelog(ps, {
      agent: by,
      action: `Resolved blocker ${blockerId}`,
      diff_summary: `blockers.${blockerId}: resolved`,
    });
    ps.updated_at = new Date().toISOString();
    this.write(state);
    return { state, found: true, affectedAgents };
  }

  // ---- Changelog helpers ----

  private appendChangelog(
    ps: ProjectState['project_state'],
    entry: Omit<ChangelogEntry, 'timestamp'>
  ): void {
    ps.changelog.push({ ...entry, timestamp: new Date().toISOString() });
    // Keep only the most recent entries
    if (ps.changelog.length > MAX_CHANGELOG_ENTRIES) {
      ps.changelog = ps.changelog.slice(-MAX_CHANGELOG_ENTRIES);
    }
  }

  /**
   * Return the N most recent changelog entries (default 20).
   */
  getRecentChangelog(n = 20): ChangelogEntry[] {
    const ps = this.read().project_state;
    return ps.changelog.slice(-n);
  }

  // ---- Task Contracts ----

  saveContract(orgId: string, contract: TaskContract): void {
    const dir = contractsDirPath(orgId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(contractFilePath(orgId, contract.id), JSON.stringify(contract, null, 2), 'utf-8');
  }

  loadContract(orgId: string, contractId: string): TaskContract | null {
    const filePath = contractFilePath(orgId, contractId);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TaskContract;
    } catch {
      return null;
    }
  }

  listContracts(orgId: string): TaskContract[] {
    const dir = contractsDirPath(orgId);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const result: TaskContract[] = [];
    for (const file of files) {
      try {
        const c = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as TaskContract;
        result.push(c);
      } catch {
        // Skip corrupted files
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Registry of board instances (one per organization)
// ---------------------------------------------------------------------------

const boards = new Map<string, SharedStateBoard>();

export function getSharedStateBoard(orgId: string): SharedStateBoard {
  if (!boards.has(orgId)) {
    boards.set(orgId, new SharedStateBoard(orgId));
  }
  return boards.get(orgId)!;
}
