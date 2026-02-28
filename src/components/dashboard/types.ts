export interface SessionData {
  id: string;
  organizationId?: string;
  name: string;
  description?: string;
  model?: string;
  isBusy?: boolean;
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
  model?: string;
}

export interface MCPStatus {
  id: string;
  status: 'connected' | 'connecting' | 'error' | 'stopped';
  error?: string;
  toolCount?: number;
}

export interface OrganizationGroupChatMessage {
  id: string;
  organizationId: string;
  senderType: 'ai' | 'human';
  senderSessionId?: string;
  senderName: string;
  content: string;
  mentionSessionIds: string[];
  mentionSessionNames: string[];
  timestamp: string;
}

export interface OrganizationUnread {
  total: number;
  mentions: number;
}
