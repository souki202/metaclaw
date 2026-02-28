/**
 * A2A (Agent-to-Agent) Communication Tools
 *
 * Tools for inter-agent communication and collaboration.
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import type { ToolContext } from '../tools/context.js';
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
    const currentOrg = ctx.sessionManager?.getSessionOrganizationId(ctx.sessionId) ?? null;

    if (cards.length === 0) {
      return {
        success: true,
        output: 'No other agents are currently registered.',
      };
    }

    const lines: string[] = ['Available Agents:\n'];

    for (const card of cards) {
      if (card.sessionId === ctx.sessionId) continue; // Skip self

      if (currentOrg) {
        const targetOrg = ctx.sessionManager?.getSessionOrganizationId(card.sessionId);
        if (!targetOrg || targetOrg !== currentOrg) continue;
      }

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

    const currentOrg = ctx.sessionManager?.getSessionOrganizationId(ctx.sessionId) ?? null;
    if (currentOrg) {
      cards = cards.filter((card) => {
        const targetOrg = ctx.sessionManager?.getSessionOrganizationId(card.sessionId);
        return !!targetOrg && targetOrg === currentOrg;
      });
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

    if (ctx.sessionManager && !ctx.sessionManager.isSameOrganization(ctx.sessionId, args.target_session)) {
      return {
        success: false,
        output: 'Cross-organization communication is not allowed. You can only send tasks to sessions in the same organization.',
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
        'The target agent will process this task in the background.',
        'You can check for responses using check_a2a_messages.',
        'IMPORTANT: Do not poll continuously. Use the sleep tool to wait (e.g., 5-10 seconds) before checking again, or work on other tasks.',
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
    lines.push('If waiting for responses, use the sleep tool to avoid busy polling limits.');

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

export function buildA2ATools(ctx: ToolContext): ToolDefinition[] {
  if (!ctx.a2aRegistry || !ctx.config.a2a?.enabled) return [];
  return [
    {
      type: 'function',
      function: {
        name: 'list_agents',
        description: 'List all available agents in the system with their capabilities and specializations.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'find_agents',
        description: 'Find agents with specific capabilities or specializations.',
        parameters: {
          type: 'object',
          properties: {
            capability: { type: 'string', description: 'Capability name to search for (e.g., research_topic, automate_web_task).' },
            specialization: { type: 'string', description: 'Specialization to search for (e.g., web-research, code-execution).' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'send_to_agent',
        description: 'Send a task request to another agent. The target agent will process the task and you can check for responses later.',
        parameters: {
          type: 'object',
          properties: {
            target_session: { type: 'string', description: 'Session ID of the target agent.' },
            task: { type: 'string', description: 'Description of the task to delegate to the agent.' },
            context: { type: 'object', description: 'Additional context or data needed for the task.' },
            priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Task priority level.' },
            timeout: { type: 'number', description: 'Timeout in seconds for the task.' },
          },
          required: ['target_session', 'task'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'check_a2a_messages',
        description: 'Check for incoming messages from other agents, including task requests and responses.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'respond_to_agent',
        description: 'Respond to a task request from another agent with results or an error.',
        parameters: {
          type: 'object',
          properties: {
            message_id: { type: 'string', description: 'ID of the message to respond to.' },
            success: { type: 'boolean', description: 'Whether the task was completed successfully.' },
            output: { type: 'string', description: 'Task result or error message.' },
            data: { type: 'object', description: 'Additional data to send back.' },
            error_code: { type: 'string', description: 'Error code if task failed.' },
            error_message: { type: 'string', description: 'Error message if task failed.' },
          },
          required: ['message_id', 'success', 'output'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_my_card',
        description: 'View your own agent card showing your capabilities and status.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
  ];
}

export async function executeA2ATool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult | null> {
  switch (name) {
    case 'list_agents':
      return listAgents(ctx);
    case 'find_agents':
      return findAgents(ctx, {
        capability: args.capability as string | undefined,
        specialization: args.specialization as string | undefined,
      });
    case 'send_to_agent':
      return sendToAgent(ctx, {
        target_session: args.target_session as string,
        task: args.task as string,
        context: args.context as Record<string, unknown> | undefined,
        priority: args.priority as 'low' | 'normal' | 'high' | undefined,
        timeout: args.timeout as number | undefined,
      });
    case 'check_a2a_messages':
      return checkA2AMessages(ctx);
    case 'respond_to_agent':
      return respondToAgent(ctx, {
        message_id: args.message_id as string,
        success: args.success as boolean,
        output: args.output as string,
        data: args.data as Record<string, unknown> | undefined,
        error_code: args.error_code as string | undefined,
        error_message: args.error_message as string | undefined,
      });
    case 'get_my_card':
      return getMyCard(ctx);
    default:
      return null;
  }
}
