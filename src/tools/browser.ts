/**
 * browser.ts — Unified browser tool backed by agent-browser CLI.
 * https://github.com/vercel-labs/agent-browser
 *
 * All browser automation is delegated to `npx agent-browser` as a subprocess,
 * which manages a persistent Chromium daemon internally.
 *
 * Single entry-point tool: `browser` with a `type` discriminator.
 * Pattern mirrors `self_git` — one unified tool, multiple actions.
 */

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';
import type { ToolContext } from './context.js';

const ROOT = process.cwd();
const BROWSER_TIMEOUT = 35_000; // slightly above agent-browser's default 25s action timeout

// ---------------------------------------------------------------------------
// Core executor
// ---------------------------------------------------------------------------

/**
 * Run `npx agent-browser --json <args...>` and return a ToolResult.
 * --json makes output machine-readable: { success, data, error }.
 */
function agentBrowserExec(args: string[], timeout = BROWSER_TIMEOUT): Promise<ToolResult> {
  // On Windows npx requires shell:true to resolve .cmd shims
  const useShell = process.platform === 'win32';

  return new Promise((resolve) => {
    execFile(
      'npx',
      ['--yes', 'agent-browser', '--json', ...args],
      {
        cwd: ROOT,
        timeout,
        maxBuffer: 1024 * 1024 * 10,
        env: { ...process.env },
        shell: useShell,
      },
      (err, stdout, stderr) => {
        const raw = (stdout || stderr || '').trim();

        // agent-browser --json returns { success, data } or { success, error }
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed === 'object' && parsed !== null && 'success' in parsed) {
            if (!parsed.success) {
              const msg = parsed.error ?? parsed.data ?? raw;
              return resolve({ success: false, output: typeof msg === 'string' ? msg : JSON.stringify(msg) });
            }
            const data = parsed.data;
            const text =
              data == null
                ? '(done)'
                : typeof data === 'string'
                ? data
                : JSON.stringify(data, null, 2);
            return resolve({ success: true, output: text });
          }
        } catch {
          // Not JSON — fall through to plain text handling
        }

        if (err) {
          resolve({ success: false, output: raw || err.message });
        } else {
          resolve({ success: true, output: raw || '(done)' });
        }
      },
    );
  });
}

/**
 * Variant without --json, used for screenshot (returns plain text path).
 */
