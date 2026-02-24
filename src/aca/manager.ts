/**
 * ACA Manager
 *
 * Main controller for the Autonomous Curiosity Architecture.
 * Coordinates frontier detection, goal generation, and objective scheduling.
 */

import { createLogger } from '../logger.js';
import { CuriosityStateManager } from './curiosity-state.js';
import { FrontierDetector } from './frontier-detector.js';
import { GoalGenerator } from './goal-generator.js';
import type { ACAConfig, AutonomousObjective } from './types.js';

const log = createLogger('aca-manager');

export class ACAManager {
  private sessionId: string;
  private workspace: string;
  private config: ACAConfig;
  private stateManager: CuriosityStateManager;
  private frontierDetector: FrontierDetector;
  private goalGenerator: GoalGenerator;
  private scanIntervalId?: NodeJS.Timeout;

  constructor(sessionId: string, workspace: string, config: ACAConfig) {
    this.sessionId = sessionId;
    this.workspace = workspace;
    this.config = config;
    this.stateManager = new CuriosityStateManager(workspace, sessionId);
    this.frontierDetector = new FrontierDetector(workspace);
    this.goalGenerator = new GoalGenerator();

    // Set enabled state
    this.stateManager.setEnabled(config.enabled);
  }

  /**
   * Start autonomous curiosity scanning
   */
  start(): void {
    if (!this.config.enabled) {
      log.info(`ACA is disabled for session: ${this.sessionId}`);
      return;
    }

    if (this.scanIntervalId) {
      log.warn(`ACA already running for session: ${this.sessionId}`);
      return;
    }

    log.info(
      `Starting ACA for session: ${this.sessionId} (scan interval: ${this.config.scanInterval} minutes)`
    );

    // Run initial scan immediately
    this.runScan().catch(e => log.error('Initial ACA scan failed:', e));

    // Schedule periodic scans
    const intervalMs = this.config.scanInterval * 60 * 1000;
    this.scanIntervalId = setInterval(() => {
      this.runScan().catch(e => log.error('Periodic ACA scan failed:', e));
    }, intervalMs);
  }

  /**
   * Stop autonomous curiosity scanning
   */
  stop(): void {
    if (this.scanIntervalId) {
      clearInterval(this.scanIntervalId);
      this.scanIntervalId = undefined;
      log.info(`Stopped ACA for session: ${this.sessionId}`);
    }
  }

  /**
   * Run a frontier scan and generate objectives
   */
  async runScan(): Promise<{
    knowledgeCount: number;
    capabilityCount: number;
    objectivesGenerated: number;
  }> {
    log.info(`Running ACA scan for session: ${this.sessionId}`);

    try {
      // Detect frontiers
      const { knowledge, capability, scan } = await this.frontierDetector.scan();

      // Add frontiers to state
      for (const kf of knowledge) {
        this.stateManager.addKnowledgeFrontier(kf);
      }

      for (const cf of capability) {
        this.stateManager.addCapabilityFrontier(cf);
      }

      // Generate objectives
      const knowledgeObjectives = this.goalGenerator.generateKnowledgeObjectives(
        knowledge,
        this.config
      );

      const capabilityObjectives = this.goalGenerator.generateCapabilityObjectives(
        capability,
        this.config
      );

      // Combine and prioritize
      const allObjectives = [
        ...knowledgeObjectives,
        ...capabilityObjectives,
      ];

      const prioritized = this.goalGenerator.prioritizeObjectives(allObjectives);

      // Limit by maxGoalsPerCycle
      const objectivesToAdd = prioritized.slice(0, this.config.maxGoalsPerCycle);

      // Add objectives to state
      const generatedObjectives: AutonomousObjective[] = [];
      for (const obj of objectivesToAdd) {
        const generated = this.stateManager.generateObjective(obj);
        generatedObjectives.push(generated);
      }

      // Update scan record
      scan.objectivesGenerated = generatedObjectives.length;
      this.stateManager.recordScan(scan);

      log.info(
        `ACA scan completed: ${knowledge.length} knowledge frontiers, ${capability.length} capability frontiers, ${generatedObjectives.length} objectives generated`
      );

      return {
        knowledgeCount: knowledge.length,
        capabilityCount: capability.length,
        objectivesGenerated: generatedObjectives.length,
      };
    } catch (error) {
      log.error('ACA scan failed:', error);
      throw error;
    }
  }

  /**
   * Get proposed objectives for user review or auto-scheduling
   */
  getProposedObjectives(): AutonomousObjective[] {
    return this.stateManager.getProposedObjectives();
  }

  /**
   * Get active objectives
   */
  getActiveObjectives(): AutonomousObjective[] {
    return this.stateManager.getActiveObjectives();
  }

  /**
   * Mark an objective as scheduled
   */
  scheduleObjective(objectiveId: string): void {
    this.stateManager.updateObjectiveStatus(objectiveId, 'scheduled');
  }

  /**
   * Start working on an objective
   */
  startObjective(objectiveId: string): void {
    this.stateManager.updateObjectiveStatus(objectiveId, 'in_progress');
  }

  /**
   * Complete an objective
   */
  completeObjective(
    objectiveId: string,
    success: boolean,
    summary: string,
    newKnowledge?: string[],
    newCapabilities?: string[]
  ): void {
    this.stateManager.updateObjectiveStatus(objectiveId, success ? 'completed' : 'abandoned', {
      success,
      summary,
      newKnowledge,
      newCapabilities,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Get curiosity state
   */
  getState() {
    return this.stateManager.getState();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ACAConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.enabled !== undefined) {
      this.stateManager.setEnabled(config.enabled);

      if (config.enabled) {
        this.start();
      } else {
        this.stop();
      }
    }

    log.info(`ACA config updated for session: ${this.sessionId}`);
  }
}
