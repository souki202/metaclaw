/**
 * ACA (Autonomous Curiosity Architecture) Tools
 *
 * Tools for agents to interact with the autonomous curiosity system.
 */

import type { ToolResult } from '../types.js';
import type { ToolContext } from '../tools/index.js';
import type { ACAManager } from './manager.js';
import { createLogger } from '../logger.js';

const log = createLogger('aca-tools');

export interface ACAToolContext extends ToolContext {
  acaManager?: ACAManager;
}

/**
 * View current curiosity state and frontiers
 */
export async function viewCuriosityState(ctx: ACAToolContext): Promise<ToolResult> {
  try {
    if (!ctx.acaManager) {
      return {
        success: false,
        output: 'ACA is not enabled for this session.',
      };
    }

    const state = ctx.acaManager.getState();

    const lines: string[] = [
      '# Autonomous Curiosity State',
      '',
      `Status: ${state.enabled ? 'Enabled' : 'Disabled'}`,
      `Last Scan: ${state.lastScanAt || 'Never'}`,
      '',
      '## Knowledge Frontiers',
      `Found: ${state.knowledgeFrontiers.length}`,
      '',
    ];

    if (state.knowledgeFrontiers.length > 0) {
      const top = state.knowledgeFrontiers
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 5);

      for (const f of top) {
        lines.push(`- [${f.category}] ${f.description}`);
        lines.push(`  Importance: ${f.importance.toFixed(2)}, Exploration Cost: ${f.explorationCost.toFixed(2)}`);
      }

      if (state.knowledgeFrontiers.length > 5) {
        lines.push(`  ... and ${state.knowledgeFrontiers.length - 5} more`);
      }
    }

    lines.push('');
    lines.push('## Capability Frontiers');
    lines.push(`Found: ${state.capabilityFrontiers.length}`);
    lines.push('');

    if (state.capabilityFrontiers.length > 0) {
      const top = state.capabilityFrontiers
        .sort((a, b) => b.impact - a.impact)
        .slice(0, 5);

      for (const f of top) {
        lines.push(`- [${f.category}] ${f.description}`);
        lines.push(`  Impact: ${f.impact.toFixed(2)}, Feasibility: ${f.feasibility.toFixed(2)}`);
        lines.push(`  Improvement: ${f.potentialImprovement}`);
      }

      if (state.capabilityFrontiers.length > 5) {
        lines.push(`  ... and ${state.capabilityFrontiers.length - 5} more`);
      }
    }

    lines.push('');
    lines.push('## Metrics');
    lines.push(`- Total Objectives Generated: ${state.metrics.totalObjectivesGenerated}`);
    lines.push(`- Objectives Completed: ${state.metrics.objectivesCompleted}`);
    lines.push(`- Objectives Abandoned: ${state.metrics.objectivesAbandoned}`);
    lines.push(`- Knowledge Gained: ${state.metrics.knowledgeGained} facts`);
    lines.push(`- Capabilities Gained: ${state.metrics.capabilitiesGained} skills`);

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (error) {
    log.error('Error viewing curiosity state:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * View generated objectives
 */
export async function viewObjectives(ctx: ACAToolContext): Promise<ToolResult> {
  try {
    if (!ctx.acaManager) {
      return {
        success: false,
        output: 'ACA is not enabled for this session.',
      };
    }

    const proposed = ctx.acaManager.getProposedObjectives();
    const active = ctx.acaManager.getActiveObjectives();

    const lines: string[] = ['# Autonomous Objectives', ''];

    if (active.length > 0) {
      lines.push('## Active Objectives');
      lines.push('');

      for (const obj of active) {
        lines.push(`### ${obj.title}`);
        lines.push(`**Status:** ${obj.status}`);
        lines.push(`**Type:** ${obj.type}`);
        lines.push(`**Priority:** ${obj.priority.toFixed(2)}`);
        lines.push(`**Estimated Duration:** ${obj.estimatedDuration} minutes`);
        lines.push(`**Motivation:** ${obj.motivation}`);
        lines.push(`**Description:** ${obj.description}`);
        lines.push('');
      }
    }

    if (proposed.length > 0) {
      lines.push('## Proposed Objectives');
      lines.push('');

      for (const obj of proposed) {
        lines.push(`### ${obj.title}`);
        lines.push(`**Type:** ${obj.type}`);
        lines.push(`**Priority:** ${obj.priority.toFixed(2)}`);
        lines.push(`**Estimated Duration:** ${obj.estimatedDuration} minutes`);
        lines.push(`**Motivation:** ${obj.motivation}`);
        lines.push(`**Description:** ${obj.description}`);
        lines.push('');
      }

      lines.push(
        'Use schedule_objective to schedule a proposed objective for execution.'
      );
    }

    if (active.length === 0 && proposed.length === 0) {
      lines.push('No objectives currently. Run trigger_curiosity_scan to generate new objectives.');
    }

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (error) {
    log.error('Error viewing objectives:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Trigger a curiosity scan manually
 */
export async function triggerCuriosityScan(ctx: ACAToolContext): Promise<ToolResult> {
  try {
    if (!ctx.acaManager) {
      return {
        success: false,
        output: 'ACA is not enabled for this session.',
      };
    }

    const result = await ctx.acaManager.runScan();

    return {
      success: true,
      output: [
        'Curiosity scan completed!',
        '',
        `- Knowledge Frontiers: ${result.knowledgeCount}`,
        `- Capability Frontiers: ${result.capabilityCount}`,
        `- Objectives Generated: ${result.objectivesGenerated}`,
        '',
        'Use view_objectives to see the generated objectives.',
      ].join('\n'),
    };
  } catch (error) {
    log.error('Error triggering curiosity scan:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Schedule an objective for execution
 */
export async function scheduleObjective(
  ctx: ACAToolContext,
  args: { objective_id: string; schedule_at?: string }
): Promise<ToolResult> {
  try {
    if (!ctx.acaManager) {
      return {
        success: false,
        output: 'ACA is not enabled for this session.',
      };
    }

    const objectives = ctx.acaManager.getProposedObjectives();
    const objective = objectives.find(o => o.id === args.objective_id);

    if (!objective) {
      return {
        success: false,
        output: `Objective not found: ${args.objective_id}`,
      };
    }

    // Mark as scheduled
    ctx.acaManager.scheduleObjective(args.objective_id);

    // If schedule_at provided and schedule tools available, create a schedule
    if (args.schedule_at && ctx.scheduleCreate) {
      const schedule = ctx.scheduleCreate({
        startAt: args.schedule_at,
        repeatCron: 'none',
        memo: `[AUTONOMOUS OBJECTIVE] ${objective.title}\n\n${objective.description}\n\nObjective ID: ${objective.id}\n\nPlease work on this objective and use complete_objective when done.`,
      });

      return {
        success: true,
        output: [
          `Objective scheduled: ${objective.title}`,
          `Schedule ID: ${schedule.id}`,
          `Will execute at: ${schedule.nextRunAt}`,
        ].join('\n'),
      };
    }

    return {
      success: true,
      output: `Objective marked as scheduled: ${objective.title}`,
    };
  } catch (error) {
    log.error('Error scheduling objective:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Complete an objective
 */
export async function completeObjective(
  ctx: ACAToolContext,
  args: {
    objective_id: string;
    success: boolean;
    summary: string;
    new_knowledge?: string;
    new_capabilities?: string;
  }
): Promise<ToolResult> {
  try {
    if (!ctx.acaManager) {
      return {
        success: false,
        output: 'ACA is not enabled for this session.',
      };
    }

    const newKnowledge = args.new_knowledge
      ? args.new_knowledge.split('\n').filter(l => l.trim())
      : undefined;

    const newCapabilities = args.new_capabilities
      ? args.new_capabilities.split('\n').filter(l => l.trim())
      : undefined;

    ctx.acaManager.completeObjective(
      args.objective_id,
      args.success,
      args.summary,
      newKnowledge,
      newCapabilities
    );

    return {
      success: true,
      output: [
        `Objective ${args.success ? 'completed' : 'abandoned'}: ${args.objective_id}`,
        '',
        args.summary,
        '',
        newKnowledge && newKnowledge.length > 0
          ? `Knowledge gained: ${newKnowledge.length} facts`
          : '',
        newCapabilities && newCapabilities.length > 0
          ? `Capabilities gained: ${newCapabilities.length} skills`
          : '',
      ]
        .filter(l => l !== '')
        .join('\n'),
    };
  } catch (error) {
    log.error('Error completing objective:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
