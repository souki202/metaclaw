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

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: string };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
  imageUrls?: string[];
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
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  type?: 'command' | 'builtin-consult';
  endpointUrl?: string;
  apiKey?: string;
}

export interface MCPStatus {
  id: string;
  status: 'connected' | 'connecting' | 'error' | 'stopped';
  error?: string;
  toolCount?: number;
}
