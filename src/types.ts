export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

export interface ToolResult {
  success: boolean;
  output: string;
}

export interface MemoryEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    timestamp: string;
    category?: string;
    source?: string;
    sessionId?: string;
  };
}

export interface ProviderConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  embeddingModel?: string;
  contextWindow?: number;
}

export interface SessionConfig {
  name: string;
  description?: string;
  provider: ProviderConfig;
  workspace: string;
  restrictToWorkspace: boolean;
  allowSelfModify: boolean;
  tools: {
    exec: boolean;
    web: boolean;
    memory: boolean;
  };
  heartbeat: {
    enabled: boolean;
    interval: string;
    activeHours?: { start: number; end: number };
  };
  discord?: {
    channels?: string[];
    guilds?: string[];
    allowFrom?: string[];
  };
  context?: {
    compressionThreshold?: number;
    keepRecentMessages?: number;
  };
}

export interface Config {
  dashboard: {
    enabled: boolean;
    port: number;
  };
  sessions: Record<string, SessionConfig>;
  discord?: {
    token: string;
  };
}

export interface SessionState {
  id: string;
  config: SessionConfig;
  history: ChatMessage[];
  lastActivity: Date;
  heartbeatJob?: NodeJS.Timeout;
}

export interface DashboardEvent {
  type: 'message' | 'tool_call' | 'tool_result' | 'heartbeat' | 'system' | 'memory_update';
  sessionId: string;
  data: unknown;
  timestamp: string;
}
