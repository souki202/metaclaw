/**
 * A2A Registry - Agent discovery and message routing
 *
 * This module manages agent cards, capabilities, and message routing
 * for inter-agent communication.
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../logger.js';
import type {
  AgentCard,
  A2AMessage,
  A2ARegistryEntry,
  A2ARequestPayload,
  A2AResponsePayload,
  PendingRequest,
} from './types.js';

const log = createLogger('a2a-registry');

export class A2ARegistry {
  private registry = new Map<string, A2ARegistryEntry>();
  private messageHandlers = new Map<string, (message: A2AMessage) => Promise<void>>();

  /**
   * Register a session with its agent card
   */
  register(sessionId: string, card: AgentCard): void {
    const existing = this.registry.get(sessionId);

    if (existing) {
      // Update existing entry
      existing.card = card;
      log.info(`Updated agent card for session: ${sessionId}`);
    } else {
      // Create new entry
      this.registry.set(sessionId, {
        sessionId,
        card,
        messageQueue: [],
        pendingRequests: new Map(),
      });
      log.info(`Registered new agent: ${sessionId} (${card.agentName})`);
    }
  }

  /**
   * Unregister a session
   */
  unregister(sessionId: string): void {
    this.registry.delete(sessionId);
    this.messageHandlers.delete(sessionId);
    log.info(`Unregistered agent: ${sessionId}`);
  }

  /**
   * Get agent card for a session
   */
  getCard(sessionId: string): AgentCard | undefined {
    return this.registry.get(sessionId)?.card;
  }

  /**
   * Get all registered agent cards (excluding hidden ones by default)
   */
  getAllCards(includeHidden: boolean = false): AgentCard[] {
    const cards: AgentCard[] = [];
    for (const entry of this.registry.values()) {
      // Skip hidden agents unless explicitly requested
      if (!includeHidden && (entry.card as any).hiddenFromAgents) {
        continue;
      }
      cards.push(entry.card);
    }
    return cards;
  }

  /**
   * Search for agents by capability
   */
  findAgentsByCapability(capabilityName: string): AgentCard[] {
    const cards: AgentCard[] = [];
    for (const entry of this.registry.values()) {
      const hasCapability = entry.card.capabilities.some(
        cap => cap.name === capabilityName
      );
      if (hasCapability) {
        cards.push(entry.card);
      }
    }
    return cards;
  }

  /**
   * Search for agents by specialization
   */
  findAgentsBySpecialization(specialization: string): AgentCard[] {
    const cards: AgentCard[] = [];
    for (const entry of this.registry.values()) {
      if (entry.card.specializations.includes(specialization)) {
        cards.push(entry.card);
      }
    }
    return cards;
  }

  /**
   * Send a message from one agent to another
   */
  async sendMessage(message: A2AMessage): Promise<void> {
    const targetEntry = this.registry.get(message.to);

    if (!targetEntry) {
      throw new Error(`Target session not found: ${message.to}`);
    }

    // Add message to target's queue
    targetEntry.messageQueue.push(message);
    log.info(`Message queued: ${message.from} -> ${message.to} (${message.type})`);

    // If it's a request, track it
    if (message.type === 'request') {
      const payload = message.payload as A2ARequestPayload;
      const pending: PendingRequest = {
        requestId: message.id,
        from: message.from,
        to: message.to,
        startTime: message.timestamp,
        timeout: payload.params.timeout,
        status: 'pending',
      };

      const senderEntry = this.registry.get(message.from);
      if (senderEntry) {
        senderEntry.pendingRequests.set(message.id, pending);
      }
    }

    // If it's a response, mark the request as completed
    if (message.type === 'response') {
      const payload = message.payload as A2AResponsePayload;
      const senderEntry = this.registry.get(message.from);
      if (senderEntry) {
        const pending = senderEntry.pendingRequests.get(payload.requestId);
        if (pending) {
          pending.status = payload.success ? 'completed' : 'failed';
        }
      }
    }

    // Notify the handler if registered
    const handler = this.messageHandlers.get(message.to);
    if (handler) {
      try {
        await handler(message);
      } catch (error) {
        log.error(`Error in message handler for ${message.to}:`, error);
      }
    }
  }

  /**
   * Get queued messages for a session
   */
  getMessages(sessionId: string): A2AMessage[] {
    const entry = this.registry.get(sessionId);
    return entry ? [...entry.messageQueue] : [];
  }

  /**
   * Clear processed messages from queue
   */
  clearMessages(sessionId: string, messageIds: string[]): void {
    const entry = this.registry.get(sessionId);
    if (entry) {
      entry.messageQueue = entry.messageQueue.filter(
        msg => !messageIds.includes(msg.id)
      );
    }
  }

  /**
   * Register a message handler for a session
   */
  registerHandler(sessionId: string, handler: (message: A2AMessage) => Promise<void>): void {
    this.messageHandlers.set(sessionId, handler);
  }

  /**
   * Get pending requests for a session
   */
  getPendingRequests(sessionId: string): PendingRequest[] {
    const entry = this.registry.get(sessionId);
    return entry ? Array.from(entry.pendingRequests.values()) : [];
  }

  /**
   * Create a new A2A request message
   */
  createRequest(
    from: string,
    to: string,
    task: string,
    context?: Record<string, unknown>,
    priority?: 'low' | 'normal' | 'high',
    timeout?: number
  ): A2AMessage {
    return {
      id: randomUUID(),
      from,
      to,
      type: 'request',
      timestamp: new Date().toISOString(),
      payload: {
        method: 'execute_task',
        params: {
          task,
          context,
          priority: priority || 'normal',
          timeout,
        },
      },
    };
  }

  /**
   * Create a response message
   */
  createResponse(
    from: string,
    to: string,
    requestId: string,
    success: boolean,
    result?: { output: string; data?: Record<string, unknown>; artifacts?: string[] },
    error?: { code: string; message: string; details?: unknown }
  ): A2AMessage {
    return {
      id: randomUUID(),
      from,
      to,
      type: 'response',
      timestamp: new Date().toISOString(),
      payload: {
        requestId,
        success,
        result,
        error,
      },
    };
  }

  /**
   * Update agent status
   */
  updateStatus(sessionId: string, status: 'active' | 'idle' | 'busy'): void {
    const entry = this.registry.get(sessionId);
    if (entry) {
      entry.card.status = status;
      entry.card.lastUpdated = new Date().toISOString();
    }
  }
}
