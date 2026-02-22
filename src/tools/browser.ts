import type { ToolResult } from '../types.js';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';

// Browser session state
let browser: Browser | null = null;
let context: BrowserContext | null = null;
const pages = new Map<string, Page>();
let currentPageId: string | null = null;

// --- Browser lifecycle ---

async function ensureBrowser(): Promise<void> {
  if (browser && browser.isConnected() && context) return;

  if (browser && !browser.isConnected()) {
    browser = null;
    context = null;
    pages.clear();
    currentPageId = null;
  }

  browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1280,900',
    ],
  });

  browser.on('disconnected', () => {
    browser = null;
    context = null;
    pages.clear();
    currentPageId = null;
  });

  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
}

function generatePageId(): string {
  return `page_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function getPage(pageId?: string): Promise<Page | null> {
  const id = pageId || currentPageId;
  if (!id) return null;
  return pages.get(id) || null;
}

// --- Snapshot engine ---
//
// Injects sequential data-ai-ref attributes into all visible interactive elements,
// then returns a compact text representation.  AI uses the ref numbers for all
// click/type/select actions, eliminating fragile CSS-selector guessing.

// Playwright serializes this function and runs it in the browser context.
// Re-injects data-ai-ref attributes using the same ordering as generateSnapshot,
// so refs remain valid even after SPA re-renders.
async function refreshRefs(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('[data-ai-ref]').forEach(el => el.removeAttribute('data-ai-ref'));
    const SELECTORS = [
      'a[href]', 'button:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])', 'select:not([disabled])',
      '[role="button"]:not([aria-disabled="true"])',
      '[role="link"]', '[role="checkbox"]', '[role="radio"]',
      '[role="combobox"]', '[role="menuitem"]', '[role="tab"]',
      '[role="textbox"]', '[contenteditable="true"]',
    ];
    const seen = new Set<Element>();
    const elements: Element[] = [];
    for (const sel of SELECTORS) {
      document.querySelectorAll(sel).forEach(el => {
        if (seen.has(el)) return;
        seen.add(el);
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (
          rect.width > 0 && rect.height > 0 &&
          style.visibility !== 'hidden' && style.display !== 'none' &&
          parseFloat(style.opacity) > 0
        ) elements.push(el);
      });
    }
    elements.slice(0, 60).forEach((el, i) => el.setAttribute('data-ai-ref', String(i + 1)));
  });
}

interface SnapElement {
  ref: number;
  tag: string;
  role: string;
  type: string;
  value: string;
  placeholder: string;
  label: string;
  href: string;
  checked: boolean;
  options: string[];
}

async function generateSnapshot(page: Page): Promise<string> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const data = await page.evaluate((): { items: SnapElement[]; pageText: string } => {
    // Clear previous refs
    document.querySelectorAll('[data-ai-ref]').forEach(el => {
      el.removeAttribute('data-ai-ref');
    });

    const SELECTORS = [
      'a[href]',
      'button:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[role="button"]:not([aria-disabled="true"])',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="combobox"]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[role="textbox"]',
      '[contenteditable="true"]',
    ];

    const seen = new Set<Element>();
    const elements: Element[] = [];

    for (const sel of SELECTORS) {
      document.querySelectorAll(sel).forEach(el => {
        if (seen.has(el)) return;
        seen.add(el);
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          parseFloat(style.opacity) > 0
        ) {
          elements.push(el);
        }
      });
    }

    const items: SnapElement[] = elements.slice(0, 60).map((el, i) => {
      const ref = i + 1;
      el.setAttribute('data-ai-ref', String(ref));

      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';
      const type = (el as HTMLInputElement).type || '';
      const value = (el as HTMLInputElement).value || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const titleAttr = el.getAttribute('title') || '';
      const rawText = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 60);
      const label = ariaLabel || titleAttr || rawText;
      const href = (el as HTMLAnchorElement).href || '';
      const checked = (el as HTMLInputElement).checked || false;

      let options: string[] = [];
      if (tag === 'select') {
        options = Array.from((el as HTMLSelectElement).options)
          .map(o => (o.value !== o.text ? `${o.text}(${o.value})` : o.text))
          .slice(0, 8);
      }

      return { ref, tag, role, type, value, placeholder, label, href, checked, options };
    });

    // Extract readable page text from the main content area
    const mainEl =
      (document.querySelector('main, [role="main"], article') as HTMLElement) ||
      (document.body as HTMLElement);
    const pageText = (mainEl.innerText || '').replace(/\s+/g, ' ').trim().substring(0, 1200);

    return { items, pageText };
  });

  const title = await page.title();
  const url = page.url();

  const lines: string[] = [`[Page: "${title}" | ${url}]`, ''];

  if (data.items.length === 0) {
    lines.push('(No interactive elements found)');
  } else {
    for (const el of data.items) {
      let desc = `[${el.ref}]`;

      if (el.tag === 'a') {
        desc += ` link "${el.label || el.href}"`;
      } else if (el.tag === 'button' || el.role === 'button') {
        desc += ` button "${el.label}"`;
      } else if (el.tag === 'input') {
        if (el.type === 'submit' || el.type === 'button' || el.type === 'image') {
          desc += ` button "${el.label || el.value}"`;
        } else if (el.type === 'checkbox') {
          desc += ` checkbox "${el.label}" [${el.checked ? 'x' : ' '}]`;
        } else if (el.type === 'radio') {
          desc += ` radio "${el.label}" [${el.checked ? 'x' : ' '}]`;
        } else {
          desc += ` input[${el.type || 'text'}] "${el.label || el.placeholder}"`;
          if (el.value) desc += ` = "${el.value.substring(0, 40)}"`;
        }
      } else if (el.tag === 'textarea') {
        desc += ` textarea "${el.label || el.placeholder}"`;
        if (el.value) desc += ` = "${el.value.substring(0, 40)}"`;
      } else if (el.tag === 'select') {
        desc += ` select "${el.label}"`;
        if (el.value) desc += ` = "${el.value}"`;
        if (el.options.length > 0) {
          desc += ` (options: ${el.options.slice(0, 5).join(', ')}${el.options.length > 5 ? '…' : ''})`;
        }
      } else {
        desc += ` ${el.role || el.tag} "${el.label}"`;
      }

      lines.push(desc);
    }
  }

  if (data.pageText) {
    lines.push('');
    lines.push('--- Content ---');
    lines.push(data.pageText);
  }

  return lines.join('\n');
}

// --- Exported tool functions ---

export async function browserSnapshot(pageId?: string): Promise<ToolResult> {
  const page = await getPage(pageId);
  if (!page) {
    return { success: false, output: 'No active page. Use browser_navigate to open a URL first.' };
  }
  try {
    const snapshot = await generateSnapshot(page);
    return { success: true, output: snapshot };
  } catch (e: unknown) {
    return { success: false, output: `Snapshot error: ${(e as Error).message}` };
  }
}

export async function browserNavigate(url: string): Promise<ToolResult> {
  try {
    new URL(url);
  } catch {
    return { success: false, output: 'Invalid URL.' };
  }

  try {
    await ensureBrowser();
    const page = await context!.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for network to settle so SPAs (React/Next.js etc.) finish their initial render
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    const pageId = generatePageId();
    pages.set(pageId, page);
    currentPageId = pageId;

    const snapshot = await generateSnapshot(page);
    return {
      success: true,
      output: `Navigated to: ${url}\nPage ID: ${pageId}\n\n${snapshot}`,
    };
  } catch (e: unknown) {
    return { success: false, output: `Navigation error: ${(e as Error).message}` };
  }
}

export async function browserClick(ref: number, pageId?: string): Promise<ToolResult> {
  const page = await getPage(pageId);
  if (!page) {
    return { success: false, output: 'No active page. Use browser_navigate first.' };
  }
  try {
    // Re-inject refs before acting in case SPA re-rendered and removed attributes
    await refreshRefs(page);
    await page.locator(`[data-ai-ref="${ref}"]`).click({ timeout: 10000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);

    const snapshot = await generateSnapshot(page);
    return { success: true, output: `Clicked [${ref}]\n\n${snapshot}` };
  } catch (e: unknown) {
    return { success: false, output: `Click error on [${ref}]: ${(e as Error).message}` };
  }
}

export async function browserType(ref: number, text: string, pageId?: string): Promise<ToolResult> {
  const page = await getPage(pageId);
  if (!page) {
    return { success: false, output: 'No active page. Use browser_navigate first.' };
  }
  try {
    await refreshRefs(page);
    const locator = page.locator(`[data-ai-ref="${ref}"]`);
    await locator.click({ timeout: 10000 });
    await locator.fill(text);

    const snapshot = await generateSnapshot(page);
    const preview = text.length > 50 ? text.substring(0, 50) + '…' : text;
    return { success: true, output: `Typed "${preview}" into [${ref}]\n\n${snapshot}` };
  } catch (e: unknown) {
    return { success: false, output: `Type error on [${ref}]: ${(e as Error).message}` };
  }
}

export async function browserSelect(ref: number, value: string, pageId?: string): Promise<ToolResult> {
  const page = await getPage(pageId);
  if (!page) {
    return { success: false, output: 'No active page. Use browser_navigate first.' };
  }
  try {
    await refreshRefs(page);
    const locator = page.locator(`[data-ai-ref="${ref}"]`);
    // Try selecting by value first, then by visible label
    try {
      await locator.selectOption(value, { timeout: 5000 });
    } catch {
      await locator.selectOption({ label: value }, { timeout: 5000 });
    }

    const snapshot = await generateSnapshot(page);
    return { success: true, output: `Selected "${value}" in [${ref}]\n\n${snapshot}` };
  } catch (e: unknown) {
    return { success: false, output: `Select error on [${ref}]: ${(e as Error).message}` };
  }
}

export async function browserScreenshot(
  pageId?: string,
  sessionId?: string,
  workspace?: string,
): Promise<ToolResult> {
  const page = await getPage(pageId);
  if (!page) {
    return { success: false, output: 'No active page. Use browser_navigate first.' };
  }
  try {
    const buf = await page.screenshot({ type: 'png', fullPage: false });
    const base64 = buf.toString('base64');
    const dataUrl = `data:image/png;base64,${base64}`;
    const url = page.url();
    const title = await page.title().catch(() => 'Unknown');

    // Save to workspace; expose via server URL (/api/sessions/:id/images/:file)
    let imageUrl: string | undefined;
    if (workspace && sessionId) {
      const dir = path.join(workspace, 'screenshots');
      fs.mkdirSync(dir, { recursive: true });
      const filename = `screenshot_${Date.now()}.png`;
      fs.writeFileSync(path.join(dir, filename), buf);
      imageUrl = `/api/sessions/${sessionId}/images/${filename}`;
    }

    return {
      success: true,
      // Keep output clean — no local URLs that remote AI models can't access
      output: `Screenshot captured.\nPage: ${url}\nTitle: ${title}`,
      image: dataUrl,   // base64 for AI vision (sent as user-role message in agent.ts)
      imageUrl,         // server URL for dashboard display
    };
  } catch (e: unknown) {
    return { success: false, output: `Screenshot error: ${(e as Error).message}` };
  }
}

export async function browserEvaluate(script: string, pageId?: string): Promise<ToolResult> {
  const page = await getPage(pageId);
  if (!page) {
    return { success: false, output: 'No active page. Use browser_navigate first.' };
  }
  try {
    const result = await page.evaluate(`(function() { ${script} })()`);
    const output =
      typeof result === 'object' && result !== null
        ? JSON.stringify(result, null, 2)
        : String(result ?? '');
    return { success: true, output: output.slice(0, 4000) };
  } catch (e: unknown) {
    return { success: false, output: `Evaluate error: ${(e as Error).message}` };
  }
}

export async function browserGetContent(selector?: string, pageId?: string): Promise<ToolResult> {
  const page = await getPage(pageId);
  if (!page) {
    return { success: false, output: 'No active page. Use browser_navigate first.' };
  }
  try {
    let content: string;
    if (selector) {
      await page.locator(selector).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      content = await page.locator(selector).innerText().catch(() => '');
    } else {
      content = await page.evaluate(() => {
        const el =
          (document.querySelector('main, [role="main"], article') as HTMLElement) ||
          (document.body as HTMLElement);
        return (el.innerText || '').replace(/\s+/g, ' ').trim();
      });
    }
    return { success: true, output: content.slice(0, 8000) };
  } catch (e: unknown) {
    return { success: false, output: `Get content error: ${(e as Error).message}` };
  }
}

export async function browserWaitFor(
  selector: string,
  timeout: number = 10000,
  pageId?: string,
): Promise<ToolResult> {
  const page = await getPage(pageId);
  if (!page) {
    return { success: false, output: 'No active page. Use browser_navigate first.' };
  }
  try {
    await page.locator(selector).waitFor({ state: 'visible', timeout });
    const snapshot = await generateSnapshot(page);
    return { success: true, output: `Element appeared: ${selector}\n\n${snapshot}` };
  } catch (e: unknown) {
    return { success: false, output: `Wait error: ${(e as Error).message}` };
  }
}

export async function browserScroll(
  direction: 'up' | 'down' | 'top' | 'bottom',
  amount: number = 300,
  pageId?: string,
): Promise<ToolResult> {
  const page = await getPage(pageId);
  if (!page) {
    return { success: false, output: 'No active page. Use browser_navigate first.' };
  }
  try {
    switch (direction) {
      case 'down':
        await page.evaluate(`window.scrollBy(0, ${amount})`);
        break;
      case 'up':
        await page.evaluate(`window.scrollBy(0, -${amount})`);
        break;
      case 'top':
        await page.evaluate('window.scrollTo(0, 0)');
        break;
      case 'bottom':
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        break;
    }
    await page.waitForTimeout(300);
    const snapshot = await generateSnapshot(page);
    return { success: true, output: `Scrolled ${direction}\n\n${snapshot}` };
  } catch (e: unknown) {
    return { success: false, output: `Scroll error: ${(e as Error).message}` };
  }
}

export async function browserPress(key: string, pageId?: string): Promise<ToolResult> {
  const page = await getPage(pageId);
  if (!page) {
    return { success: false, output: 'No active page. Use browser_navigate first.' };
  }
  try {
    await page.keyboard.press(key);
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    const snapshot = await generateSnapshot(page);
    return { success: true, output: `Pressed key: ${key}\n\n${snapshot}` };
  } catch (e: unknown) {
    return { success: false, output: `Press error: ${(e as Error).message}` };
  }
}

export async function browserGetUrl(pageId?: string): Promise<ToolResult> {
  const page = await getPage(pageId);
  if (!page) {
    return { success: false, output: 'No active page. Use browser_navigate first.' };
  }
  try {
    const url = page.url();
    const title = await page.title();
    return { success: true, output: `URL: ${url}\nTitle: ${title}` };
  } catch (e: unknown) {
    return { success: false, output: `Get URL error: ${(e as Error).message}` };
  }
}

export async function browserListPages(): Promise<ToolResult> {
  if (pages.size === 0) {
    return { success: true, output: 'No open pages.' };
  }
  const pageList: string[] = [];
  for (const [id, page] of pages) {
    const url = page.url();
    const title = await page.title().catch(() => 'Unknown');
    const current = id === currentPageId ? ' (current)' : '';
    pageList.push(`${id}${current}: ${title}\n  ${url}`);
  }
  return { success: true, output: `Open pages:\n${pageList.join('\n\n')}` };
}

export async function browserSwitchPage(pageId: string): Promise<ToolResult> {
  if (!pages.has(pageId)) {
    return { success: false, output: `Page not found: ${pageId}` };
  }
  currentPageId = pageId;
  const page = pages.get(pageId)!;
  const url = page.url();
  const title = await page.title();
  return { success: true, output: `Switched to page: ${pageId}\nTitle: ${title}\nURL: ${url}` };
}

export async function browserClosePage(pageId?: string): Promise<ToolResult> {
  const id = pageId || currentPageId;
  if (!id) {
    return { success: false, output: 'No page to close.' };
  }
  const page = pages.get(id);
  if (!page) {
    return { success: false, output: `Page not found: ${id}` };
  }
  try {
    await page.close();
    pages.delete(id);
    if (currentPageId === id) {
      currentPageId = pages.size > 0 ? pages.keys().next().value! : null;
    }
    return { success: true, output: `Closed page: ${id}` };
  } catch (e: unknown) {
    return { success: false, output: `Close error: ${(e as Error).message}` };
  }
}

export async function browserClose(): Promise<ToolResult> {
  try {
    if (browser) {
      await browser.close();
      browser = null;
      context = null;
      pages.clear();
      currentPageId = null;
    }
    return { success: true, output: 'Browser closed.' };
  } catch (e: unknown) {
    return { success: false, output: `Close error: ${(e as Error).message}` };
  }
}
