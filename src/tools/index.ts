import type { ToolDefinition, ToolResult, SessionConfig, SearchConfig, ScheduleUpsertInput, SessionSchedule } from '../types.js';
import { execTool } from './exec.js';
import { readFile, writeFile, editFile, listDir, deleteFile } from './fs.js';
import { webFetch, webSearch } from './web.js';
import { selfRead, selfWrite, selfEdit, selfList, selfRestart, readConfigFile, selfReadRoot, selfWriteRoot, selfEditRoot, selfExec } from './self.js';
import { fileSearch, textSearch, selfFileSearch, selfTextSearch } from './search.js';
import { gitStatus, gitDiff, gitDiffStaged, gitLog, gitCommit, gitBranch, gitCheckout, gitStash, gitReset, gitPush, gitPull } from './git.js';
import {
  browserSnapshot, browserNavigate, browserClick, browserType, browserSelect,
  browserScreenshot, browserEvaluate, browserGetContent, browserWaitFor,
  browserScroll, browserPress, browserGetUrl, browserGetSimplifiedHtml,
  browserListPages, browserSwitchPage, browserClosePage, browserClose
} from './browser.js';
import type { VectorMemory } from '../memory/vector.js';
import type { QuickMemory } from '../memory/quick.js';
import type { McpClientManager } from './mcp-client.js';
import type { A2ARegistry } from '../a2a/registry.js';
import { listAgents, findAgents, sendToAgent, checkA2AMessages, respondToAgent, getMyCard } from '../a2a/tools.js';
import type { ACAManager } from '../aca/manager.js';
import { viewCuriosityState, viewObjectives, triggerCuriosityScan, scheduleObjective, completeObjective } from '../aca/tools.js';

const CURRENT_OS = process.platform === 'win32'
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
  vectorMemory?: VectorMemory;
  quickMemory?: QuickMemory;
  tmpMemory?: QuickMemory;
  searchConfig?: SearchConfig;
  mcpManager?: McpClientManager;
  a2aRegistry?: A2ARegistry;
  acaManager?: ACAManager;
  scheduleList?: () => SessionSchedule[];
  scheduleCreate?: (input: ScheduleUpsertInput) => SessionSchedule;
  scheduleUpdate?: (scheduleId: string, patch: Partial<ScheduleUpsertInput>) => SessionSchedule;
  scheduleDelete?: (scheduleId: string) => boolean;
  clearHistory?: () => void;
}

function formatSchedule(schedule: SessionSchedule): string {
  return [
    `id: ${schedule.id}`,
    `startAt: ${schedule.startAt}`,
    `repeatCron: ${schedule.repeatCron ?? 'none'}`,
    `memo: ${schedule.memo}`,
    `nextRunAt: ${schedule.nextRunAt ?? 'none'}`,
    `enabled: ${schedule.enabled ? 'true' : 'false'}`,
  ].join('\n');
}

