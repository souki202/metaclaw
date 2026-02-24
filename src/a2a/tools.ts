/**
 * A2A (Agent-to-Agent) Communication Tools
 *
 * Tools for inter-agent communication and collaboration.
 */

import type { ToolResult } from '../types.js';
import type { ToolContext } from '../tools/index.js';
import type { A2ARegistry } from '../a2a/registry.js';
import type { AgentCard } from '../a2a/types.js';
import { createLogger } from '../logger.js';

const log = createLogger('a2a-tools');

export interface A2AToolContext extends ToolContext {
  a2aRegistry?: A2ARegistry;
}

/**
 * List all available agents and their capabilities
 */
export async function listAgents(ctx: A2AToolContext): Promise<ToolResult> {
  try {
    if (!ctx.a2aRegistry) {
      return {
        success: false,
        output: 'A2A Registry is not available. This feature may not be enabled.',
      };
    }

    const cards = ctx.a2aRegistry.getAllCards();

    if (cards.length === 0) {
      return {
        success: true,
        output: 'No other agents are currently registered.',
      };
    }

    const lines: string[] = ['Available Agents:\n'];

    for (const card of cards) {
      if (card.sessionId === ctx.sessionId) continue; // Skip self

      lines.push(`\n### ${card.agentName} (${card.sessionId})`);
      lines.push(`Status: ${card.status}`);
      lines.push(`Description: ${card.description}`);
      lines.push(`Specializations: ${card.specializations.join(', ')}`);
      lines.push('\nCapabilities:');
      for (const cap of card.capabilities) {
        lines.push(`  - ${cap.name}: ${cap.description}`);
      }
    }

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (error) {
    log.error('Error listing agents:', error);
    return {
      success: false,
      output: `Error listing agents: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Find agents with specific capabilities
 */
export async function findAgents(
  ctx: A2AToolContext,
  args: { capability?: string; specialization?: string }
): Promise<ToolResult> {
  try {
    if (!ctx.a2aRegistry) {
      return {
        success: false,
        output: 'A2A Registry is not available.',
      };
    }

    let cards: AgentCard[] = [];

    if (args.capability) {
      cards = ctx.a2aRegistry.findAgentsByCapability(args.capability);
    } else if (args.specialization) {
      cards = ctx.a2aRegistry.findAgentsBySpecialization(args.specialization);
    } else {
      return {
        success: false,
        output: 'Please specify either capability or specialization to search for.',
      };
    }

    if (cards.length === 0) {
      return {
        success: true,
        output: `No agents found with ${args.capability ? `capability "${args.capability}"` : `specialization "${args.specialization}"`}.`,
      };
    }

    const lines: string[] = [`Found ${cards.length} agent(s):\n`];

    for (const card of cards) {
      lines.push(`\n- ${card.agentName} (${card.sessionId})`);
      lines.push(`  Status: ${card.status}`);
      lines.push(`  ${card.description}`);
    }

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (error) {
    log.error('Error finding agents:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Send a task request to another agent
 */
export async function sendToAgent(
  ctx: A2AToolContext,
  args: {
    target_session: string;
    task: string;
    context?: Record<string, unknown>;
    priority?: 'low' | 'normal' | 'high';
    timeout?: number;
  }
): Promise<ToolResult> {
  try {
    if (!ctx.a2aRegistry) {
      return {
        success: false,
        output: 'A2A Registry is not available.',
      };
    }

    const targetCard = ctx.a2aRegistry.getCard(args.target_session);

    if (!targetCard) {
      return {
        success: false,
        output: `Target session not found: ${args.target_session}. Use list_agents to see available agents.`,
      };
    }

    // Create and send the request message
    const message = ctx.a2aRegistry.createRequest(
      ctx.sessionId,
      args.target_session,
      args.task,
      args.context,
      args.priority,
      args.timeout
    );

    await ctx.a2aRegistry.sendMessage(message);

    return {
      success: true,
      output: [
        `Task sent to agent: ${targetCard.agentName}`,
        `Request ID: ${message.id}`,
        `Task: ${args.task}`,
        `Priority: ${args.priority || 'normal'}`,
        '',
        'The target agent will process this task and you can check for responses using check_a2a_messages.',
      ].join('\n'),
    };
  } catch (error) {
    log.error('Error sending to agent:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check for incoming A2A messages
 */
export async function checkA2AMessages(ctx: A2AToolContext): Promise<ToolResult> {
  try {
    if (!ctx.a2aRegistry) {
      return {
        success: false,
        output: 'A2A Registry is not available.',
      };
    }

    const messages = ctx.a2aRegistry.getMessages(ctx.sessionId);

    if (messages.length === 0) {
      return {
        success: true,
        output: 'No pending A2A messages.',
      };
    }

    const lines: string[] = [`You have ${messages.length} pending message(s):\n`];

    for (const msg of messages) {
      lines.push(`\n--- Message ${msg.id} ---`);
      lines.push(`From: ${msg.from}`);
      lines.push(`Type: ${msg.type}`);
      lines.push(`Time: ${msg.timestamp}`);

      if (msg.type === 'request') {
        const payload = msg.payload as any;
        lines.push(`Task: ${payload.params.task}`);
        if (payload.params.context) {
          lines.push(`Context: ${JSON.stringify(payload.params.context, null, 2)}`);
        }
        lines.push(`Priority: ${payload.params.priority || 'normal'}`);
      } else if (msg.type === 'response') {
        const payload = msg.payload as any;
        lines.push(`Request ID: ${payload.requestId}`);
        lines.push(`Success: ${payload.success}`);
        if (payload.result) {
          lines.push(`Result: ${payload.result.output}`);
        }
        if (payload.error) {
          lines.push(`Error: ${payload.error.message}`);
        }
      }
    }

    lines.push('\n\nUse respond_to_agent to reply to requests.');

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (error) {
    log.error('Error checking messages:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Respond to an A2A request
 */
export async function respondToAgent(
  ctx: A2AToolContext,
  args: {
    message_id: string;
    success: boolean;
    output: string;
    data?: Record<string, unknown>;
    error_code?: string;
    error_message?: string;
  }
): Promise<ToolResult> {
  try {
    if (!ctx.a2aRegistry) {
      return {
        success: false,
        output: 'A2A Registry is not available.',
      };
    }

    const messages = ctx.a2aRegistry.getMessages(ctx.sessionId);
    const requestMessage = messages.find(msg => msg.id === args.message_id);

    if (!requestMessage) {
      return {
        success: false,
        output: `Message not found: ${args.message_id}`,
      };
    }

    if (requestMessage.type !== 'request') {
      return {
        success: false,
        output: 'Can only respond to request messages.',
      };
    }

    // Create response message
    const response = ctx.a2aRegistry.createResponse(
      ctx.sessionId,
      requestMessage.from,
      requestMessage.id,
      args.success,
      args.success
        ? { output: args.output, data: args.data }
        : undefined,
      !args.success
        ? { code: args.error_code || 'TASK_FAILED', message: args.error_message || args.output }
        : undefined
    );

    await ctx.a2aRegistry.sendMessage(response);

    // Clear the processed message
    ctx.a2aRegistry.clearMessages(ctx.sessionId, [args.message_id]);

    return {
      success: true,
      output: `Response sent to ${requestMessage.from}`,
    };
  } catch (error) {
    log.error('Error responding to agent:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get self agent card
 */
export async function getMyCard(ctx: A2AToolContext): Promise<ToolResult> {
  try {
    if (!ctx.a2aRegistry) {
      return {
        success: false,
        output: 'A2A Registry is not available.',
      };
    }

    const card = ctx.a2aRegistry.getCard(ctx.sessionId);

    if (!card) {
      return {
        success: false,
        output: 'Your agent card is not yet registered.',
      };
    }

    const lines: string[] = [
      `Agent Card for: ${card.agentName}`,
      `Session ID: ${card.sessionId}`,
      `Status: ${card.status}`,
      `Description: ${card.description}`,
      '',
      'Specializations:',
      ...card.specializations.map(s => `  - ${s}`),
      '',
      'Capabilities:',
    ];

    for (const cap of card.capabilities) {
      lines.push(`\n  ${cap.name}:`);
      lines.push(`    ${cap.description}`);
      if (cap.parameters && cap.parameters.length > 0) {
        lines.push('    Parameters:');
        for (const param of cap.parameters) {
          lines.push(`      - ${param.name} (${param.type})${param.required ? ' [required]' : ''}: ${param.description}`);
        }
      }
    }

    lines.push('');
    lines.push(`Available Tools: ${card.availableTools.length}`);
    lines.push(`Last Updated: ${card.lastUpdated}`);

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (error) {
    log.error('Error getting agent card:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
