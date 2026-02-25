/**
 * Session Communications Manager
 *
 * Handles direct messaging and async task delegation between sessions.
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger.js';
import type { SessionMessage, AsyncTask } from '../types.js';

const log = createLogger('session-comms');

export class SessionCommsManager {
  private messages = new Map<string, SessionMessage[]>(); // sessionId -> messages
  private tasks = new Map<string, AsyncTask>(); // taskId -> task
  private tasksBySession = new Map<string, Set<string>>(); // sessionId -> task IDs

  /**
   * Send a direct message from one session to another
   */
  sendMessage(from: string, to: string, content: string, threadId?: string): SessionMessage {
    const message: SessionMessage = {
      id: randomUUID(),
      from,
      to,
      content,
      timestamp: new Date().toISOString(),
      read: false,
      threadId,
    };

    // Add to recipient's message queue
    const messages = this.messages.get(to) || [];
    messages.push(message);
    this.messages.set(to, messages);

    log.info(`Message sent: ${from} -> ${to} (thread: ${threadId || 'none'})`);
    return message;
  }

  /**
   * Get unread messages for a session
   */
  getUnreadMessages(sessionId: string): SessionMessage[] {
    const messages = this.messages.get(sessionId) || [];
    return messages.filter(m => !m.read);
  }

  /**
   * Get all messages for a session (optionally filtered by thread)
   */
  getMessages(sessionId: string, threadId?: string): SessionMessage[] {
    const messages = this.messages.get(sessionId) || [];
    if (threadId) {
      return messages.filter(m => m.threadId === threadId);
    }
    return [...messages];
  }

  /**
   * Mark messages as read
   */
  markAsRead(sessionId: string, messageIds: string[]): void {
    const messages = this.messages.get(sessionId) || [];
    for (const msg of messages) {
      if (messageIds.includes(msg.id)) {
        msg.read = true;
      }
    }
  }

  /**
   * Create an async task delegation
   */
  createTask(fromSession: string, toSession: string, task: string, context?: Record<string, unknown>): AsyncTask {
    const asyncTask: AsyncTask = {
      id: randomUUID(),
      fromSession,
      toSession,
      task,
      context,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.tasks.set(asyncTask.id, asyncTask);

    // Track by session
    if (!this.tasksBySession.has(toSession)) {
      this.tasksBySession.set(toSession, new Set());
    }
    this.tasksBySession.get(toSession)!.add(asyncTask.id);

    log.info(`Async task created: ${asyncTask.id} (${fromSession} -> ${toSession})`);
    return asyncTask;
  }

  /**
   * Get pending tasks for a session
   */
  getPendingTasks(sessionId: string): AsyncTask[] {
    const taskIds = this.tasksBySession.get(sessionId) || new Set();
    const tasks: AsyncTask[] = [];

    for (const taskId of taskIds) {
      const task = this.tasks.get(taskId);
      if (task && task.status === 'pending') {
        tasks.push(task);
      }
    }

    return tasks;
  }

  /**
   * Update task status
   */
  updateTaskStatus(
    taskId: string,
    status: AsyncTask['status'],
    result?: string,
    error?: string
  ): AsyncTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    task.status = status;
    if (status === 'processing' && !task.startedAt) {
      task.startedAt = new Date().toISOString();
    }
    if (status === 'completed' || status === 'failed') {
      task.completedAt = new Date().toISOString();
      if (result) task.result = result;
      if (error) task.error = error;
    }

    log.info(`Task ${taskId} status updated: ${status}`);
    return task;
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): AsyncTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks created by a session
   */
  getTasksByCreator(sessionId: string): AsyncTask[] {
    const tasks: AsyncTask[] = [];
    for (const task of this.tasks.values()) {
      if (task.fromSession === sessionId) {
        tasks.push(task);
      }
    }
    return tasks;
  }

  /**
   * Persist messages to file
   */
  saveMessagesToFile(sessionId: string, workspace: string): void {
    const messages = this.messages.get(sessionId) || [];
    const messagesPath = path.join(workspace, 'session_messages.jsonl');

    try {
      const lines = messages.map(m => JSON.stringify(m)).join('\n');
      fs.writeFileSync(messagesPath, lines, 'utf-8');
    } catch (error) {
      log.error(`Failed to save messages for ${sessionId}:`, error);
    }
  }

  /**
   * Load messages from file
   */
  loadMessagesFromFile(sessionId: string, workspace: string): void {
    const messagesPath = path.join(workspace, 'session_messages.jsonl');

    if (!fs.existsSync(messagesPath)) return;

    try {
      const content = fs.readFileSync(messagesPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      const messages = lines.map(l => JSON.parse(l) as SessionMessage);
      this.messages.set(sessionId, messages);
      log.info(`Loaded ${messages.length} messages for ${sessionId}`);
    } catch (error) {
      log.error(`Failed to load messages for ${sessionId}:`, error);
    }
  }

  /**
   * Clear old completed tasks (older than 24 hours)
   */
  cleanupOldTasks(): number {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 24);
    const cutoffTime = cutoff.toISOString();

    let removed = 0;
    for (const [taskId, task] of this.tasks.entries()) {
      if (
        (task.status === 'completed' || task.status === 'failed') &&
        task.completedAt &&
        task.completedAt < cutoffTime
      ) {
        this.tasks.delete(taskId);
        // Remove from session tracking
        const sessionTasks = this.tasksBySession.get(task.toSession);
        if (sessionTasks) {
          sessionTasks.delete(taskId);
        }
        removed++;
      }
    }

    if (removed > 0) {
      log.info(`Cleaned up ${removed} old tasks`);
    }
    return removed;
  }
}
