export interface ContentPartText {
  type: 'text';
  text: string;
}

export interface ContentPartImageUrl {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export type ContentPart = ContentPartText | ContentPartImageUrl;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
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
  image?: string;  // base64 data URL (e.g., "data:image/png;base64,...")
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

export interface SearchConfig {
  provider: 'brave' | 'serper' | 'vertex';
  braveApiKey?: string;
  serperApiKey?: string;
  vertexProjectId?: string;
  vertexLocation?: string;
  vertexDataStoreId?: string;
}

// セッション別Discord設定
export interface SessionDiscordConfig {
  enabled: boolean;
  token?: string;
  channels?: string[];
  guilds?: string[];
  allowFrom?: string[];
  prefix?: string;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
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
  discord?: SessionDiscordConfig;
  context?: {
    compressionThreshold?: number;
    keepRecentMessages?: number;
  };
  mcpServers?: Record<string, McpServerConfig>;
}

export interface Config {
  dashboard: {
    enabled: boolean;
    port: number;
  };
  search?: SearchConfig;
  sessions: Record<string, SessionConfig>;
}

export interface SessionState {
  id: string;
  config: SessionConfig;
  history: ChatMessage[];
  lastActivity: Date;
  heartbeatJob?: NodeJS.Timeout;
}

export interface DashboardEvent {
  type: 'message' | 'tool_call' | 'tool_result' | 'heartbeat' | 'system' | 'memory_update' | 'stream' | 'connected';
  sessionId: string;
  data: unknown;
  timestamp: string;
}
