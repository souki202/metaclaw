/**
 * Goal Generator
 *
 * Generates autonomous objectives based on detected frontiers.
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../logger.js';
import type {
  KnowledgeFrontier,
  CapabilityFrontier,
  AutonomousObjective,
  ACAConfig,
} from './types.js';

const log = createLogger('aca-goals');

export class GoalGenerator {
  /**
   * Generate objectives from knowledge frontiers
   */
  generateKnowledgeObjectives(
    frontiers: (KnowledgeFrontier | Omit<KnowledgeFrontier, 'id' | 'discoveredAt'>)[],
    config: ACAConfig
  ): Omit<AutonomousObjective, 'id' | 'createdAt' | 'status'>[] {
    const objectives: Omit<AutonomousObjective, 'id' | 'createdAt' | 'status'>[] = [];

    // Filter by importance threshold
    const relevantFrontiers = frontiers.filter(
      f => f.importance >= config.minImportanceThreshold
    );

    // Sort by importance
    relevantFrontiers.sort((a, b) => b.importance - a.importance);

    // Take top N based on maxGoalsPerCycle
    const topFrontiers = relevantFrontiers.slice(
      0,
      Math.ceil(config.maxGoalsPerCycle / 2)
    );

    for (const frontier of topFrontiers) {
      const objective = this.createKnowledgeObjective(frontier as KnowledgeFrontier);
      objectives.push(objective);
    }

    return objectives;
  }

  /**
   * Generate objectives from capability frontiers
   */
  generateCapabilityObjectives(
    frontiers: (CapabilityFrontier | Omit<CapabilityFrontier, 'id' | 'discoveredAt'>)[],
    config: ACAConfig
  ): Omit<AutonomousObjective, 'id' | 'createdAt' | 'status'>[] {
    const objectives: Omit<AutonomousObjective, 'id' | 'createdAt' | 'status'>[] = [];

    // Calculate priority score: impact * feasibility
    const scoredFrontiers = frontiers.map(f => ({
      frontier: f,
      score: f.impact * f.feasibility,
    }));

    // Sort by score
    scoredFrontiers.sort((a, b) => b.score - a.score);

    // Take top N based on maxGoalsPerCycle
    const topFrontiers = scoredFrontiers.slice(
      0,
      Math.ceil(config.maxGoalsPerCycle / 2)
    );

    for (const { frontier, score } of topFrontiers) {
      if (score >= config.minImportanceThreshold) {
        const objective = this.createCapabilityObjective(frontier as CapabilityFrontier);
        objectives.push(objective);
      }
    }

    return objectives;
  }

  /**
   * Create an objective from a knowledge frontier
   */
  private createKnowledgeObjective(frontier: KnowledgeFrontier | Omit<KnowledgeFrontier, 'id' | 'discoveredAt'>): Omit<AutonomousObjective, 'id' | 'createdAt' | 'status'> {
    let type: AutonomousObjective['type'] = 'explore_knowledge';
    let title = '';
    let description = '';
    let motivation = '';
    let estimatedDuration = 0;

    switch (frontier.category) {
      case 'unknown_concept':
        title = `Research: ${frontier.description.substring(0, 50)}`;
        description = `Investigate and understand: ${frontier.description}`;
        motivation = 'Filling knowledge gap identified in workspace analysis';
        estimatedDuration = Math.ceil(frontier.explorationCost * 60); // Convert to minutes
        break;

      case 'incomplete_information':
        title = `Complete information: ${frontier.description.substring(0, 50)}`;
        description = `Gather missing details about: ${frontier.description}`;
        motivation = 'User has questions or incomplete information';
        estimatedDuration = Math.ceil(frontier.explorationCost * 45);
        break;

      case 'outdated_knowledge':
        title = `Update knowledge: ${frontier.description.substring(0, 50)}`;
        description = `Refresh outdated information: ${frontier.description}`;
        motivation = 'Keeping knowledge base current';
        estimatedDuration = Math.ceil(frontier.explorationCost * 30);
        break;

      case 'unexplored_topic':
        title = `Explore: ${frontier.description.substring(0, 50)}`;
        description = `Dive into new topic: ${frontier.description}`;
        motivation = 'Expanding knowledge into new areas';
        estimatedDuration = Math.ceil(frontier.explorationCost * 90);
        break;
    }

    return {
      type,
      title,
      description,
      motivation,
      frontierId: ('id' in frontier) ? frontier.id : undefined,
      priority: frontier.importance,
      estimatedDuration,
    };
  }

  /**
   * Create an objective from a capability frontier
   */
  private createCapabilityObjective(frontier: CapabilityFrontier | Omit<CapabilityFrontier, 'id' | 'discoveredAt'>): Omit<AutonomousObjective, 'id' | 'createdAt' | 'status'> {
    let type: AutonomousObjective['type'] = 'develop_capability';
    let title = '';
    let description = '';
    let motivation = '';
    let estimatedDuration = 0;

    switch (frontier.category) {
      case 'missing_tool':
        type = 'learn_skill';
        title = `Acquire capability: ${frontier.description.substring(0, 50)}`;
        description = `Develop or learn: ${frontier.potentialImprovement}`;
        motivation = `Current limitation: ${frontier.currentLimitation}`;
        estimatedDuration = Math.ceil((1 - frontier.feasibility) * 120);
        break;

      case 'inefficient_process':
        type = 'optimize_process';
        title = `Optimize: ${frontier.description.substring(0, 50)}`;
        description = `Improve efficiency: ${frontier.potentialImprovement}`;
        motivation = `Current inefficiency: ${frontier.currentLimitation}`;
        estimatedDuration = Math.ceil((1 - frontier.feasibility) * 90);
        break;

      case 'error_prone_task':
        type = 'develop_capability';
        title = `Fix reliability: ${frontier.description.substring(0, 50)}`;
        description = `Improve reliability: ${frontier.potentialImprovement}`;
        motivation = `Current issues: ${frontier.currentLimitation}`;
        estimatedDuration = Math.ceil((1 - frontier.feasibility) * 75);
        break;

      case 'manual_workflow':
        type = 'develop_capability';
        title = `Automate: ${frontier.description.substring(0, 50)}`;
        description = `Automate manual process: ${frontier.potentialImprovement}`;
        motivation = `Manual work identified: ${frontier.currentLimitation}`;
        estimatedDuration = Math.ceil((1 - frontier.feasibility) * 60);
        break;
    }

    return {
      type,
      title,
      description,
      motivation,
      frontierId: ('id' in frontier) ? frontier.id : undefined,
      priority: frontier.impact * frontier.feasibility,
      estimatedDuration,
    };
  }

  /**
   * Prioritize objectives by multiple criteria
   */
  prioritizeObjectives(objectives: (AutonomousObjective | Omit<AutonomousObjective, 'id' | 'createdAt' | 'status'>)[]): (AutonomousObjective | Omit<AutonomousObjective, 'id' | 'createdAt' | 'status'>)[] {
    return objectives.sort((a, b) => {
      // Primary: priority score
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }

      // Secondary: shorter duration first
      return a.estimatedDuration - b.estimatedDuration;
    });
  }
}
