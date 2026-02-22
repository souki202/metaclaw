import type { ToolDefinition, ToolResult, SessionConfig, SearchConfig } from '../types.js';
import { execTool } from './exec.js';
import { readFile, writeFile, editFile, listDir, deleteFile } from './fs.js';
import { webFetch, webSearch } from './web.js';
import { selfRead, selfWrite, selfEdit, selfList, selfRestart, readConfigFile, selfReadRoot, selfWriteRoot, selfEditRoot, selfExec } from './self.js';
import { gitStatus, gitDiff, gitDiffStaged, gitLog, gitCommit, gitBranch, gitCheckout, gitStash, gitReset, gitPush, gitPull } from './git.js';
import {
  browserNavigate, browserClick, browserType, browserScreenshot, browserEvaluate,
  browserGetContent, browserWaitFor, browserScroll, browserPress, browserGetUrl,
  browserListPages, browserSwitchPage, browserClosePage, browserClose
} from './browser.js';
import type { VectorMemory } from '../memory/vector.js';
import type { QuickMemory } from '../memory/quick.js';
import type { McpClientManager } from './mcp-client.js';

export interface ToolContext {
  sessionId: string;
  config: SessionConfig;
  workspace: string;
  vectorMemory?: VectorMemory;
  quickMemory?: QuickMemory;
  tmpMemory?: QuickMemory;
  searchConfig?: SearchConfig;
  mcpManager?: McpClientManager;
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

  // Exec tool
  if (config.tools.exec) {
    tools.push({
      type: 'function',
      function: {
        name: 'exec',
        description: 'Execute a shell command.',
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
    tools.push(
      {
        type: 'function',
        function: {
          name: 'browser_navigate',
          description: 'Open a URL in a browser. Creates a new page.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to navigate to.' },
            },
            required: ['url'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_click',
          description: 'Click an element on the page using a CSS selector.',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector for the element to click.' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if not specified).' },
            },
            required: ['selector'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_type',
          description: 'Type text into an input field.',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector for the input field.' },
              text: { type: 'string', description: 'Text to type.' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if not specified).' },
            },
            required: ['selector', 'text'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_screenshot',
          description: 'Take a screenshot of the current page.',
          parameters: {
            type: 'object',
            properties: {
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if not specified).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_evaluate',
          description: 'Execute JavaScript in the browser console.',
          parameters: {
            type: 'object',
            properties: {
              script: { type: 'string', description: 'JavaScript code to execute.' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if not specified).' },
            },
            required: ['script'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_get_content',
          description: 'Get the text content of the page or a specific element.',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector (optional, gets full page if not specified).' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if not specified).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_wait_for',
          description: 'Wait for an element to appear on the page.',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector to wait for.' },
              timeout: { type: 'number', description: 'Timeout in milliseconds (default 10000).' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if not specified).' },
            },
            required: ['selector'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_scroll',
          description: 'Scroll the page in a direction.',
          parameters: {
            type: 'object',
            properties: {
              direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Scroll direction.' },
              amount: { type: 'number', description: 'Pixels to scroll (for up/down, default 300).' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if not specified).' },
            },
            required: ['direction'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_press',
          description: 'Press a keyboard key.',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Key to press (e.g., Enter, Tab, Escape, ArrowDown).' },
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if not specified).' },
            },
            required: ['key'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_get_url',
          description: 'Get the current URL and title of the page.',
          parameters: {
            type: 'object',
            properties: {
              page_id: { type: 'string', description: 'Page ID (optional, uses current page if not specified).' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_list_pages',
          description: 'List all open browser pages.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_switch_page',
          description: 'Switch to a different page.',
          parameters: {
            type: 'object',
            properties: {
              page_id: { type: 'string', description: 'Page ID to switch to.' },
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
          name: 'self_exec',
          description: 'Execute a shell command in the project root directory (e.g., npm install, npx tsc).',
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
    case 'browser_navigate':
      return browserNavigate(args.url as string);

    case 'browser_click':
      return browserClick(args.selector as string, args.page_id as string | undefined);

    case 'browser_type':
      return browserType(args.selector as string, args.text as string, args.page_id as string | undefined);

    case 'browser_screenshot':
      return browserScreenshot(args.page_id as string | undefined, workspace);

    case 'browser_evaluate':
      return browserEvaluate(args.script as string, args.page_id as string | undefined);

    case 'browser_get_content':
      return browserGetContent(args.selector as string | undefined, args.page_id as string | undefined);

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
