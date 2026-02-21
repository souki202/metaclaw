import type { ToolDefinition, ToolResult, SessionConfig } from '../types.js';
import { execTool } from './exec.js';
import { readFile, writeFile, editFile, listDir, deleteFile } from './fs.js';
import { webFetch, webSearch } from './web.js';
import { selfRead, selfWrite, selfList, selfRestart, readConfigFile } from './self.js';
import type { VectorMemory } from '../memory/vector.js';
import type { QuickMemory } from '../memory/quick.js';

export interface ToolContext {
  sessionId: string;
  config: SessionConfig;
  workspace: string;
  vectorMemory?: VectorMemory;
  quickMemory?: QuickMemory;
  braveApiKey?: string;
}

export function buildTools(ctx: ToolContext): ToolDefinition[] {
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
  }

  // Self-modification tools
  if (config.allowSelfModify) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'self_list',
          description: 'List files in the mini-claw source code directory (src/).',
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
          description: 'Read a source file from mini-claw src/.',
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
          description: 'Write/modify a source file in mini-claw src/. Use self_restart afterward to apply changes.',
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
          name: 'self_restart',
          description: 'Restart mini-claw to apply self-modifications. All sessions will restart.',
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
      }
    );
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
      return webSearch(args.query as string, ctx.braveApiKey);

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

    case 'self_list':
      return selfList(args.subdir as string | undefined);

    case 'self_read':
      return selfRead(args.path as string);

    case 'self_write':
      return selfWrite(args.path as string, args.content as string);

    case 'self_restart':
      return selfRestart(args.reason as string | undefined);

    case 'self_read_config':
      return readConfigFile();

    default:
      return { success: false, output: `Unknown tool: ${name}` };
  }
}
