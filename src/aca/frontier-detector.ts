/**
 * Frontier Detector
 *
 * Analyzes workspace files and memory to detect knowledge and capability frontiers.
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger.js';
import type {
  KnowledgeFrontier,
  CapabilityFrontier,
  FrontierScan,
} from './types.js';

const log = createLogger('aca-frontier');

export class FrontierDetector {
  private workspace: string;

  constructor(workspace: string) {
    this.workspace = workspace;
  }

  /**
   * Perform a full frontier scan
   */
  async scan(): Promise<{
    knowledge: Omit<KnowledgeFrontier, 'id' | 'discoveredAt'>[];
    capability: Omit<CapabilityFrontier, 'id' | 'discoveredAt'>[];
    scan: FrontierScan;
  }> {
    const startTime = Date.now();
    const filesAnalyzed: string[] = [];

    const knowledge: Omit<KnowledgeFrontier, 'id' | 'discoveredAt'>[] = [];
    const capability: Omit<CapabilityFrontier, 'id' | 'discoveredAt'>[] = [];

    // Analyze key workspace files
    try {
      // Scan USER.md for user context
      const userFrontiers = await this.scanUserFile();
      knowledge.push(...userFrontiers.knowledge);
      capability.push(...userFrontiers.capability);
      filesAnalyzed.push('USER.md');

      // Scan MEMORY.md for knowledge gaps
      const memoryFrontiers = await this.scanMemoryFile();
      knowledge.push(...memoryFrontiers.knowledge);
      filesAnalyzed.push('MEMORY.md');

      // Scan TMP_MEMORY.md for ongoing work
      const tmpFrontiers = await this.scanTmpMemoryFile();
      knowledge.push(...tmpFrontiers.knowledge);
      capability.push(...tmpFrontiers.capability);
      filesAnalyzed.push('TMP_MEMORY.md');

      // Scan history for patterns
      const historyFrontiers = await this.scanHistoryFile();
      capability.push(...historyFrontiers.capability);
      filesAnalyzed.push('history.jsonl');
    } catch (error) {
      log.error('Error during frontier scan:', error);
    }

    const scan: FrontierScan = {
      timestamp: new Date().toISOString(),
      frontiersFound: knowledge.length + capability.length,
      objectivesGenerated: 0, // Will be set by caller
      scanDuration: Date.now() - startTime,
      filesAnalyzed,
    };

    log.info(`Frontier scan completed: ${knowledge.length} knowledge, ${capability.length} capability frontiers`);

    return { knowledge, capability, scan };
  }

  /**
   * Scan USER.md for context and gaps
   */
  private async scanUserFile(): Promise<{
    knowledge: Omit<KnowledgeFrontier, 'id' | 'discoveredAt'>[];
    capability: Omit<CapabilityFrontier, 'id' | 'discoveredAt'>[];
  }> {
    const knowledge: Omit<KnowledgeFrontier, 'id' | 'discoveredAt'>[] = [];
    const capability: Omit<CapabilityFrontier, 'id' | 'discoveredAt'>[] = [];

    const userPath = path.join(this.workspace, 'USER.md');

    if (!fs.existsSync(userPath)) {
      return { knowledge, capability };
    }

    const content = fs.readFileSync(userPath, 'utf-8');

    // Look for question marks (indicating uncertainty)
    const questionMatches = content.match(/^.*\?.*$/gm);
    if (questionMatches) {
      for (const q of questionMatches.slice(0, 3)) {
        // Limit to 3
        knowledge.push({
          category: 'incomplete_information',
          description: `User question: ${q.trim()}`,
          relatedContext: ['USER.md'],
          importance: 0.6,
          explorationCost: 0.3,
        });
      }
    }

    // Look for TODO markers
    const todoMatches = content.match(/^.*TODO:(.*)$/gim);
    if (todoMatches) {
      for (const todo of todoMatches.slice(0, 3)) {
        capability.push({
          category: 'manual_workflow',
          description: `Unfinished task: ${todo.trim()}`,
          currentLimitation: 'Task marked as TODO but not completed',
          potentialImprovement: 'Automate or complete this task',
          impact: 0.5,
          feasibility: 0.6,
        });
      }
    }

    return { knowledge, capability };
  }

  /**
   * Scan MEMORY.md for knowledge gaps
   */
  private async scanMemoryFile(): Promise<{
    knowledge: Omit<KnowledgeFrontier, 'id' | 'discoveredAt'>[];
  }> {
    const knowledge: Omit<KnowledgeFrontier, 'id' | 'discoveredAt'>[] = [];

    const memoryPath = path.join(this.workspace, 'MEMORY.md');

    if (!fs.existsSync(memoryPath)) {
      return { knowledge };
    }

    const content = fs.readFileSync(memoryPath, 'utf-8');

    // Look for phrases indicating incomplete knowledge
    const uncertaintyPhrases = [
      /unclear/gi,
      /not sure/gi,
      /unknown/gi,
      /need to (?:learn|research|understand)/gi,
      /don't know/gi,
    ];

    for (const phrase of uncertaintyPhrases) {
      const matches = content.match(phrase);
      if (matches && matches.length > 0) {
        // Find the sentence containing the match
        const sentences = content.split(/[.!?]\s+/);
        for (const sentence of sentences) {
          if (phrase.test(sentence)) {
            knowledge.push({
              category: 'unknown_concept',
              description: sentence.trim(),
              relatedContext: ['MEMORY.md'],
              importance: 0.5,
              explorationCost: 0.4,
            });
            break; // Only add once per phrase
          }
        }
      }
    }

    return { knowledge };
  }

  /**
   * Scan TMP_MEMORY.md for ongoing work and blockers
   */
  private async scanTmpMemoryFile(): Promise<{
    knowledge: Omit<KnowledgeFrontier, 'id' | 'discoveredAt'>[];
    capability: Omit<CapabilityFrontier, 'id' | 'discoveredAt'>[];
  }> {
    const knowledge: Omit<KnowledgeFrontier, 'id' | 'discoveredAt'>[] = [];
    const capability: Omit<CapabilityFrontier, 'id' | 'discoveredAt'>[] = [];

    const tmpPath = path.join(this.workspace, 'TMP_MEMORY.md');

    if (!fs.existsSync(tmpPath)) {
      return { knowledge, capability };
    }

    const content = fs.readFileSync(tmpPath, 'utf-8');

    // Look for blockers
    const blockerPatterns = [
      /blocker:(.+)/gi,
      /blocked by:(.+)/gi,
      /cannot (.+) because/gi,
      /stuck on (.+)/gi,
    ];

    for (const pattern of blockerPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        capability.push({
          category: 'missing_tool',
          description: `Blocker: ${match[1]?.trim() || match[0].trim()}`,
          currentLimitation: 'Task blocked by missing capability or knowledge',
          potentialImprovement: 'Develop tool or acquire knowledge to unblock',
          impact: 0.7,
          feasibility: 0.5,
        });
      }
    }

    // Look for unchecked tasks
    const uncheckedTasks = content.match(/^- \[ \] (.+)$/gm);
    if (uncheckedTasks && uncheckedTasks.length > 5) {
      // Many unchecked tasks suggest inefficiency
      capability.push({
        category: 'inefficient_process',
        description: `${uncheckedTasks.length} pending tasks in temporary memory`,
        currentLimitation: 'Large backlog of pending tasks',
        potentialImprovement: 'Optimize task execution or develop automation',
        impact: 0.6,
        feasibility: 0.7,
      });
    }

    return { knowledge, capability };
  }

  /**
   * Scan history.jsonl for patterns and errors
   */
  private async scanHistoryFile(): Promise<{
    capability: Omit<CapabilityFrontier, 'id' | 'discoveredAt'>[];
  }> {
    const capability: Omit<CapabilityFrontier, 'id' | 'discoveredAt'>[] = [];

    const historyPath = path.join(this.workspace, 'history.jsonl');

    if (!fs.existsSync(historyPath)) {
      return { capability };
    }

    try {
      const content = fs.readFileSync(historyPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      // Only analyze recent history (last 100 lines)
      const recentLines = lines.slice(-100);

      let errorCount = 0;
      let toolFailures = 0;

      for (const line of recentLines) {
        try {
          const msg = JSON.parse(line);

          // Count tool failures
          if (msg.role === 'tool' && msg.content) {
            const toolContent = msg.content.toLowerCase();
            if (
              toolContent.includes('error') ||
              toolContent.includes('failed') ||
              toolContent.includes('exception')
            ) {
              toolFailures++;
            }
          }

          // Count errors in assistant messages
          if (msg.role === 'assistant' && msg.content) {
            if (
              msg.content.toLowerCase().includes('error') ||
              msg.content.toLowerCase().includes('failed')
            ) {
              errorCount++;
            }
          }
        } catch (e) {
          // Skip malformed lines
        }
      }

      // If tool failures are frequent, suggest improvement
      if (toolFailures > 5) {
        capability.push({
          category: 'error_prone_task',
          description: `Frequent tool failures detected (${toolFailures} in recent history)`,
          currentLimitation: 'Tools are failing frequently, reducing effectiveness',
          potentialImprovement: 'Investigate root causes and improve tool reliability',
          impact: 0.8,
          feasibility: 0.6,
        });
      }
    } catch (error) {
      log.error('Error scanning history file:', error);
    }

    return { capability };
  }
}