export async function buildTools(ctx: ToolContext): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  const { config } = ctx;

  // Always available: file system tools
  tools.push(
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file from the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace.' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace.' },
            content: { type: 'string', description: 'Content to write.' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Replace a specific string in a file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace.' },
            old_string: { type: 'string', description: 'String to replace.' },
            new_string: { type: 'string', description: 'Replacement string.' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'List files in a directory within the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path relative to workspace. Defaults to root.' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Delete a file from the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace.' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'file_search',
        description: 'Find files in the workspace by name or path pattern. Pattern examples: "*.ts" (any TS file), "config" (name contains "config"), "src/tools/*.ts" (specific directory), "**/*.json" (recursive). Returns results sorted by most recently modified.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Filename pattern or glob (e.g. "*.ts", "config", "src/**/*.json").' },
            max_results: { type: 'number', description: 'Max files to return (default 60).' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'text_search',
        description: 'Search file contents in the workspace for a query string or regex. Like grep. Returns file paths and matching lines with optional surrounding context.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Text or regex pattern to search for.' },
            pattern: { type: 'string', description: 'Glob to restrict which files are searched (e.g. "*.ts", "src/**/*.ts").' },
            is_regex: { type: 'boolean', description: 'Treat query as a regular expression (default false).' },
            case_sensitive: { type: 'boolean', description: 'Case-sensitive matching (default false).' },
            context_lines: { type: 'number', description: 'Lines of context before/after each match, 0–5 (default 0).' },
            max_matches: { type: 'number', description: 'Maximum matching lines to return (default 50).' },
          },
          required: ['query'],
        },
      },
    }
  );

  // Memory tools
  if (config.tools.memory && ctx.vectorMemory && ctx.quickMemory) {
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

  // A2A (Agent-to-Agent) Communication tools
  if (ctx.a2aRegistry && ctx.config.a2a?.enabled) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'list_agents',
          description: 'List all available agents in the system with their capabilities and specializations.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'find_agents',
          description: 'Find agents with specific capabilities or specializations.',
          parameters: {
            type: 'object',
            properties: {
              capability: { type: 'string', description: 'Capability name to search for (e.g., research_topic, automate_web_task).' },
              specialization: { type: 'string', description: 'Specialization to search for (e.g., web-research, code-execution).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'send_to_agent',
          description: 'Send a task request to another agent. The target agent will process the task and you can check for responses later.',
          parameters: {
            type: 'object',
            properties: {
              target_session: { type: 'string', description: 'Session ID of the target agent.' },
              task: { type: 'string', description: 'Description of the task to delegate to the agent.' },
              context: { type: 'object', description: 'Additional context or data needed for the task.' },
              priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Task priority level.' },
              timeout: { type: 'number', description: 'Timeout in seconds for the task.' },
            },
            required: ['target_session', 'task'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'check_a2a_messages',
          description: 'Check for incoming messages from other agents, including task requests and responses.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'respond_to_agent',
          description: 'Respond to a task request from another agent with results or an error.',
          parameters: {
            type: 'object',
            properties: {
              message_id: { type: 'string', description: 'ID of the message to respond to.' },
              success: { type: 'boolean', description: 'Whether the task was completed successfully.' },
              output: { type: 'string', description: 'Task result or error message.' },
              data: { type: 'object', description: 'Additional data to send back.' },
              error_code: { type: 'string', description: 'Error code if task failed.' },
              error_message: { type: 'string', description: 'Error message if task failed.' },
            },
            required: ['message_id', 'success', 'output'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_my_card',
          description: 'View your own agent card showing your capabilities and status.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      }
    );
  }

  // ACA (Autonomous Curiosity Architecture) tools
  if (ctx.acaManager && ctx.config.aca?.enabled) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'view_curiosity_state',
          description: 'View the current autonomous curiosity state, including knowledge and capability frontiers.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'view_objectives',
          description: 'View generated autonomous objectives, both active and proposed.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'trigger_curiosity_scan',
          description: 'Manually trigger a curiosity scan to detect new frontiers and generate objectives.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'schedule_objective',
          description: 'Schedule a proposed objective for execution.',
          parameters: {
            type: 'object',
            properties: {
              objective_id: { type: 'string', description: 'ID of the objective to schedule.' },
              schedule_at: { type: 'string', description: 'Optional ISO datetime when to execute the objective.' },
            },
            required: ['objective_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'complete_objective',
          description: 'Mark an objective as completed or abandoned, recording results.',
          parameters: {
            type: 'object',
            properties: {
              objective_id: { type: 'string', description: 'ID of the objective being completed.' },
              success: { type: 'boolean', description: 'Whether the objective was successfully completed.' },
              summary: { type: 'string', description: 'Summary of what was accomplished or why it failed.' },
              new_knowledge: { type: 'string', description: 'New knowledge gained (one fact per line).' },
              new_capabilities: { type: 'string', description: 'New capabilities acquired (one skill per line).' },
            },
            required: ['objective_id', 'success', 'summary'],
          },
        },
      }
    );
  }

  // Utility tools
  tools.push({
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
  });

  // History tools
  tools.push({
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
  });

  // Exec tool
  if (config.tools.exec) {
    tools.push({
      type: 'function',
      function: {
        name: 'exec',
        description: `Execute a shell command. Each operation is independent, and operations such as "cd" are not carried over. Current runtime OS: ${CURRENT_OS}.`,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to run.' },
            cwd: { type: 'string', description: 'Working directory (relative to workspace).' },
            timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000).' },
          },
          required: ['command'],
        },
      },
    });
  }

  // Web tools
  if (config.tools.web) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'web_fetch',
          description: 'Fetch content from a URL.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to fetch.' },
            },
            required: ['url'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for information.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query.' },
            },
            required: ['query'],
          },
        },
      }
    );
    
    // Browser automation tools
    // Workflow: browser_navigate (open page) → read snapshot refs → browser_click/type/select
    tools.push(
      {
        type: 'function',
        function: {
          name: 'browser_navigate',
          description: 'Open a URL in a new browser tab. Always call this first before any other browser tool. Returns a page snapshot listing all interactive elements as [1] link "...", [2] button "...", [3] input[text] "..." etc. Use those numbers with browser_click, browser_type, and browser_select.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Full URL to navigate to (must include https://).' },
            },
            required: ['url'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_click',
          description: 'Click an element using its reference number [N] from the snapshot. Re-injects refs automatically so this works even after SPA re-renders. Returns an updated snapshot.',
          parameters: {
            type: 'object',
            properties: {
              ref: { type: 'number', description: 'Reference number of the element to click, e.g. 3 for [3].' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if omitted).' },
            },
            required: ['ref'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_type',
          description: 'Clear an input or textarea and type new text, targeting it by reference number [N] from the snapshot. Returns an updated snapshot.',
          parameters: {
            type: 'object',
            properties: {
              ref: { type: 'number', description: 'Reference number of the input element, e.g. 5 for [5].' },
              text: { type: 'string', description: 'Text to enter (replaces any existing value).' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if omitted).' },
            },
            required: ['ref', 'text'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_select',
          description: 'Choose an option from a <select> dropdown by reference number [N] from the snapshot. Returns an updated snapshot.',
          parameters: {
            type: 'object',
            properties: {
              ref: { type: 'number', description: 'Reference number of the select element.' },
              value: { type: 'string', description: 'Option value attribute or visible label text to select.' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if omitted).' },
            },
            required: ['ref', 'value'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_snapshot',
          description: 'Refresh the page snapshot to get current [N] reference numbers for all visible interactive elements. Call this after page changes or if your refs feel stale. Requires an open page (call browser_navigate first).',
          parameters: {
            type: 'object',
            properties: {
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if omitted).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_press',
          description: 'Press a keyboard key (e.g. Enter, Tab, Escape, ArrowDown). Returns an updated snapshot.',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Key name: Enter, Tab, Escape, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Backspace, Delete, etc.' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if omitted).' },
            },
            required: ['key'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_scroll',
          description: 'Scroll the page to reveal more content. Returns an updated snapshot with newly visible elements.',
          parameters: {
            type: 'object',
            properties: {
              direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Scroll direction.' },
              amount: { type: 'number', description: 'Pixels to scroll for up/down (default 300).' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if omitted).' },
            },
            required: ['direction'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_screenshot',
          description: 'Capture a screenshot as an image. Use only when the text snapshot is insufficient (e.g. charts, images, CAPTCHA, visual layout questions).',
          parameters: {
            type: 'object',
            properties: {
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if omitted).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_evaluate',
          description: 'Run arbitrary JavaScript in the page and return the result. Use for reading data or making programmatic changes not covered by other tools.',
          parameters: {
            type: 'object',
            properties: {
              script: { type: 'string', description: 'JavaScript to execute. May use return statements.' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if omitted).' },
            },
            required: ['script'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_get_content',
          description: 'Extract plain text from the page body or a specific element. Useful for scraping content without the noise of interactive element refs.',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector of the element to extract (optional, uses main content area if omitted).' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if omitted).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_get_simplified_html',
          description: 'Get a simplified version of the page HTML. Retains structural tags but removes all attributes except src (for img) and href (for a). Also removes script, style, svg, canvas, and link tags. Useful for analyzing page structure without noise.',
          parameters: {
            type: 'object',
            properties: {
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if omitted).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_wait_for',
          description: 'Wait until a CSS selector becomes visible on the page, then return a fresh snapshot. Use when content loads asynchronously after an action.',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector to wait for.' },
              timeout: { type: 'number', description: 'Max wait time in milliseconds (default 10000).' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if omitted).' },
            },
            required: ['selector'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_get_url',
          description: 'Get the current URL and page title.',
          parameters: {
            type: 'object',
            properties: {
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if omitted).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_list_pages',
          description: 'List all open browser tabs with their IDs, titles, and URLs.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_switch_page',
          description: 'Switch the active tab to a different open page.',
          parameters: {
            type: 'object',
            properties: {
              page_id: { type: 'string', description: 'Page ID to switch to (from browser_list_pages).' },
            },
            required: ['page_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_close_page',
          description: 'Close a specific page or the current page.',
          parameters: {
            type: 'object',
            properties: {
              page_id: { type: 'string', description: 'Page ID to close (optional, closes current page if not specified).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_close',
          description: 'Close the browser and all pages.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      }
    );
  }

  // Self-modification tools
  if (config.allowSelfModify) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'self_list',
          description: 'List files in the meta-claw source code directory (src/).',
          parameters: {
            type: 'object',
            properties: {
              subdir: { type: 'string', description: 'Subdirectory within src/ to list.' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'self_read',
          description: 'Read a source file from meta-claw src/.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path relative to src/.' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'self_write',
          description: 'Write/modify a source file in meta-claw src/. Use self_restart afterward to apply changes.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path relative to src/.' },
              content: { type: 'string', description: 'New file content.' },
            },
            required: ['path', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'self_edit',
          description: 'Replace a specific string in a source file in meta-claw src/. Use self_restart afterward.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path relative to src/.' },
              old_string: { type: 'string', description: 'String to replace.' },
              new_string: { type: 'string', description: 'Replacement string.' },
            },
            required: ['path', 'old_string', 'new_string'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'self_restart',
          description: 'Restart meta-claw to apply self-modifications. All sessions will restart. NOTE: With Next.js hot reload, this is only needed for changes that cannot be hot-reloaded (npm install, config changes, native module updates). Regular code changes in src/ or app/ are hot-reloaded automatically.',
          parameters: {
            type: 'object',
            properties: {
              reason: { type: 'string', description: 'Reason for restart.' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'self_read_config',
          description: 'Read the system config (API keys are redacted).',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      // Git tools
      {
        type: 'function',
        function: {
          name: 'git_status',
          description: 'Show git working tree status of the AI system\'s own repository (meta-claw).',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_diff',
          description: 'Show unstaged changes in the AI system\'s own repository. Optionally filter by path.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path to diff (optional).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_diff_staged',
          description: 'Show staged (cached) changes in the AI system\'s own repository. Optionally filter by path.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path to diff (optional).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_log',
          description: 'Show recent commit history of the AI system\'s own repository.',
          parameters: {
            type: 'object',
            properties: {
              count: { type: 'number', description: 'Number of commits to show (default 20).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_commit',
          description: 'Stage all changes and commit to the AI system\'s own repository with a message.',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Commit message.' },
            },
            required: ['message'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_branch',
          description: 'List all branches (local and remote) of the AI system\'s own repository.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_checkout',
          description: 'Switch to a branch or restore files in the AI system\'s own repository.',
          parameters: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'Branch name, tag, or commit hash.' },
            },
            required: ['ref'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_stash',
          description: 'Stash changes in the AI system\'s own repository. Actions: push (default), pop, list, drop, apply, show.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Stash action (push, pop, list, drop, apply, show).' },
              message: { type: 'string', description: 'Stash message (only for push action).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_reset',
          description: 'Reset current HEAD of the AI system\'s own repository to a commit. Use for reverting changes.',
          parameters: {
            type: 'object',
            properties: {
              mode: { type: 'string', description: 'Reset mode: soft, mixed (default), or hard.' },
              ref: { type: 'string', description: 'Commit ref to reset to (e.g., HEAD~1).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_push',
          description: 'Push commits from the AI system\'s own repository to remote repository.',
          parameters: {
            type: 'object',
            properties: {
              remote: { type: 'string', description: 'Remote name (default: origin).' },
              branch: { type: 'string', description: 'Branch name.' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_pull',
          description: 'Pull changes for the AI system\'s own repository from remote repository.',
          parameters: {
            type: 'object',
            properties: {
              remote: { type: 'string', description: 'Remote name (default: origin).' },
              branch: { type: 'string', description: 'Branch name.' },
            },
            required: [],
          },
        },
      },
      // Root-level file access tools
      {
        type: 'function',
        function: {
          name: 'self_read_root',
          description: 'Read a file from the project root. Allowed: package.json, tsconfig.json, .gitignore, .env, and files in src/, scripts/, templates/, .agents/.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path relative to project root (e.g., "package.json", "scripts/runner.js").' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'self_write_root',
          description: 'Write a file in the project root. Same access restrictions as self_read_root.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path relative to project root.' },
              content: { type: 'string', description: 'New file content.' },
            },
            required: ['path', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'self_edit_root',
          description: 'Replace a string in a file in the project root. Same access restrictions as self_read_root.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path relative to project root.' },
              old_string: { type: 'string', description: 'String to replace.' },
              new_string: { type: 'string', description: 'Replacement string.' },
            },
            required: ['path', 'old_string', 'new_string'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'self_file_search',
          description: 'Find files in the mini-claw project (src/, scripts/, templates/, root configs) by name or path pattern. Same pattern semantics as file_search. Use for self-modification tasks to locate source files quickly.',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Filename pattern or glob (e.g. "*.ts", "agent", "src/tools/*.ts").' },
              max_results: { type: 'number', description: 'Max files to return (default 60).' },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'self_text_search',
          description: 'Search the mini-claw project source code for a query string or regex. Like grep over the whole codebase. Use for self-modification tasks to find function definitions, usages, or config values.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Text or regex pattern to search for.' },
              pattern: { type: 'string', description: 'Glob to restrict which files are searched (e.g. "*.ts", "src/tools/*.ts").' },
              is_regex: { type: 'boolean', description: 'Treat query as a regular expression (default false).' },
              case_sensitive: { type: 'boolean', description: 'Case-sensitive matching (default false).' },
              context_lines: { type: 'number', description: 'Lines of context before/after each match, 0–5 (default 0).' },
              max_matches: { type: 'number', description: 'Maximum matching lines to return (default 50).' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'self_exec',
          description: `Execute a shell command in the project root directory (e.g., npm install, npx tsc). Current runtime OS: ${CURRENT_OS}.`,
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Shell command to run.' },
              timeout: { type: 'number', description: 'Timeout in ms (default 60000).' },
            },
            required: ['command'],
          },
        },
      }
    );
  }

  // MCP tools
  if (ctx.mcpManager) {
    const mcpTools = await ctx.mcpManager.getAllTools();
    tools.push(...mcpTools);
  }

  return tools;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const { config, workspace } = ctx;
  const restrict = config.restrictToWorkspace;

  switch (name) {
    case 'read_file':
      return readFile(workspace, args.path as string, restrict);

    case 'write_file':
      return writeFile(workspace, args.path as string, args.content as string, restrict);

    case 'edit_file':
      return editFile(workspace, args.path as string, args.old_string as string, args.new_string as string, restrict);

    case 'list_dir':
      return listDir(workspace, (args.path as string) ?? '.', restrict);

    case 'delete_file':
      return deleteFile(workspace, args.path as string, restrict);

    case 'file_search':
      return fileSearch(args.pattern as string, workspace, { maxResults: args.max_results as number | undefined });

    case 'text_search':
      return textSearch(args.query as string, workspace, {
        pattern: args.pattern as string | undefined,
        isRegex: args.is_regex as boolean | undefined,
        caseSensitive: args.case_sensitive as boolean | undefined,
        contextLines: args.context_lines as number | undefined,
        maxMatches: args.max_matches as number | undefined,
      });

    case 'self_file_search':
      return selfFileSearch(args.pattern as string, { maxResults: args.max_results as number | undefined });

    case 'self_text_search':
      return selfTextSearch(args.query as string, {
        pattern: args.pattern as string | undefined,
        isRegex: args.is_regex as boolean | undefined,
        caseSensitive: args.case_sensitive as boolean | undefined,
        contextLines: args.context_lines as number | undefined,
        maxMatches: args.max_matches as number | undefined,
      });

    case 'exec':
      return execTool({
        command: args.command as string,
        cwd: args.cwd as string | undefined,
        timeout: args.timeout as number | undefined,
        workspace,
        restrictToWorkspace: restrict,
      });

    case 'web_fetch':
      return webFetch(args.url as string);

    case 'web_search':
      return webSearch(args.query as string, ctx.searchConfig);

    // Browser automation tools
    case 'browser_snapshot':
      return browserSnapshot(args.page_id as string | undefined);

    case 'browser_navigate':
      return browserNavigate(args.url as string);

    case 'browser_click':
      return browserClick(args.ref as number, args.page_id as string | undefined);

    case 'browser_type':
      return browserType(args.ref as number, args.text as string, args.page_id as string | undefined);

    case 'browser_select':
      return browserSelect(args.ref as number, args.value as string, args.page_id as string | undefined);

    case 'browser_screenshot':
      return browserScreenshot(args.page_id as string | undefined, ctx.sessionId, workspace);

    case 'browser_evaluate':
      return browserEvaluate(args.script as string, args.page_id as string | undefined);

    case 'browser_get_content':
      return browserGetContent(args.selector as string | undefined, args.page_id as string | undefined);

    case 'browser_get_simplified_html':
      return browserGetSimplifiedHtml(args.page_id as string | undefined);

    case 'browser_wait_for':
      return browserWaitFor(args.selector as string, args.timeout as number | undefined, args.page_id as string | undefined);

    case 'browser_scroll':
      return browserScroll(args.direction as 'up' | 'down' | 'top' | 'bottom', args.amount as number | undefined, args.page_id as string | undefined);

    case 'browser_press':
      return browserPress(args.key as string, args.page_id as string | undefined);

    case 'browser_get_url':
      return browserGetUrl(args.page_id as string | undefined);

    case 'browser_list_pages':
      return browserListPages();

    case 'browser_switch_page':
      return browserSwitchPage(args.page_id as string);

    case 'browser_close_page':
      return browserClosePage(args.page_id as string | undefined);

    case 'browser_close':
      return browserClose();

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
      if (schedules.length === 0) {
        return { success: true, output: 'No schedules registered.' };
      }
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

    // A2A tools
    case 'list_agents':
      return listAgents(ctx);

    case 'find_agents':
      return findAgents(ctx, {
        capability: args.capability as string | undefined,
        specialization: args.specialization as string | undefined,
      });

    case 'send_to_agent':
      return sendToAgent(ctx, {
        target_session: args.target_session as string,
        task: args.task as string,
        context: args.context as Record<string, unknown> | undefined,
        priority: args.priority as 'low' | 'normal' | 'high' | undefined,
        timeout: args.timeout as number | undefined,
      });

    case 'check_a2a_messages':
      return checkA2AMessages(ctx);

    case 'respond_to_agent':
      return respondToAgent(ctx, {
        message_id: args.message_id as string,
        success: args.success as boolean,
        output: args.output as string,
        data: args.data as Record<string, unknown> | undefined,
        error_code: args.error_code as string | undefined,
        error_message: args.error_message as string | undefined,
      });

    case 'get_my_card':
      return getMyCard(ctx);

    // ACA tools
    case 'view_curiosity_state':
      return viewCuriosityState(ctx);

    case 'view_objectives':
      return viewObjectives(ctx);

    case 'trigger_curiosity_scan':
      return triggerCuriosityScan(ctx);

    case 'schedule_objective':
      return scheduleObjective(ctx, {
        objective_id: args.objective_id as string,
        schedule_at: args.schedule_at as string | undefined,
      });

    case 'complete_objective':
      return completeObjective(ctx, {
        objective_id: args.objective_id as string,
        success: args.success as boolean,
        summary: args.summary as string,
        new_knowledge: args.new_knowledge as string | undefined,
        new_capabilities: args.new_capabilities as string | undefined,
      });

    case 'self_list':
      return selfList(args.subdir as string | undefined);

    case 'self_read':
      return selfRead(args.path as string);

    case 'self_write':
      return selfWrite(args.path as string, args.content as string);

    case 'self_edit':
      return selfEdit(args.path as string, args.old_string as string, args.new_string as string);

    case 'self_restart':
      return selfRestart(args.reason as string | undefined);

    case 'self_read_config':
      return readConfigFile();

    case 'git_status':
      return gitStatus();

    case 'git_diff':
      return gitDiff(args.path as string | undefined);

    case 'git_diff_staged':
      return gitDiffStaged(args.path as string | undefined);

    case 'git_log':
      return gitLog(args.count as number | undefined);

    case 'git_commit':
      return gitCommit(args.message as string);

    case 'git_branch':
      return gitBranch();

    case 'git_checkout':
      return gitCheckout(args.ref as string);

    case 'git_stash':
      return gitStash(args.action as string | undefined, args.message as string | undefined);

    case 'git_reset':
      return gitReset(args.mode as string | undefined, args.ref as string | undefined);

    case 'git_push':
      return gitPush(args.remote as string | undefined, args.branch as string | undefined);

    case 'git_pull':
      return gitPull(args.remote as string | undefined, args.branch as string | undefined);

    case 'self_read_root':
      return selfReadRoot(args.path as string);

    case 'self_write_root':
      return selfWriteRoot(args.path as string, args.content as string);

    case 'self_edit_root':
      return selfEditRoot(args.path as string, args.old_string as string, args.new_string as string);

    case 'self_exec':
      return selfExec(args.command as string, args.timeout as number | undefined);

    default:
      // Try MCP tools
      if (ctx.mcpManager && name.startsWith('mcp_')) {
        const result = await ctx.mcpManager.routeToolCall(name, args);
        if (result) return result;
      }
      return { success: false, output: `Unknown tool: ${name}` };
  }
}
