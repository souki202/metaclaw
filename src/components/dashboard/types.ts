export interface SessionData {
  id: string;
  name: string;
  description?: string;
  model?: string;
}

export interface Skill {
  name: string;
  description: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SystemInfo {
  uptime: number;
  sessions: number;
  nodeVersion: string;
  memory: {
    heapUsed: number;
    rss: number;
  };
  version: string;
}

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface MCPStatus {
  id: string;
  status: 'connected' | 'connecting' | 'error' | 'stopped';
  error?: string;
  toolCount?: number;
}
