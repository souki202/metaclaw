import type { SessionConfig, SearchConfig, ScheduleUpsertInput, SessionSchedule } from '../types.js';
import type { VectorMemory } from '../memory/vector.js';
import type { QuickMemory } from '../memory/quick.js';
import type { McpClientManager } from './mcp-client.js';
import type { A2ARegistry } from '../a2a/registry.js';
import type { ACAManager } from '../aca/manager.js';
import type { SessionCommsManager } from '../a2a/session-comms.js';
import type { SessionManager } from '../core/sessions.js';

export const CURRENT_OS = process.platform === 'win32'
  ? 'Windows'
  : process.platform === 'darwin'
    ? 'macOS'
    : process.platform === 'linux'
      ? 'Linux'
      : process.platform;

export interface ToolContext {
  sessionId: string;
  config: SessionConfig;
  workspace: string;
  sessionDir: string;
  vectorMemory?: VectorMemory;
  quickMemory?: QuickMemory;
  tmpMemory?: QuickMemory;
  searchConfig?: SearchConfig;
  mcpManager?: McpClientManager;
  a2aRegistry?: A2ARegistry;
  acaManager?: ACAManager;
  commsManager?: SessionCommsManager;
  sessionManager?: SessionManager;
  scheduleList?: () => SessionSchedule[];
  scheduleCreate?: (input: ScheduleUpsertInput) => SessionSchedule;
  scheduleUpdate?: (scheduleId: string, patch: Partial<ScheduleUpsertInput>) => SessionSchedule;
  scheduleDelete?: (scheduleId: string) => boolean;
  clearHistory?: () => void;
}

export function formatSchedule(schedule: SessionSchedule): string {
  return [
    `id: ${schedule.id}`,
    `startAt: ${schedule.startAt}`,
    `repeatCron: ${schedule.repeatCron ?? 'none'}`,
    `memo: ${schedule.memo}`,
    `nextRunAt: ${schedule.nextRunAt ?? 'none'}`,
    `enabled: ${schedule.enabled ? 'true' : 'false'}`,
  ].join('\n');
}
