/**
 * Curiosity State Manager
 *
 * Manages the autonomous curiosity state for a session, including
 * frontier tracking and objective management.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createLogger } from '../logger.js';
import type {
  CuriosityState,
  KnowledgeFrontier,
  CapabilityFrontier,
  AutonomousObjective,
  FrontierScan,
  CuriosityMetrics,
} from './types.js';

const log = createLogger('aca-state');

export class CuriosityStateManager {
  private workspace: string;
  private stateFile: string;
  private state: CuriosityState;

  constructor(workspace: string, sessionId: string) {
    this.workspace = workspace;
    this.stateFile = path.join(workspace, 'CURIOSITY.md');
    this.state = this.loadState(sessionId);
  }

  /**
   * Load curiosity state from file or create default
   */
  private loadState(sessionId: string): CuriosityState {
    if (fs.existsSync(this.stateFile)) {
      try {
        const content = fs.readFileSync(this.stateFile, 'utf-8');
        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);

        if (jsonMatch) {
          const state = JSON.parse(jsonMatch[1]) as CuriosityState;
          log.info(`Loaded curiosity state for ${sessionId}`);
          return state;
        }
      } catch (error) {
        log.error(`Failed to load curiosity state:`, error);
      }
    }

    // Create default state
    return {
      sessionId,
      enabled: false,
      knowledgeFrontiers: [],
      capabilityFrontiers: [],
      objectives: [],
      scanHistory: [],
      metrics: {
        totalObjectivesGenerated: 0,
        objectivesCompleted: 0,
        objectivesAbandoned: 0,
        totalExplorationTime: 0,
        knowledgeGained: 0,
        capabilitiesGained: 0,
      },
    };
  }

  /**
   * Save state to file
   */
  private saveState(): void {
    const content = [
      '# Autonomous Curiosity State',
      '',
      'This file tracks autonomous exploration frontiers and self-generated objectives.',
      '',
      '## Current Status',
      '',
      `- Enabled: ${this.state.enabled}`,
      `- Last Scan: ${this.state.lastScanAt || 'Never'}`,
      `- Knowledge Frontiers: ${this.state.knowledgeFrontiers.length}`,
      `- Capability Frontiers: ${this.state.capabilityFrontiers.length}`,
      `- Active Objectives: ${this.state.objectives.filter(o => o.status === 'in_progress' || o.status === 'scheduled').length}`,
      '',
      '## Metrics',
      '',
      `- Total Objectives Generated: ${this.state.metrics.totalObjectivesGenerated}`,
      `- Objectives Completed: ${this.state.metrics.objectivesCompleted}`,
      `- Objectives Abandoned: ${this.state.metrics.objectivesAbandoned}`,
      `- Total Exploration Time: ${this.state.metrics.totalExplorationTime} minutes`,
      `- Knowledge Gained: ${this.state.metrics.knowledgeGained} new facts`,
      `- Capabilities Gained: ${this.state.metrics.capabilitiesGained} new skills`,
      '',
      '## State Data',
      '',
      '```json',
      JSON.stringify(this.state, null, 2),
      '```',
    ].join('\n');

    fs.writeFileSync(this.stateFile, content, 'utf-8');
  }

  /**
   * Enable or disable ACA
   */
  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
    this.saveState();
    log.info(`ACA ${enabled ? 'enabled' : 'disabled'} for ${this.state.sessionId}`);
  }

  /**
   * Add a knowledge frontier
   */
  addKnowledgeFrontier(frontier: Omit<KnowledgeFrontier, 'id' | 'discoveredAt'>): KnowledgeFrontier {
    const newFrontier: KnowledgeFrontier = {
      ...frontier,
      id: randomUUID(),
      discoveredAt: new Date().toISOString(),
    };

    this.state.knowledgeFrontiers.push(newFrontier);
    this.saveState();
    log.info(`Added knowledge frontier: ${newFrontier.description}`);

    return newFrontier;
  }

  /**
   * Add a capability frontier
   */
  addCapabilityFrontier(frontier: Omit<CapabilityFrontier, 'id' | 'discoveredAt'>): CapabilityFrontier {
    const newFrontier: CapabilityFrontier = {
      ...frontier,
      id: randomUUID(),
      discoveredAt: new Date().toISOString(),
    };

    this.state.capabilityFrontiers.push(newFrontier);
    this.saveState();
    log.info(`Added capability frontier: ${newFrontier.description}`);

    return newFrontier;
  }

  /**
   * Generate and add an autonomous objective
   */
  generateObjective(objective: Omit<AutonomousObjective, 'id' | 'createdAt' | 'status'>): AutonomousObjective {
    const newObjective: AutonomousObjective = {
      ...objective,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'proposed',
    };

    this.state.objectives.push(newObjective);
    this.state.metrics.totalObjectivesGenerated++;
    this.saveState();
    log.info(`Generated objective: ${newObjective.title}`);

    return newObjective;
  }

  /**
   * Update objective status
   */
  updateObjectiveStatus(
    objectiveId: string,
    status: AutonomousObjective['status'],
    result?: AutonomousObjective['result']
  ): void {
    const objective = this.state.objectives.find(o => o.id === objectiveId);

    if (!objective) {
      throw new Error(`Objective not found: ${objectiveId}`);
    }

    objective.status = status;

    if (result) {
      objective.result = result;
    }

    if (status === 'completed' && result) {
      this.state.metrics.objectivesCompleted++;
      if (result.newKnowledge) {
        this.state.metrics.knowledgeGained += result.newKnowledge.length;
      }
      if (result.newCapabilities) {
        this.state.metrics.capabilitiesGained += result.newCapabilities.length;
      }
    } else if (status === 'abandoned') {
      this.state.metrics.objectivesAbandoned++;
    }

    this.saveState();
    log.info(`Updated objective ${objectiveId} status to ${status}`);
  }

  /**
   * Record a frontier scan
   */
  recordScan(scan: FrontierScan): void {
    this.state.lastScanAt = scan.timestamp;
    this.state.scanHistory.push(scan);

    // Keep only last 50 scans
    if (this.state.scanHistory.length > 50) {
      this.state.scanHistory = this.state.scanHistory.slice(-50);
    }

    this.saveState();
  }

  /**
   * Get active objectives
   */
  getActiveObjectives(): AutonomousObjective[] {
    return this.state.objectives.filter(
      o => o.status === 'in_progress' || o.status === 'scheduled'
    );
  }

  /**
   * Get proposed objectives
   */
  getProposedObjectives(): AutonomousObjective[] {
    return this.state.objectives.filter(o => o.status === 'proposed');
  }

  /**
   * Get high-priority frontiers
   */
  getHighPriorityKnowledgeFrontiers(minImportance: number = 0.5): KnowledgeFrontier[] {
    return this.state.knowledgeFrontiers.filter(f => f.importance >= minImportance);
  }

  /**
   * Get high-impact capability frontiers
   */
  getHighImpactCapabilityFrontiers(minImpact: number = 0.5): CapabilityFrontier[] {
    return this.state.capabilityFrontiers.filter(f => f.impact >= minImpact && f.feasibility >= 0.3);
  }

  /**
   * Get current state
   */
  getState(): CuriosityState {
    return { ...this.state };
  }

  /**
   * Clear old completed/abandoned objectives
   */
  pruneOldObjectives(daysOld: number = 30): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    const cutoffTime = cutoff.toISOString();

    const before = this.state.objectives.length;

    this.state.objectives = this.state.objectives.filter(o => {
      if (o.status === 'completed' || o.status === 'abandoned') {
        return o.createdAt > cutoffTime;
      }
      return true;
    });

    const pruned = before - this.state.objectives.length;

    if (pruned > 0) {
      this.saveState();
      log.info(`Pruned ${pruned} old objectives`);
    }

    return pruned;
  }
}
