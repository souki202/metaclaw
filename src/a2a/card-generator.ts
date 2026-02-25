/**
 * Agent Card Generator
 *
 * Generates agent cards dynamically based on session configuration,
 * available tools, and specializations.
 */

import fs from 'fs';
import path from 'path';
import type { SessionConfig } from '../types.js';
import type { AgentCard, AgentCapability } from './types.js';
import { createLogger } from '../logger.js';

const log = createLogger('a2a-card-gen');

/**
 * Generate an agent card for a session
 */
export function generateAgentCard(
  sessionId: string,
  config: SessionConfig,
  workspace: string,
  availableTools: string[]
): AgentCard {
  // Read identity information
  const identityPath = path.join(workspace, 'IDENTITY.md');
  let agentName = config.name || sessionId;
  let description = config.description || 'An AI agent';

  if (fs.existsSync(identityPath)) {
    try {
      const identityContent = fs.readFileSync(identityPath, 'utf-8');
      const nameMatch = identityContent.match(/^#\s+(.+)$/m);
      if (nameMatch) {
        agentName = nameMatch[1];
      }

      // Extract description from first paragraph
      const lines = identityContent.split('\n');
      const descLines: string[] = [];
      let inDesc = false;
      for (const line of lines) {
        if (line.trim() === '' && inDesc) break;
        if (line.startsWith('#')) {
          inDesc = true;
          continue;
        }
        if (inDesc && line.trim() !== '') {
          descLines.push(line.trim());
        }
      }
      if (descLines.length > 0) {
        description = descLines.join(' ').substring(0, 200);
      }
    } catch (error) {
      log.warn(`Failed to read IDENTITY.md for ${sessionId}:`, error);
    }
  }

  // Determine specializations based on enabled tools and config
  const specializations: string[] = [];

  if (config.tools.web) {
    specializations.push('web-research');
    specializations.push('web-browsing');
  }

  if (config.tools.exec) {
    specializations.push('code-execution');
    specializations.push('system-administration');
  }

  if (config.tools.memory) {
    specializations.push('knowledge-management');
    specializations.push('memory-retention');
  }

  if (config.allowSelfModify) {
    specializations.push('self-improvement');
    specializations.push('code-modification');
  }

  // Check for browser tools
  if (availableTools.some(tool => tool.startsWith('browser_'))) {
    specializations.push('web-automation');
    specializations.push('ui-interaction');
  }

  // Check for MCP servers
  if (config.mcpServers) {
    const mcpTools = Object.keys(config.mcpServers);
    if (mcpTools.length > 0) {
      specializations.push('extended-capabilities');
    }
  }

  // Generate capabilities based on specializations
  const capabilities = generateCapabilities(specializations, availableTools);

  return {
    sessionId,
    agentName,
    description,
    capabilities,
    specializations,
    availableTools: availableTools.filter(tool => !config.disabledTools?.includes(tool)),
    status: 'active',
    lastUpdated: new Date().toISOString(),
    hiddenFromAgents: config.a2a?.hiddenFromAgents || false,
  };
}

/**
 * Generate capabilities based on specializations
 */
function generateCapabilities(
  specializations: string[],
  availableTools: string[]
): AgentCapability[] {
  const capabilities: AgentCapability[] = [];

  if (specializations.includes('web-research')) {
    capabilities.push({
      name: 'research_topic',
      description: 'Research a topic using web search and return comprehensive findings',
      parameters: [
        { name: 'topic', type: 'string', description: 'The topic to research', required: true },
        { name: 'depth', type: 'string', description: 'Research depth: quick, medium, or deep', required: false },
      ],
      examples: ['Research the latest developments in quantum computing'],
    });
  }

  if (specializations.includes('web-automation')) {
    capabilities.push({
      name: 'automate_web_task',
      description: 'Automate web interactions using a browser',
      parameters: [
        { name: 'task', type: 'string', description: 'Description of the web task', required: true },
        { name: 'url', type: 'string', description: 'Starting URL', required: false },
      ],
      examples: ['Fill out a form at example.com', 'Extract data from a table on a webpage'],
    });
  }

  if (specializations.includes('code-execution')) {
    capabilities.push({
      name: 'execute_code',
      description: 'Execute code or commands in the workspace environment',
      parameters: [
        { name: 'task', type: 'string', description: 'Description of what to execute', required: true },
        { name: 'language', type: 'string', description: 'Programming language or shell', required: false },
      ],
      examples: ['Run Python script to analyze data', 'Execute shell commands for setup'],
    });
  }

  if (specializations.includes('knowledge-management')) {
    capabilities.push({
      name: 'manage_knowledge',
      description: 'Store, retrieve, and organize information in memory',
      parameters: [
        { name: 'task', type: 'string', description: 'Knowledge management task', required: true },
        { name: 'query', type: 'string', description: 'Search query for retrieval', required: false },
      ],
      examples: ['Store findings about user preferences', 'Retrieve information about project X'],
    });
  }

  if (specializations.includes('code-modification')) {
    capabilities.push({
      name: 'modify_code',
      description: 'Read, analyze, and modify code files',
      parameters: [
        { name: 'task', type: 'string', description: 'Code modification task', required: true },
        { name: 'files', type: 'string', description: 'Target files or patterns', required: false },
      ],
      examples: ['Refactor function X to improve performance', 'Add error handling to module Y'],
    });
  }

  // Generic task execution capability
  capabilities.push({
    name: 'execute_task',
    description: 'Execute a general task using available tools and capabilities',
    parameters: [
      { name: 'task', type: 'string', description: 'Description of the task to execute', required: true },
      { name: 'context', type: 'object', description: 'Additional context or data', required: false },
    ],
    examples: ['Analyze this data and provide insights', 'Help me solve this problem'],
  });

  return capabilities;
}

/**
 * Update agent card based on current state
 */
export function updateAgentCard(
  existingCard: AgentCard,
  status?: 'active' | 'idle' | 'busy',
  availableTools?: string[]
): AgentCard {
  const updated = { ...existingCard };

  if (status) {
    updated.status = status;
  }

  if (availableTools) {
    updated.availableTools = availableTools;
  }

  updated.lastUpdated = new Date().toISOString();

  return updated;
}
