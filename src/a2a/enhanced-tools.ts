/**
 * Enhanced A2A Tools for Session Management and Communication
 *
 * New tools for creating sessions, direct messaging, and async task delegation.
 */

import type { ToolDefinition, ToolResult, SessionCreationParams } from '../types.js';
import type { ToolContext } from '../tools/context.js';
import type { SessionCommsManager } from './session-comms.js';
import type { SessionManager } from '../core/sessions.js';
import { createLogger } from '../logger.js';
import fs from 'fs';
import path from 'path';

const log = createLogger('a2a-enhanced-tools');
import { broadcastSseEvent } from '../global-state.js';

export interface EnhancedA2AToolContext extends ToolContext {
  commsManager?: SessionCommsManager;
  sessionManager?: SessionManager;
}

/**
 * Create a new AI session dynamically
 */
export async function createSession(
  ctx: EnhancedA2AToolContext,
  args: SessionCreationParams
): Promise<ToolResult> {
  try {
    if (!ctx.sessionManager) {
      return {
        success: false,
        output: 'Session manager is not available.',
      };
    }

    const config = ctx.sessionManager.getConfig();
    const templates = config.providerTemplates;

    if (!templates || !templates[args.providerTemplate]) {
      return {
        success: false,
        output: `Provider template "${args.providerTemplate}" not found. Available templates: ${templates ? Object.keys(templates).join(', ') : 'none'}`,
      };
    }

    // Check if session ID already exists
    if (config.sessions[args.sessionId]) {
      return {
        success: false,
        output: `Session ID "${args.sessionId}" already exists. Please choose a different ID.`,
      };
    }

    const creatorOrg = ctx.sessionManager.getSessionOrganizationId(ctx.sessionId);
    if (!creatorOrg) {
      return {
        success: false,
        output: `Creator session "${ctx.sessionId}" not found.`,
      };
    }

    if (args.organizationId && args.organizationId !== creatorOrg) {
      return {
        success: false,
        output: `Cross-organization session creation is not allowed. Your organization is "${creatorOrg}".`,
      };
    }

    const template = templates[args.providerTemplate];
    const model = args.model || template.defaultModel;

    // Validate model is in available models
    if (!template.availableModels.includes(model)) {
      return {
        success: false,
        output: `Model "${model}" is not available for provider "${args.providerTemplate}". Available models: ${template.availableModels.join(', ')}`,
      };
    }

    // Create workspace path
    const workspace = args.workspace || `./data/sessions/${args.sessionId}`;

    // Create new session config
    const newSession: any = {
      organizationId: creatorOrg,
      name: args.name,
      description: args.description || `Session created by ${ctx.sessionId}`,
      provider: {
        endpoint: template.endpoint,
        apiKey: template.apiKey,
        model,
        contextWindow: template.contextWindow,
      },
      workspace,
      restrictToWorkspace: args.restrictToWorkspace !== false,
      allowSelfModify: args.allowSelfModify || false,
      tools: {
        exec: args.tools?.exec !== false,
        web: args.tools?.web !== false,
        memory: args.tools?.memory !== false,
      },
      context: {
        memoryCompressionUseSameModel: template.useSessionModelForCompression,
        memoryCompressionEndpoint: template.memoryCompressionEndpoint,
        memoryCompressionApiKey: template.memoryCompressionApiKey,
        memoryCompressionModel: template.memoryCompressionModel,
      },
      a2a: {
        enabled: args.a2aEnabled !== false,
        hiddenFromAgents: args.hiddenFromAgents || false,
      },
    };

    // Create workspace directory
    const wsPath = path.resolve(process.cwd(), workspace);
    if (!fs.existsSync(wsPath)) {
      fs.mkdirSync(wsPath, { recursive: true });
      fs.mkdirSync(path.join(wsPath, 'memory'), { recursive: true });
    }

    // Write custom IDENTITY.md if provided
    if (args.identityContent) {
      fs.writeFileSync(path.join(wsPath, 'IDENTITY.md'), args.identityContent, 'utf-8');
    }

    // Write custom SOUL.md if provided
    if (args.soulContent) {
      fs.writeFileSync(path.join(wsPath, 'SOUL.md'), args.soulContent, 'utf-8');
    }

    // Write custom USER.md if provided
    if (args.userContent) {
      fs.writeFileSync(path.join(wsPath, 'USER.md'), args.userContent, 'utf-8');
    }

    // Write custom MEMORY.md if provided
    if (args.memoryContent) {
      fs.writeFileSync(path.join(wsPath, 'MEMORY.md'), args.memoryContent, 'utf-8');
    }

    // Add to config
    config.sessions[args.sessionId] = newSession;

    // Save updated config
    const configPath = path.resolve(process.cwd(), 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // Start the new session
    const agent = ctx.sessionManager.startSession(args.sessionId, newSession);

    // フロントエンドのセッションリストをリアルタイム更新
    broadcastSseEvent({
      type: 'session_list_update',
      sessionId: args.sessionId,
      data: { action: 'created', id: args.sessionId, name: args.name },
      timestamp: new Date().toISOString(),
    });

    log.info(`New session created: ${args.sessionId} by ${ctx.sessionId}`);

    return {
      success: true,
      output: [
        `Successfully created session: ${args.sessionId}`,
        `Name: ${args.name}`,
        `Provider: ${args.providerTemplate} (${model})`,
        `Workspace: ${workspace}`,
        `A2A enabled: ${newSession.a2a.enabled}`,
        `Hidden from agents: ${newSession.a2a.hiddenFromAgents}`,
        '',
        'The session is now running and ready to use.',
      ].join('\n'),
    };
  } catch (error) {
    log.error('Error creating session:', error);
    return {
      success: false,
      output: `Error creating session: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Send a direct message to another session
 */
export async function sendMessageToSession(
  ctx: EnhancedA2AToolContext,
  args: { target_session: string; message: string; thread_id?: string; }
): Promise<ToolResult> {
  try {
    if (!ctx.commsManager) {
      return {
        success: false,
        output: 'Communications manager is not available.',
      };
    }

    if (!ctx.sessionManager) {
      return {
        success: false,
        output: 'Session manager is not available.',
      };
    }

    // Check if target session exists
    const targetAgent = ctx.sessionManager.getAgent(args.target_session);
    if (!targetAgent) {
      return {
        success: false,
        output: `Target session "${args.target_session}" not found or not running.`,
      };
    }

    if (!ctx.sessionManager.isSameOrganization(ctx.sessionId, args.target_session)) {
      return {
        success: false,
        output: 'Cross-organization communication is not allowed. You can only message sessions in the same organization.',
      };
    }

    const message = ctx.commsManager.sendMessage(
      ctx.sessionId,
      args.target_session,
      args.message,
      args.thread_id
    );

    // Notify the target session about the new message
    targetAgent.processMessage(
      `[MESSAGE from ${ctx.sessionId}]: ${args.message}`,
      'system'
    ).catch(e => log.error(`Error notifying target session:`, e));

    return {
      success: true,
      output: [
        `Message sent to ${args.target_session}`,
        `Message ID: ${message.id}`,
        args.thread_id ? `Thread ID: ${args.thread_id}` : '',
        '',
        'The target session will receive your message.',
        'Note: The target session receives this like a normal user message. If you expect a reply, ensure you explicitly asked them to use send_message_to_session back to you.',
        'Do not continuously poll with read_session_messages. Use the sleep tool to wait for a reply.',
      ].filter(l => l).join('\n'),
    };
  } catch (error) {
    log.error('Error sending message:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Read messages sent to this session
 */
export async function readSessionMessages(
  ctx: EnhancedA2AToolContext,
  args: { thread_id?: string; mark_as_read?: boolean; }
): Promise<ToolResult> {
  try {
    if (!ctx.commsManager) {
      return {
        success: false,
        output: 'Communications manager is not available.',
      };
    }

    const messages = ctx.commsManager.getMessages(ctx.sessionId, args.thread_id);

    if (messages.length === 0) {
      return {
        success: true,
        output: args.thread_id
          ? `No messages in thread: ${args.thread_id}`
          : 'No messages received.',
      };
    }

    const lines: string[] = [`You have ${messages.length} message(s):\n`];

    for (const msg of messages) {
      lines.push(`--- Message ${msg.id} ---`);
      lines.push(`From: ${msg.from}`);
      lines.push(`Time: ${msg.timestamp}`);
      lines.push(`Read: ${msg.read ? 'Yes' : 'No'}`);
      if (msg.threadId) lines.push(`Thread: ${msg.threadId}`);
      lines.push(`Content: ${msg.content}`);
      lines.push('');
    }

    // Mark as read if requested
    if (args.mark_as_read) {
      const unreadIds = messages.filter(m => !m.read).map(m => m.id);
      if (unreadIds.length > 0) {
        ctx.commsManager.markAsRead(ctx.sessionId, unreadIds);
        lines.push(`Marked ${unreadIds.length} message(s) as read.`);
      }
    }

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (error) {
    log.error('Error reading messages:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function postOrganizationGroupChat(
  ctx: EnhancedA2AToolContext,
  args: { message: string; }
): Promise<ToolResult> {
  try {
    if (!ctx.sessionManager) {
      return {
        success: false,
        output: 'Session manager is not available.',
      };
    }

    const organizationId = ctx.sessionManager.getSessionOrganizationId(ctx.sessionId);
    if (!organizationId) {
      return {
        success: false,
        output: 'Your session organization could not be determined.',
      };
    }

    const message = ctx.sessionManager.postOrganizationGroupChatMessage({
      organizationId,
      content: args.message,
      senderType: 'ai',
      senderSessionId: ctx.sessionId,
    });

    broadcastSseEvent({
      type: 'organization_group_chat',
      sessionId: ctx.sessionId,
      data: {
        organizationId,
        message,
      },
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      output: [
        `Posted to organization group chat: ${organizationId}`,
        `Message ID: ${message.id}`,
        message.mentionSessionNames.length > 0
          ? `Mentions: ${message.mentionSessionNames.join(', ')}`
          : 'Mentions: none',
      ].join('\n'),
    };
  } catch (error) {
    log.error('Error posting organization group chat message:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function readOrganizationGroupChat(
  ctx: EnhancedA2AToolContext,
  args: { unread_only?: boolean; mentions_only?: boolean; mark_as_read?: boolean; limit?: number; }
): Promise<ToolResult> {
  try {
    if (!ctx.sessionManager) {
      return {
        success: false,
        output: 'Session manager is not available.',
      };
    }

    const organizationId = ctx.sessionManager.getSessionOrganizationId(ctx.sessionId);
    if (!organizationId) {
      return {
        success: false,
        output: 'Your session organization could not be determined.',
      };
    }

    const result = ctx.sessionManager.getOrganizationGroupChatMessages({
      organizationId,
      viewerSessionId: ctx.sessionId,
      unreadOnly: args.unread_only,
      mentionsOnly: args.mentions_only,
      limit: args.limit,
    });

    const lines: string[] = [
      `Organization: ${organizationId}`,
      `Unread: total=${result.unread.total}, mentions=${result.unread.mentions}`,
      '',
    ];

    if (result.messages.length === 0) {
      lines.push('No messages matched your filters.');
    } else {
      lines.push(`Messages (${result.messages.length}):`);
      for (const msg of result.messages) {
        lines.push(`- [${msg.timestamp}] ${msg.senderName}: ${msg.content}`);
      }
    }

    if (args.mark_as_read) {
      const unread = ctx.sessionManager.markOrganizationGroupChatAsRead({
        organizationId,
        viewerSessionId: ctx.sessionId,
      });
      lines.push('');
      lines.push(`Marked as read. Remaining unread: total=${unread.total}, mentions=${unread.mentions}`);
    }

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (error) {
    log.error('Error reading organization group chat:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function searchOrganizationGroupChat(
  ctx: EnhancedA2AToolContext,
  args: { query: string; mode?: 'semantic' | 'fuzzy' | 'substring'; limit?: number; }
): Promise<ToolResult> {
  try {
    if (!ctx.sessionManager) {
      return {
        success: false,
        output: 'Session manager is not available.',
      };
    }

    const organizationId = ctx.sessionManager.getSessionOrganizationId(ctx.sessionId);
    if (!organizationId) {
      return {
        success: false,
        output: 'Your session organization could not be determined.',
      };
    }

    const mode = args.mode || 'substring';
    const result = await ctx.sessionManager.searchOrganizationGroupChatMessages({
      organizationId,
      query: args.query,
      mode,
      viewerSessionId: ctx.sessionId,
      limit: args.limit,
    });

    if (result.hits.length === 0) {
      return {
        success: true,
        output: `No group chat results found (mode=${mode}).`,
      };
    }

    const lines: string[] = [
      `Organization: ${organizationId}`,
      `Mode: ${result.mode}`,
      `Results: ${result.hits.length}`,
      '',
    ];

    for (const hit of result.hits) {
      lines.push(`- [${hit.score.toFixed(3)}] [${hit.message.timestamp}] ${hit.message.senderName}: ${hit.message.content}`);
    }

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (error) {
    log.error('Error searching organization group chat:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function listOrganizationGroupChatMembers(
  ctx: EnhancedA2AToolContext,
): Promise<ToolResult> {
  try {
    if (!ctx.sessionManager) {
      return {
        success: false,
        output: 'Session manager is not available.',
      };
    }

    const organizationId = ctx.sessionManager.getSessionOrganizationId(ctx.sessionId);
    if (!organizationId) {
      return {
        success: false,
        output: 'Your session organization could not be determined.',
      };
    }

    const members = ctx.sessionManager.getOrganizationSessions(organizationId);
    const unread = ctx.sessionManager.getOrganizationGroupChatUnreadCount(organizationId, ctx.sessionId);

    const lines: string[] = [
      `Organization: ${organizationId}`,
      `Unread: total=${unread.total}, mentions=${unread.mentions}`,
      '',
      'Members:',
      ...members.map((member) => `- ${member.name} (@${member.name}, id=${member.id})`),
    ];

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (error) {
    log.error('Error listing organization group chat members:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Delegate a task asynchronously to another session
 */
export async function delegateTaskAsync(
  ctx: EnhancedA2AToolContext,
  args: {
    target_session: string;
    task: string;
    context?: Record<string, unknown>;
  }
): Promise<ToolResult> {
  try {
    if (!ctx.commsManager) {
      return {
        success: false,
        output: 'Communications manager is not available.',
      };
    }

    if (!ctx.sessionManager) {
      return {
        success: false,
        output: 'Session manager is not available.',
      };
    }

    // Check if target session exists
    const targetAgent = ctx.sessionManager.getAgent(args.target_session);
    if (!targetAgent) {
      return {
        success: false,
        output: `Target session "${args.target_session}" not found or not running.`,
      };
    }

    if (!ctx.sessionManager.isSameOrganization(ctx.sessionId, args.target_session)) {
      return {
        success: false,
        output: 'Cross-organization task delegation is not allowed. You can only delegate to sessions in the same organization.',
      };
    }

    // Create async task
    const task = ctx.commsManager.createTask(
      ctx.sessionId,
      args.target_session,
      args.task,
      args.context
    );

    // Process the task in the background
    setImmediate(async () => {
      try {
        // Update status to processing
        ctx.commsManager!.updateTaskStatus(task.id, 'processing');

        // Send task to target session
        const taskMessage = [
          `[ASYNC TASK ${task.id}]`,
          `From: ${ctx.sessionId}`,
          `Task: ${args.task}`,
          args.context ? `Context: ${JSON.stringify(args.context, null, 2)}` : '',
          '',
          'Please work on this task. When complete, use complete_async_task tool to report results.',
        ].filter(l => l).join('\n');

        await targetAgent.processMessage(taskMessage, 'system');
      } catch (error) {
        log.error(`Error processing async task ${task.id}:`, error);
        ctx.commsManager!.updateTaskStatus(
          task.id,
          'failed',
          undefined,
          error instanceof Error ? error.message : String(error)
        );
      }
    });

    return {
      success: true,
      output: [
        `Async task delegated to ${args.target_session}`,
        `Task ID: ${task.id}`,
        '',
        'The task is processing in the background.',
        'Use check_async_tasks to monitor progress.',
        'IMPORTANT: Do not poll continuously. Use the sleep tool (5-10 seconds) between checks.',
      ].join('\n'),
    };
  } catch (error) {
    log.error('Error delegating task:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check status of async tasks
 */
export async function checkAsyncTasks(
  ctx: EnhancedA2AToolContext,
  args: { task_id?: string; }
): Promise<ToolResult> {
  try {
    if (!ctx.commsManager) {
      return {
        success: false,
        output: 'Communications manager is not available.',
      };
    }

    if (args.task_id) {
      // Get specific task
      const task = ctx.commsManager.getTask(args.task_id);
      if (!task) {
        return {
          success: false,
          output: `Task not found: ${args.task_id}`,
        };
      }

      const lines: string[] = [
        `Task ID: ${task.id}`,
        `From: ${task.fromSession} → To: ${task.toSession}`,
        `Status: ${task.status}`,
        `Task: ${task.task}`,
        `Created: ${task.createdAt}`,
      ];

      if (task.startedAt) lines.push(`Started: ${task.startedAt}`);
      if (task.completedAt) lines.push(`Completed: ${task.completedAt}`);
      if (task.result) lines.push(`Result: ${task.result}`);
      if (task.error) lines.push(`Error: ${task.error}`);

      return {
        success: true,
        output: lines.join('\n'),
      };
    } else {
      // Get all tasks created by this session
      const tasks = ctx.commsManager.getTasksByCreator(ctx.sessionId);

      if (tasks.length === 0) {
        return {
          success: true,
          output: 'No async tasks found.',
        };
      }

      const lines: string[] = [`You have ${tasks.length} async task(s):\n`];

      for (const task of tasks) {
        lines.push(`--- Task ${task.id} ---`);
        lines.push(`To: ${task.toSession}`);
        lines.push(`Status: ${task.status}`);
        lines.push(`Task: ${task.task.substring(0, 100)}${task.task.length > 100 ? '...' : ''}`);
        if (task.result) {
          lines.push(`Result: ${task.result.substring(0, 500)}${task.result.length > 500 ? '...' : ''}`);
        }
        lines.push('');
      }

      return {
        success: true,
        output: lines.join('\n'),
      };
    }
  } catch (error) {
    log.error('Error checking async tasks:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Complete an async task (called by the target session)
 */
export async function completeAsyncTask(
  ctx: EnhancedA2AToolContext,
  args: {
    task_id: string;
    success: boolean;
    result?: string;
    output?: string;
    error?: string;
  }
): Promise<ToolResult> {
  try {
    if (!ctx.commsManager) {
      return {
        success: false,
        output: 'Communications manager is not available.',
      };
    }

    const task = ctx.commsManager.getTask(args.task_id);
    if (!task) {
      return {
        success: false,
        output: `Task not found: ${args.task_id}`,
      };
    }

    // Verify this session is the target
    if (task.toSession !== ctx.sessionId) {
      return {
        success: false,
        output: `This task is not assigned to your session. It's assigned to: ${task.toSession}`,
      };
    }

    // Update task status
    ctx.commsManager.updateTaskStatus(
      args.task_id,
      args.success ? 'completed' : 'failed',
      args.output || args.result,
      args.error
    );

    return {
      success: true,
      output: [
        `Task ${args.task_id} marked as ${args.success ? 'completed' : 'failed'}`,
        (args.output || args.result) ? `Result: ${args.output || args.result}` : '',
        args.error ? `Error: ${args.error}` : '',
      ].filter(l => l).join('\n'),
    };
  } catch (error) {
    log.error('Error completing async task:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * List available provider templates
 */
export async function listProviderTemplates(ctx: EnhancedA2AToolContext): Promise<ToolResult> {
  try {
    if (!ctx.sessionManager) {
      return {
        success: false,
        output: 'Session manager is not available.',
      };
    }

    const config = ctx.sessionManager.getConfig();
    const templates = config.providerTemplates;

    if (!templates || Object.keys(templates).length === 0) {
      return {
        success: true,
        output: 'No provider templates configured.',
      };
    }

    const lines: string[] = ['Available Provider Templates:\n'];

    for (const [id, template] of Object.entries(templates)) {
      lines.push(`### ${id}: ${template.name}`);
      if (template.description) {
        lines.push(`Description: ${template.description}`);
      }
      lines.push(`Endpoint: ${template.endpoint}`);
      lines.push(`Default Model: ${template.defaultModel}`);
      lines.push(`Available Models: ${template.availableModels.join(', ')}`);
      lines.push('');
    }

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (error) {
    log.error('Error listing provider templates:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get recent regular outputs from a session
 */
export async function getSessionOutputs(
  ctx: EnhancedA2AToolContext,
  args: { session_id: string; limit: number; }
): Promise<ToolResult> {
  try {
    if (!ctx.sessionManager) {
      return {
        success: false,
        output: 'Session manager is not available.',
      };
    }

    const agent = ctx.sessionManager.getAgent(args.session_id);
    if (!agent) {
      return {
        success: false,
        output: `Target session "${args.session_id}" not found or not running.`,
      };
    }

    if (!ctx.sessionManager.isSameOrganization(ctx.sessionId, args.session_id)) {
      return {
        success: false,
        output: 'Cross-organization access is not allowed. You can only inspect outputs from sessions in the same organization.',
      };
    }

    const extractContent = (content: any): string => {
      if (!content) return '';
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
      }
      return '';
    };

    const history = agent.getHistory();
    const assistantMessages = history.filter(
      (msg) => {
        if (msg.role !== 'assistant') return false;
        const text = extractContent(msg.content);
        return text.trim() !== '';
      }
    );

    const limit = Math.max(1, Math.min(args.limit || 5, 50));
    const recentMessages = assistantMessages.slice(-limit);

    if (recentMessages.length === 0) {
      return {
        success: true,
        output: `No normal assistant outputs (with text content) found in the history of session "${args.session_id}".`,
      };
    }

    const lines: string[] = [`Recent ${recentMessages.length} outputs for session "${args.session_id}":\n`];
    for (let i = 0; i < recentMessages.length; i++) {
      const msg = recentMessages[i];
      lines.push(`--- Output ${i + 1} ---`);
      lines.push(`Content: ${extractContent(msg.content)}`);
      lines.push('');
    }

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (error) {
    log.error('Error getting session outputs:', error);
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}


export function buildA2AEnhancedTools(ctx: ToolContext): ToolDefinition[] {
  if (!ctx.a2aRegistry || !ctx.config.a2a?.enabled) return [];
  return [
    {
      type: 'function',
      function: {
        name: 'create_session',
        description: 'Create a new AI session dynamically with custom configuration. Requires provider template to be configured.',
        parameters: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Unique ID for the new session (e.g., "researcher", "coder")' },
            organizationId: { type: 'string', description: 'Organization ID (must match your own organization)' },
            name: { type: 'string', description: 'Display name for the session' },
            description: { type: 'string', description: 'Description of the session purpose' },
            providerTemplate: { type: 'string', description: 'Provider template to use (use list_provider_templates to see options)' },
            model: { type: 'string', description: 'Model to use (optional, defaults to template default)' },
            workspace: { type: 'string', description: 'Workspace directory (optional, auto-generated if not provided)' },
            identityContent: { type: 'string', description: 'Custom IDENTITY.md content defining who the agent is' },
            soulContent: { type: 'string', description: 'Custom SOUL.md content for deeper personality' },
            userContent: { type: 'string', description: 'Custom USER.md content with user information' },
            memoryContent: { type: 'string', description: 'Custom MEMORY.md content for core memory' },
            restrictToWorkspace: { type: 'boolean', description: 'Restrict file access to workspace (default: true)' },
            allowSelfModify: { type: 'boolean', description: 'Allow session to modify its own code (default: false)' },
            a2aEnabled: { type: 'boolean', description: 'Enable A2A for this session (default: true)' },
            hiddenFromAgents: { type: 'boolean', description: 'Hide this session from list_agents (default: false)' },
          },
          required: ['sessionId', 'name', 'providerTemplate'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_provider_templates',
        description: 'List available provider templates that can be used to create new sessions.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'send_message_to_session',
        description: 'Send a direct message to another session. This is for conversational communication. The target agent will receive it as a normal user message.',
        parameters: {
          type: 'object',
          properties: {
            target_session: { type: 'string', description: 'The session ID to send the message to' },
            message: { type: 'string', description: 'The message content' },
            thread_id: { type: 'string', description: 'Optional thread ID to group related messages' },
          },
          required: ['target_session', 'message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_session_messages',
        description: 'Read messages sent to this session from other sessions.',
        parameters: {
          type: 'object',
          properties: {
            thread_id: { type: 'string', description: 'Optional: Filter messages by thread ID' },
            mark_as_read: { type: 'boolean', description: 'Mark unread messages as read after viewing (default: false)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'post_organization_group_chat',
        description: 'Post a message to the organization-wide group chat visible to all sessions in your organization. Mention sessions by @SessionName.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Message content for organization group chat. Use @SessionName to mention.' },
          },
          required: ['message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_organization_group_chat',
        description: 'Read organization group chat messages and unread/mention counters for this session.',
        parameters: {
          type: 'object',
          properties: {
            unread_only: { type: 'boolean', description: 'If true, only return unread messages for this session.' },
            mentions_only: { type: 'boolean', description: 'If true, only return messages that mention this session.' },
            mark_as_read: { type: 'boolean', description: 'If true, mark all current messages as read for this session after reading.' },
            limit: { type: 'number', description: 'Maximum number of messages to return (default 200, max 500).' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_organization_group_chat',
        description: 'Search organization group chat messages. Supports semantic vector search and text search modes (fuzzy, substring).',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query text.' },
            mode: { type: 'string', enum: ['semantic', 'fuzzy', 'substring'], description: 'Search mode. semantic uses vector DB. fuzzy and substring use text matching.' },
            limit: { type: 'number', description: 'Maximum number of results (default 20).' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_organization_group_chat_members',
        description: 'List sessions in your organization and current unread counters for group chat. Useful to discover mention targets.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_session_outputs',
        description: 'Get the recent normal assistant outputs from a session. Useful for seeing what the session was thinking or reporting right before it stopped.',
        parameters: {
          type: 'object',
          properties: {
            session_id: { type: 'string', description: 'The session ID to retrieve outputs from' },
            limit: { type: 'number', description: 'Number of recent outputs to retrieve (default: 5, max: 50)' },
          },
          required: ['session_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delegate_task_async',
        description: 'Delegate a task to another session asynchronously. Returns immediately without waiting for completion. Use check_async_tasks to monitor progress.',
        parameters: {
          type: 'object',
          properties: {
            target_session: { type: 'string', description: 'The session ID to delegate the task to' },
            task: { type: 'string', description: 'Description of the task to be performed' },
            context: { type: 'object', description: 'Optional context or parameters for the task' },
          },
          required: ['target_session', 'task'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'check_async_tasks',
        description: 'Check the status of async tasks you have delegated to other sessions.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Optional: Check specific task by ID. If not provided, lists all tasks.' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'complete_async_task',
        description: 'Mark an async task as completed (called by the session executing the task).',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The task ID to complete' },
            success: { type: 'boolean', description: 'Whether the task was completed successfully' },
            output: { type: 'string', description: 'The result or output of the task' },
            result: { type: 'string', description: 'Alias for output (deprecated, use output)' },
            error: { type: 'string', description: 'Error message if task failed' },
          },
          required: ['task_id', 'success'],
        },
      },
    },
  ];
}

export async function executeA2AEnhancedTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult | null> {
  switch (name) {
    case 'create_session':
      return createSession(ctx, args as any);
    case 'list_provider_templates':
      return listProviderTemplates(ctx);
    case 'send_message_to_session':
      return sendMessageToSession(ctx, {
        target_session: args.target_session as string,
        message: args.message as string,
        thread_id: args.thread_id as string | undefined,
      });
    case 'read_session_messages':
      return readSessionMessages(ctx, {
        thread_id: args.thread_id as string | undefined,
        mark_as_read: args.mark_as_read as boolean | undefined,
      });
    case 'post_organization_group_chat':
      return postOrganizationGroupChat(ctx, {
        message: args.message as string,
      });
    case 'read_organization_group_chat':
      return readOrganizationGroupChat(ctx, {
        unread_only: args.unread_only as boolean | undefined,
        mentions_only: args.mentions_only as boolean | undefined,
        mark_as_read: args.mark_as_read as boolean | undefined,
        limit: args.limit as number | undefined,
      });
    case 'search_organization_group_chat':
      return searchOrganizationGroupChat(ctx, {
        query: args.query as string,
        mode: args.mode as 'semantic' | 'fuzzy' | 'substring' | undefined,
        limit: args.limit as number | undefined,
      });
    case 'list_organization_group_chat_members':
      return listOrganizationGroupChatMembers(ctx);
    case 'get_session_outputs':
      return getSessionOutputs(ctx, {
        session_id: args.session_id as string,
        limit: args.limit as number,
      });
    case 'delegate_task_async':
      return delegateTaskAsync(ctx, {
        target_session: args.target_session as string,
        task: args.task as string,
        context: args.context as Record<string, unknown> | undefined,
      });
    case 'check_async_tasks':
      return checkAsyncTasks(ctx, {
        task_id: args.task_id as string | undefined,
      });
    case 'complete_async_task':
      return completeAsyncTask(ctx, {
        task_id: args.task_id as string,
        success: args.success as boolean,
        result: args.result as string | undefined,
        error: args.error as string | undefined,
      });
    default:
      return null;
  }
}