function agentBrowserRaw(
  args: string[],
  timeout = BROWSER_TIMEOUT,
): Promise<{ exitCode: number; output: string }> {
  const useShell = process.platform === 'win32';
  return new Promise((resolve) => {
    execFile(
      'npx',
      ['--yes', 'agent-browser', ...args],
      { cwd: ROOT, timeout, maxBuffer: 1024 * 1024 * 10, env: { ...process.env }, shell: useShell },
      (err, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        resolve({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, output });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Ref helper
// ---------------------------------------------------------------------------

/**
 * Normalise element refs to agent-browser's @eN format.
 *   number 3     → "@e3"
 *   string "@e3" → "@e3"
 *   string  "e3" → "@e3"
 *   CSS selector  → returned as-is
 */
function toRef(ref: string | number): string {
  if (typeof ref === 'number') return `@e${ref}`;
  if (ref.startsWith('@')) return ref;
  if (/^e\d+$/.test(ref)) return `@${ref}`;
  return ref;
}

// ---------------------------------------------------------------------------
// Unified command dispatcher
// ---------------------------------------------------------------------------

export async function browserCommand(
  type: string,
  params: Record<string, unknown>,
  sessionInfo?: { sessionId?: string; sessionDir?: string },
): Promise<ToolResult> {
  switch (type) {
    // ── Navigation ──────────────────────────────────────────────────────────
    case 'open':
    case 'navigate':
    case 'goto': {
      const url = params.url as string;
      if (!url) return { success: false, output: 'url is required.' };
      return agentBrowserExec(['open', url]);
    }

    case 'back':
      return agentBrowserExec(['back']);
    case 'forward':
      return agentBrowserExec(['forward']);
    case 'reload':
      return agentBrowserExec(['reload']);
    case 'close':
      return agentBrowserExec(['close']);

    // ── Snapshot ─────────────────────────────────────────────────────────────
    case 'snapshot': {
      const args = ['snapshot'];
      // Default to interactive-only (-i) unless explicitly disabled
      if (params.interactive !== false) args.push('-i');
      if (params.compact) args.push('-c');
      if (params.depth != null) args.push('-d', String(params.depth));
      if (params.selector) args.push('-s', params.selector as string);
      return agentBrowserExec(args);
    }

    // ── Element interactions ─────────────────────────────────────────────────
    case 'click': {
      const r = params.ref ?? params.selector;
      if (r == null) return { success: false, output: 'ref or selector is required.' };
      return agentBrowserExec(['click', toRef(r as string | number)]);
    }
    case 'dblclick': {
      const r = params.ref ?? params.selector;
      if (r == null) return { success: false, output: 'ref or selector is required.' };
      return agentBrowserExec(['dblclick', toRef(r as string | number)]);
    }
    case 'hover': {
      const r = params.ref ?? params.selector;
      if (r == null) return { success: false, output: 'ref or selector is required.' };
      return agentBrowserExec(['hover', toRef(r as string | number)]);
    }
    case 'focus': {
      const r = params.ref ?? params.selector;
      if (r == null) return { success: false, output: 'ref or selector is required.' };
      return agentBrowserExec(['focus', toRef(r as string | number)]);
    }

    // fill = clear + fill (preferred); type = type into element or at current focus
    case 'fill': {
      const r = params.ref ?? params.selector;
      const text = params.text as string;
      if (r == null || text == null) return { success: false, output: 'ref and text are required.' };
      return agentBrowserExec(['fill', toRef(r as string | number), text]);
    }
    case 'type': {
      const r = params.ref ?? params.selector;
      const text = params.text as string;
      if (text == null) return { success: false, output: 'text is required.' };
      if (r != null) {
        // type into a specific element
        return agentBrowserExec(['type', toRef(r as string | number), text]);
      }
      // keyboard type at current focus (no selector)
      return agentBrowserExec(['keyboard', 'type', text]);
    }

    case 'select': {
      const r = params.ref ?? params.selector;
      const value = params.value as string;
      if (r == null || !value) return { success: false, output: 'ref and value are required.' };
      return agentBrowserExec(['select', toRef(r as string | number), value]);
    }
    case 'check': {
      const r = params.ref ?? params.selector;
      if (r == null) return { success: false, output: 'ref or selector is required.' };
      return agentBrowserExec(['check', toRef(r as string | number)]);
    }
    case 'uncheck': {
      const r = params.ref ?? params.selector;
      if (r == null) return { success: false, output: 'ref or selector is required.' };
      return agentBrowserExec(['uncheck', toRef(r as string | number)]);
    }

    // ── Keyboard ─────────────────────────────────────────────────────────────
    case 'press':
    case 'key': {
      const key = params.key as string;
      if (!key) return { success: false, output: 'key is required.' };
      return agentBrowserExec(['press', key]);
    }

    // ── Scroll ───────────────────────────────────────────────────────────────
    case 'scroll': {
      const dir = (params.direction as string) ?? 'down';
      const args = ['scroll', dir];
      if (params.amount != null) args.push(String(params.amount));
      if (params.selector) args.push('--selector', params.selector as string);
      return agentBrowserExec(args);
    }
    case 'scrollintoview': {
      const r = params.ref ?? params.selector;
      if (r == null) return { success: false, output: 'ref or selector is required.' };
      return agentBrowserExec(['scrollintoview', toRef(r as string | number)]);
    }

    // ── Screenshot ───────────────────────────────────────────────────────────
    case 'screenshot': {
      const tmpPath = path.join(os.tmpdir(), `ab_shot_${Date.now()}.png`);
      const rawArgs = ['screenshot'];
      if (params.annotate) rawArgs.push('--annotate');
      if (params.full) rawArgs.push('--full');
      rawArgs.push(tmpPath);

      const { exitCode, output } = await agentBrowserRaw(rawArgs);
      if (exitCode !== 0 || !fs.existsSync(tmpPath)) {
        return { success: false, output: output || 'Screenshot failed.' };
      }

      try {
        const buf = fs.readFileSync(tmpPath);
        const base64 = buf.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;

        let imageUrl: string | undefined;
        if (sessionInfo?.sessionDir && sessionInfo?.sessionId) {
          const dir = path.join(sessionInfo.sessionDir, 'screenshots');
          fs.mkdirSync(dir, { recursive: true });
          const filename = `screenshot_${Date.now()}.png`;
          fs.copyFileSync(tmpPath, path.join(dir, filename));
          imageUrl = `/api/sessions/${sessionInfo.sessionId}/images/${filename}`;
        }

        try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup error */ }
        return { success: true, output: output || 'Screenshot captured.', image: dataUrl, imageUrl };
      } catch (e: unknown) {
        return { success: false, output: `Failed to read screenshot: ${(e as Error).message}` };
      }
    }

    // ── Evaluate (JavaScript) ─────────────────────────────────────────────────
    case 'evaluate':
    case 'eval': {
      const script = params.script as string;
      if (!script) return { success: false, output: 'script is required.' };
      return agentBrowserExec(['eval', script]);
    }

    // ── Get info ──────────────────────────────────────────────────────────────
    case 'get': {
      const what = params.what as string;
      if (!what) {
        return { success: false, output: 'what is required (text, html, value, title, url, count, box, attr, styles).' };
      }
      const args = ['get', what];
      const r = params.ref ?? params.selector;
      if (r != null) args.push(toRef(r as string | number));
      if (what === 'attr' && params.attr) args.push(params.attr as string);
      return agentBrowserExec(args);
    }
    case 'get_url':
      return agentBrowserExec(['get', 'url']);
    case 'get_title':
      return agentBrowserExec(['get', 'title']);
    case 'get_text': {
      const r = params.ref ?? params.selector;
      return agentBrowserExec(r != null ? ['get', 'text', toRef(r as string | number)] : ['get', 'text', 'body']);
    }
    case 'get_html': {
      const r = params.ref ?? params.selector;
      return agentBrowserExec(r != null ? ['get', 'html', toRef(r as string | number)] : ['get', 'html', 'body']);
    }
    case 'get_content':
      return agentBrowserExec(['get', 'text', 'body']);

    // ── Wait ──────────────────────────────────────────────────────────────────
    case 'wait': {
      if (params.ms != null) return agentBrowserExec(['wait', String(params.ms)]);
      if (params.text) return agentBrowserExec(['wait', '--text', params.text as string]);
      if (params.url) return agentBrowserExec(['wait', '--url', params.url as string]);
      if (params.load) return agentBrowserExec(['wait', '--load', params.load as string]);
      if (params.fn) return agentBrowserExec(['wait', '--fn', params.fn as string]);
      const r = params.ref ?? params.selector;
      if (r != null) return agentBrowserExec(['wait', toRef(r as string | number)]);
      return { success: false, output: 'Specify ms, text, url, load, fn, or ref/selector for wait.' };
    }
    // Legacy alias
    case 'wait_for': {
      const r = params.ref ?? params.selector;
      if (r == null) return { success: false, output: 'ref or selector is required for wait_for.' };
      const args = ['wait', toRef(r as string | number)];
      if (params.timeout != null) args.push('--timeout', String(params.timeout));
      return agentBrowserExec(args);
    }

    // ── Check state ───────────────────────────────────────────────────────────
    case 'is': {
      const state = params.state as string;
      const r = params.ref ?? params.selector;
      if (!state || r == null) return { success: false, output: 'state and ref/selector are required.' };
      return agentBrowserExec(['is', state, toRef(r as string | number)]);
    }

    // ── Find (semantic locators) ───────────────────────────────────────────────
    case 'find': {
      const by = params.by as string;
      const query = params.query as string;
      const action = params.action as string;
      if (!by || !query || !action) return { success: false, output: 'by, query, and action are required.' };
      // Support: find nth N <sel> <action>
      const args: string[] = ['find'];
      if (by === 'nth' && params.n != null) {
        args.push('nth', String(params.n), query, action);
      } else {
        args.push(by, query, action);
      }
      if (params.name) args.push('--name', params.name as string);
      if (params.exact) args.push('--exact');
      if (params.value) args.push(params.value as string);
      return agentBrowserExec(args);
    }

    // ── Tabs ──────────────────────────────────────────────────────────────────
    case 'tab':
    case 'tab_list':
      return agentBrowserExec(['tab']);
    case 'tab_new': {
      const url = params.url as string | undefined;
      return agentBrowserExec(url ? ['tab', 'new', url] : ['tab', 'new']);
    }
    case 'tab_switch': {
      const n = params.n ?? params.tab;
      if (n == null) return { success: false, output: 'n is required for tab_switch.' };
      return agentBrowserExec(['tab', String(n)]);
    }
    case 'tab_close': {
      const n = params.n ?? params.tab;
      return agentBrowserExec(n != null ? ['tab', 'close', String(n)] : ['tab', 'close']);
    }

    // ── Frames ────────────────────────────────────────────────────────────────
    case 'frame': {
      const r = (params.ref ?? params.selector ?? 'main') as string;
      return agentBrowserExec(['frame', r]);
    }

    // ── Dialogs ───────────────────────────────────────────────────────────────
    case 'dialog_accept':
      return agentBrowserExec(
        params.text ? ['dialog', 'accept', params.text as string] : ['dialog', 'accept'],
      );
    case 'dialog_dismiss':
      return agentBrowserExec(['dialog', 'dismiss']);

    // ── Drag & Drop ───────────────────────────────────────────────────────────
    case 'drag': {
      const src = params.src ?? params.from;
      const tgt = params.target ?? params.to;
      if (src == null || tgt == null) return { success: false, output: 'src and target are required.' };
      return agentBrowserExec(['drag', toRef(src as string | number), toRef(tgt as string | number)]);
    }

    // ── Upload ───────────────────────────────────────────────────────────────
    case 'upload': {
      const r = params.ref ?? params.selector;
      const files = params.files as string | string[];
      if (r == null || !files) return { success: false, output: 'ref and files are required.' };
      const fileList = Array.isArray(files) ? files : [files];
      return agentBrowserExec(['upload', toRef(r as string | number), ...fileList]);
    }

    // ── Cookies & Storage ─────────────────────────────────────────────────────
    case 'cookies':
      return agentBrowserExec(['cookies']);
    case 'cookies_set': {
      const name = params.name as string;
      const value = params.value as string;
      if (!name || value == null) return { success: false, output: 'name and value are required.' };
      return agentBrowserExec(['cookies', 'set', name, value]);
    }
    case 'cookies_clear':
      return agentBrowserExec(['cookies', 'clear']);
    case 'storage': {
      const store = (params.store as string) ?? 'local';
      const key = (params.storage_key ?? params.key) as string | undefined;
      const setVal = params.set as string | undefined;
      if (setVal != null && key) return agentBrowserExec(['storage', store, 'set', key, setVal]);
      if (key) return agentBrowserExec(['storage', store, key]);
      return agentBrowserExec(['storage', store]);
    }
    case 'storage_clear': {
      const store = (params.store as string) ?? 'local';
      return agentBrowserExec(['storage', store, 'clear']);
    }

    // ── Network ───────────────────────────────────────────────────────────────
    case 'network_requests': {
      const args = ['network', 'requests'];
      if (params.filter) args.push('--filter', params.filter as string);
      return agentBrowserExec(args);
    }

    // ── Debug / Console ───────────────────────────────────────────────────────
    case 'console':
      return agentBrowserExec(['console']);
    case 'errors':
      return agentBrowserExec(['errors']);

    // ── Sessions ──────────────────────────────────────────────────────────────
    case 'session_list':
      return agentBrowserExec(['session', 'list']);

    // ── Diff ─────────────────────────────────────────────────────────────────
    case 'diff_snapshot':
      return agentBrowserExec(['diff', 'snapshot']);
    case 'diff_screenshot': {
      const baseline = params.baseline as string;
      if (!baseline) return { success: false, output: 'baseline is required for diff_screenshot.' };
      return agentBrowserExec(['diff', 'screenshot', '--baseline', baseline]);
    }

    // ── Passthrough fallback ──────────────────────────────────────────────────
    default: {
      const extraArgs = Array.isArray(params.args) ? (params.args as string[]) : [];
      return agentBrowserExec([type, ...extraArgs]);
    }
  }
}

// ---------------------------------------------------------------------------
// Tool definition & executor
// ---------------------------------------------------------------------------

export function buildBrowserTools(_ctx: ToolContext): ToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'browser',
        description: `Unified browser automation tool backed by agent-browser (https://github.com/vercel-labs/agent-browser). Manages a persistent headless Chromium daemon via the agent-browser CLI.

RECOMMENDED WORKFLOW:
1. browser(open, url) — navigate to page
2. browser(snapshot) — get accessibility tree with element refs (@e1, @e2, …)
3. browser(click/fill/select, ref) — interact using refs
4. Re-snapshot after page changes

ACTIONS (type):
Navigation:  open, back, forward, reload, close
Snapshot:    snapshot [interactive=true, compact, depth, selector]
Interact:    click, dblclick, hover, focus — (ref or selector)
             fill — clear+fill (preferred), type — type text (ref optional → keyboard)
             select — choose dropdown option (ref, value)
             check / uncheck — toggle checkbox (ref)
Keyboard:    press/key — (key: "Enter", "Tab", "Escape", "Control+a", "ArrowDown" …)
Scroll:      scroll — (direction: up/down/left/right, amount px, optional selector)
             scrollintoview — scroll element into view (ref)
Screenshot:  screenshot [annotate, full]
Evaluate:    evaluate/eval — run JavaScript (script)
Get info:    get — (what: text/html/value/title/url/count/box/attr/styles, ref)
             get_url, get_title, get_text, get_html, get_content — shortcuts
Wait:        wait — (ms | text | url | load | fn | ref/selector)
             wait_for — wait for selector/ref with optional timeout
State:       is — check element state (state: visible/enabled/checked, ref)
Find:        find — semantic locator (by: role/text/label/placeholder/alt/testid/first/last/nth, query, action: click/fill/type/hover/focus/check/uncheck/text, [name], [exact], [value], [n])
Tabs:        tab/tab_list, tab_new [url], tab_switch (n), tab_close [n]
Frames:      frame (ref/selector or "main" to return to main frame)
Dialogs:     dialog_accept [text], dialog_dismiss
Mouse:       drag (src, target)
Upload:      upload (ref, files: string[])
Cookies:     cookies, cookies_set (name, value), cookies_clear
Storage:     storage (store: local/session, storage_key, [set]), storage_clear
Network:     network_requests [filter]
Debug:       console, errors, session_list, diff_snapshot, diff_screenshot (baseline)

Refs use @eN format from snapshot (e.g. @e1, @e2). Pass as number (1→@e1), "@e1", "e1", or CSS selector.`,
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Browser action to perform (see description).' },
            url: { type: 'string', description: 'URL for open / tab_new / wait.' },
            ref: {
              description: 'Element ref from snapshot (@e1, @e2 …) or CSS selector. Number 1 → @e1.',
              oneOf: [{ type: 'string' }, { type: 'number' }],
            },
            selector: { type: 'string', description: 'CSS selector — alias for ref or secondary target for scroll/wait.' },
            text: { type: 'string', description: 'Text for fill / type.' },
            value: { type: 'string', description: 'Value for select or find.' },
            key: { type: 'string', description: 'Keyboard key for press (e.g. Enter, Tab, Escape, Control+a, ArrowDown).' },
            script: { type: 'string', description: 'JavaScript expression for evaluate.' },
            direction: {
              type: 'string',
              enum: ['up', 'down', 'left', 'right'],
              description: 'Scroll direction.',
            },
            amount: { type: 'number', description: 'Pixels to scroll (for scroll up/down).' },
            what: {
              type: 'string',
              description: 'For get: text, html, value, attr, title, url, count, box, styles.',
            },
            attr: { type: 'string', description: 'Attribute name for "get attr".' },
            state: {
              type: 'string',
              enum: ['visible', 'enabled', 'checked'],
              description: 'State to check with "is".',
            },
            ms: { type: 'number', description: 'Milliseconds to wait.' },
            load: {
              type: 'string',
              enum: ['load', 'domcontentloaded', 'networkidle'],
              description: 'Load state to wait for.',
            },
            fn: { type: 'string', description: 'JavaScript condition string for wait.' },
            timeout: { type: 'number', description: 'Timeout ms for wait_for.' },
            by: {
              type: 'string',
              enum: ['role', 'text', 'label', 'placeholder', 'alt', 'title', 'testid', 'first', 'last', 'nth'],
              description: 'Semantic locator type for find.',
            },
            query: { type: 'string', description: 'Query string for find (e.g. "button", "Submit", "Email").' },
            action: {
              type: 'string',
              description: 'Action for find: click, fill, type, hover, focus, check, uncheck, text.',
            },
            name: { type: 'string', description: 'ARIA accessible name filter for find role.' },
            exact: { type: 'boolean', description: 'Require exact text match for find text.' },
            n: { type: 'number', description: 'Tab number for tab_switch/tab_close, or nth index for find nth.' },
            src: {
              description: 'Source element for drag.',
              oneOf: [{ type: 'string' }, { type: 'number' }],
            },
            target: {
              description: 'Target element for drag.',
              oneOf: [{ type: 'string' }, { type: 'number' }],
            },
            files: {
              description: 'File path(s) for upload.',
              oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
            },
            annotate: { type: 'boolean', description: 'Overlay numbered @eN labels on screenshot.' },
            full: { type: 'boolean', description: 'Full-page screenshot.' },
            interactive: {
              type: 'boolean',
              description: 'Snapshot interactive elements only (default true).',
            },
            compact: { type: 'boolean', description: 'Remove empty structural nodes from snapshot output.' },
            depth: { type: 'number', description: 'Max snapshot accessibility tree depth.' },
            store: {
              type: 'string',
              enum: ['local', 'session'],
              description: 'Storage type for storage commands (default: local).',
            },
            storage_key: { type: 'string', description: 'Storage key for storage get/set.' },
            set: { type: 'string', description: 'Value to write for storage set.' },
            filter: { type: 'string', description: 'Filter string for network_requests.' },
            baseline: { type: 'string', description: 'Baseline file path for diff_screenshot.' },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Extra raw CLI args forwarded to unknown agent-browser commands.',
            },
          },
          required: ['type'],
        },
      },
    },
  ];
}

export async function executeBrowserTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  if (name !== 'browser') return null;
  const type = args.type as string;
  if (!type) return { success: false, output: 'type is required.' };
  return browserCommand(type, args, { sessionId: ctx.sessionId, sessionDir: ctx.sessionDir });
}
