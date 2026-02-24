/**
 * Agent-to-Agent (A2A) Protocol Types
 *
 * This module defines the types for inter-agent communication following
 * a JSON-RPC style protocol with zero-trust boundaries.
 */

/**
 * Agent capability definition for discovery
 */
export interface AgentCapability {
  name: string;
  description: string;
  parameters?: {
    name: string;
    type: string;
    description: string;
    required: boolean;
  }[];
  examples?: string[];
}

/**
 * Agent Card - Published capabilities of an agent session
 */
export interface AgentCard {
  sessionId: string;
  agentName: string;
  description: string;
  capabilities: AgentCapability[];
  specializations: string[];
  availableTools: string[];
  status: 'active' | 'idle' | 'busy';
  lastUpdated: string;
  hiddenFromAgents?: boolean; // If true, won't appear in list_agents
}

/**
 * A2A Message - JSON-RPC style message between agents
 */
export interface A2AMessage {
  id: string;
  from: string;
  to: string;
  type: 'request' | 'response' | 'notification';
  timestamp: string;
  payload: A2APayload;
}

/**
 * A2A Payload types
 */
export type A2APayload =
  | A2ARequestPayload
  | A2AResponsePayload
  | A2ANotificationPayload;

/**
 * Request payload for delegating tasks to another agent
 */
export interface A2ARequestPayload {
  method: string;
  params: {
    task: string;
    context?: Record<string, unknown>;
    priority?: 'low' | 'normal' | 'high';
    timeout?: number;
  };
}

/**
 * Response payload for task results
 */
export interface A2AResponsePayload {
  requestId: string;
  success: boolean;
  result?: {
    output: string;
    data?: Record<string, unknown>;
    artifacts?: string[];
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Notification payload for status updates
 */
export interface A2ANotificationPayload {
  event: 'status_change' | 'capability_update' | 'task_progress';
  data: unknown;
}

/**
 * A2A Registry entry
 */
export interface A2ARegistryEntry {
  sessionId: string;
  card: AgentCard;
  messageQueue: A2AMessage[];
  pendingRequests: Map<string, PendingRequest>;
}

/**
 * Pending request tracking
 */
export interface PendingRequest {
  requestId: string;
  from: string;
  to: string;
  startTime: string;
  timeout?: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}
