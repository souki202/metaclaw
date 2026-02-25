/**
 * Enhanced A2A Tools for Session Management and Communication
 *
 * New tools for creating sessions, direct messaging, and async task delegation.
 */

import type { ToolResult, SessionCreationParams } from '../types.js';
import type { ToolContext } from '../tools/index.js';
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
      name: args.name,
      description: args.description || `Session created by ${ctx.sessionId}`,
      provider: {
        endpoint: template.endpoint,
        apiKey: template.apiKey,
        model,
        embeddingModel: template.embeddingModel,
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
  args: { target_session: string; message: string; thread_id?: string }
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
  args: { thread_id?: string; mark_as_read?: boolean }
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
        'The task is processing in the background. Use check_async_tasks to monitor progress.',
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
  args: { task_id?: string }
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
          lines.push(`Result: ${task.result.substring(0, 100)}${task.result.length > 100 ? '...' : ''}`);
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
      args.result,
      args.error
    );

    return {
      success: true,
      output: [
        `Task ${args.task_id} marked as ${args.success ? 'completed' : 'failed'}`,
        args.result ? `Result: ${args.result}` : '',
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
      if (template.embeddingModel) {
        lines.push(`Embedding Model: ${template.embeddingModel}`);
      }
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
