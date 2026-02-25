import type { ToolDefinition, ToolResult } from '../types.js';
import type { ToolContext } from './context.js';
import { formatSchedule } from './context.js';

export function buildMemoryTools(ctx: ToolContext): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // Memory tools
  if (ctx.config.tools.memory && ctx.vectorMemory && ctx.quickMemory) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'memory_save',
          description: 'Save a memory to long-term vector memory for future retrieval.',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The memory to save.' },
              category: { type: 'string', description: 'Optional category (e.g., "fact", "preference", "task").' },
            },
            required: ['text'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_search',
          description: 'Search long-term memory using semantic similarity.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'What to search for.' },
              limit: { type: 'number', description: 'Max results to return (default 5).' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_update_quick',
          description: 'Update MEMORY.md - the quick-reference memory loaded into every conversation.',
          parameters: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Full new content of MEMORY.md.' },
            },
            required: ['content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_update_tmp',
          description: 'Update TMP_MEMORY.md - short-term context that persists across quick restarts.',
          parameters: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Full new content of TMP_MEMORY.md.' },
            },
            required: ['content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_clear_tmp',
          description: 'Clear TMP_MEMORY.md context once the task is done.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      }
    );
  }

  // Schedule tools
  if (ctx.scheduleCreate && ctx.scheduleUpdate && ctx.scheduleDelete && ctx.scheduleList) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'schedule_create',
          description: 'Create a self-wakeup schedule. repeatCron accepts cron format or "none" for one-time execution. ',
          parameters: {
            type: 'object',
            properties: {
              startAt: { type: 'string', description: 'ISO datetime for first trigger, e.g. 2026-02-22T14:30:00+09:00' },
              repeatCron: { type: 'string', description: 'Cron expression for repeat interval, or "none" for no repeat. ' },
              memo: { type: 'string', description: 'Task memo to send to the AI when triggered.' },
            },
            required: ['startAt', 'repeatCron', 'memo'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'schedule_update',
          description: 'Update an existing schedule. Provide scheduleId and any fields to change.',
          parameters: {
            type: 'object',
            properties: {
              scheduleId: { type: 'string', description: 'Schedule ID to update.' },
              startAt: { type: 'string', description: 'New start datetime (ISO).' },
              repeatCron: { type: 'string', description: 'New cron expression, or "none".' },
              memo: { type: 'string', description: 'New task memo.' },
              enabled: { type: 'boolean', description: 'Enable/disable the schedule.' },
            },
            required: ['scheduleId'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'schedule_delete',
          description: 'Delete an existing schedule.',
          parameters: {
            type: 'object',
            properties: {
              scheduleId: { type: 'string', description: 'Schedule ID to delete.' },
            },
            required: ['scheduleId'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'schedule_list',
          description: 'List all schedules for this session with next trigger timestamps.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      }
    );
  }

  // Utility tools (always available)
  tools.push(
    {
      type: 'function',
      function: {
        name: 'sleep',
        description: 'Wait for a specified number of seconds. Use this when you need to pause before checking something again or to simulate waiting.',
        parameters: {
          type: 'object',
          properties: {
            seconds: { type: 'number', description: 'Number of seconds to sleep.' },
          },
          required: ['seconds'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'clear_history',
        description: 'Delete all conversation history for this session. Use this tool only when the user explicitly requests it or when a task is completed and the context should be reset. IMPORTANT: Before calling this tool, ensure you have saved all important information, facts, or context to MEMORY.md (using memory_update_quick) or long-term memory (using memory_save) to preserve it across history deletion.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    }
  );

  return tools;
}

export async function executeMemoryTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult | null> {
  switch (name) {
    case 'memory_save': {
      if (!ctx.vectorMemory) return { success: false, output: 'Memory tool not available.' };
      const id = await ctx.vectorMemory.add(args.text as string, { category: args.category as string });
      return { success: true, output: `Memory saved with ID: ${id}` };
    }

    case 'memory_search': {
      if (!ctx.vectorMemory) return { success: false, output: 'Memory tool not available.' };
      const results = await ctx.vectorMemory.search(args.query as string, (args.limit as number) ?? 5);
      if (results.length === 0) return { success: true, output: 'No matching memories found.' };
      const formatted = results
        .map((r, i) => `${i + 1}. [${r.score.toFixed(3)}] ${r.entry.text}\n   (${r.entry.metadata.timestamp.slice(0, 10)})`)
        .join('\n\n');
      return { success: true, output: formatted };
    }

    case 'memory_update_quick': {
      if (!ctx.quickMemory) return { success: false, output: 'Memory tool not available.' };
      ctx.quickMemory.write(args.content as string);
      return { success: true, output: 'MEMORY.md updated.' };
    }

    case 'memory_update_tmp': {
      if (!ctx.tmpMemory) return { success: false, output: 'Memory tool not available.' };
      ctx.tmpMemory.write(args.content as string);
      return { success: true, output: 'TMP_MEMORY.md updated.' };
    }

    case 'memory_clear_tmp': {
      if (!ctx.tmpMemory) return { success: false, output: 'Memory tool not available.' };
      ctx.tmpMemory.write('');
      return { success: true, output: 'TMP_MEMORY.md cleared.' };
    }

    case 'schedule_create': {
      if (!ctx.scheduleCreate) return { success: false, output: 'Schedule tool not available.' };
      const schedule = ctx.scheduleCreate({
        startAt: args.startAt as string,
        repeatCron: args.repeatCron as string,
        memo: args.memo as string,
      });
      return { success: true, output: `Schedule created.\n${formatSchedule(schedule)}` };
    }

    case 'schedule_update': {
      if (!ctx.scheduleUpdate) return { success: false, output: 'Schedule tool not available.' };
      const schedule = ctx.scheduleUpdate(args.scheduleId as string, {
        startAt: args.startAt as string | undefined,
        repeatCron: args.repeatCron as string | undefined,
        memo: args.memo as string | undefined,
        enabled: args.enabled as boolean | undefined,
      });
      return { success: true, output: `Schedule updated.\n${formatSchedule(schedule)}` };
    }

    case 'schedule_delete': {
      if (!ctx.scheduleDelete) return { success: false, output: 'Schedule tool not available.' };
      const deleted = ctx.scheduleDelete(args.scheduleId as string);
      if (!deleted) return { success: false, output: 'Schedule not found.' };
      return { success: true, output: `Schedule deleted: ${args.scheduleId as string}` };
    }

    case 'schedule_list': {
      if (!ctx.scheduleList) return { success: false, output: 'Schedule tool not available.' };
      const schedules = ctx.scheduleList();
      if (schedules.length === 0) return { success: true, output: 'No schedules registered.' };
      const output = schedules
        .map((s, i) => `${i + 1}. ${s.memo}\n${formatSchedule(s)}`)
        .join('\n\n');
      return { success: true, output };
    }

    case 'sleep': {
      const seconds = (args.seconds as number) || 1;
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      const now = new Date();
      return { success: true, output: `Sleep completed. Current time: ${now.toLocaleString()}` };
    }

    case 'clear_history': {
      if (!ctx.clearHistory) return { success: false, output: 'Clear history tool not available.' };
      ctx.clearHistory();
      return { success: true, output: 'Conversation history deleted. This will be the last message in the old history.' };
    }

    default:
      return null;
  }
}
