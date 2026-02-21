import type { ToolResult } from '../types.js';
import puppeteer, { Browser, Page, BrowserContext, KeyInput } from 'puppeteer';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Browser session management
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let pages: Map<string, Page> = new Map();
let currentPageId: string | null = null;

async function ensureBrowser(): Promise<Browser> {
  if (!browser) {
    // Windows対応: chrome-headless-shellのパスを明示的に使用
    let executablePath: string | undefined;
    const platform = os.platform();
    const cacheDir = path.join(os.homedir(), '.cache', 'puppeteer');
    
    // chrome-headless-shellを探す
    const headlessShellBase = path.join(cacheDir, 'chrome-headless-shell');
    let headlessShellDir = '';
    
    try {
      const dirs = fs.readdirSync(headlessShellBase);
      const targetDir = dirs.find((d: string) => d.startsWith(platform === 'win32' ? 'win64' : platform));
      if (targetDir) {
        headlessShellDir = path.join(headlessShellBase, targetDir);
      }
    } catch {
      // ディレクトリが見つからない
    }
    
    if (platform === 'win32') {
      executablePath = path.join(headlessShellDir, 'chrome-headless-shell.exe');
    } else {
      executablePath = path.join(headlessShellDir, 'chrome-headless-shell');
    }
    
    // ファイルが存在するか確認
    if (!fs.existsSync(executablePath)) {
      // puppeteerのデフォルトのexecutablePathを使用
      try {
        executablePath = puppeteer.executablePath();
      } catch {
        // 何もしない - executablePathはundefinedのまま
      }
    }
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    });
    
    browser.on('disconnected', () => {
      browser = null;
      context = null;
      pages.clear();
      currentPageId = null;
    });
  }
  return browser;
}

async function ensureContext(): Promise<BrowserContext> {
  const b = await ensureBrowser();
  if (!context) {
    context = await b.createBrowserContext();
  }
  return context;
}

function generatePageId(): string {
  return `page_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function browserNavigate(url: string): Promise<ToolResult> {
  try {
    new URL(url);
  } catch {
    return { success: false, output: 'Invalid URL.' };
  }

  try {
    const ctx = await ensureContext();
    const page = await ctx.newPage();
    
    // Set viewport
    await page.setViewport({ width: 1280, height: 720 });
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate with timeout
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const pageId = generatePageId();
    pages.set(pageId, page);
    currentPageId = pageId;
    
    const title = await page.title();
    
    return { 
      success: true, 
      output: `Navigated to: ${url}\nTitle: ${title}\nPage ID: ${pageId}` 
    };
  } catch (e: unknown) {
    return { success: false, output: `Navigation error: ${(e as Error).message}` };
  }
}

export async function browserClick(selector: string, pageId?: string): Promise<ToolResult> {
  const targetId = pageId || currentPageId;
  if (!targetId) {
    return { success: false, output: 'No active page. Navigate to a URL first.' };
  }
  
  const page = pages.get(targetId);
  if (!page) {
    return { success: false, output: `Page not found: ${targetId}` };
  }

  try {
    // Wait for element to be visible
    await page.waitForSelector(selector, { visible: true, timeout: 10000 });
    
    // Click the element
    await page.click(selector);
    
    // Wait a bit for any navigation/animation
    await sleep(500);
    
    return { success: true, output: `Clicked element: ${selector}` };
  } catch (e: unknown) {
    return { success: false, output: `Click error: ${(e as Error).message}` };
  }
}

export async function browserType(selector: string, text: string, pageId?: string): Promise<ToolResult> {
  const targetId = pageId || currentPageId;
  if (!targetId) {
    return { success: false, output: 'No active page. Navigate to a URL first.' };
  }
  
  const page = pages.get(targetId);
  if (!page) {
    return { success: false, output: `Page not found: ${targetId}` };
  }

  try {
    // Wait for element
    await page.waitForSelector(selector, { visible: true, timeout: 10000 });
    
    // Clear and type
    await page.click(selector, { clickCount: 3 }); // Select all
    await page.type(selector, text);
    
    return { success: true, output: `Typed into ${selector}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}` };
  } catch (e: unknown) {
    return { success: false, output: `Type error: ${(e as Error).message}` };
  }
}

export async function browserScreenshot(pageId?: string): Promise<ToolResult> {
  const targetId = pageId || currentPageId;
  if (!targetId) {
    return { success: false, output: 'No active page. Navigate to a URL first.' };
  }
  
  const page = pages.get(targetId);
  if (!page) {
    return { success: false, output: `Page not found: ${targetId}` };
  }

  try {
    const screenshot = await page.screenshot({ 
      encoding: 'base64',
      fullPage: false,
    });
    
    // Return as data URL
    const dataUrl = `data:image/png;base64,${screenshot}`;
    
    return { 
      success: true, 
      output: `Screenshot captured. Data URL (first 100 chars): ${dataUrl.substring(0, 100)}...`
    };
  } catch (e: unknown) {
    return { success: false, output: `Screenshot error: ${(e as Error).message}` };
  }
}

export async function browserEvaluate(script: string, pageId?: string): Promise<ToolResult> {
  const targetId = pageId || currentPageId;
  if (!targetId) {
    return { success: false, output: 'No active page. Navigate to a URL first.' };
  }
  
  const page = pages.get(targetId);
  if (!page) {
    return { success: false, output: `Page not found: ${targetId}` };
  }

  try {
    const result = await page.evaluate(script);
    
    let output: string;
    if (typeof result === 'object') {
      output = JSON.stringify(result, null, 2);
    } else {
      output = String(result);
    }
    
    return { success: true, output: output.slice(0, 4000) };
  } catch (e: unknown) {
    return { success: false, output: `Evaluate error: ${(e as Error).message}` };
  }
}

export async function browserGetContent(selector?: string, pageId?: string): Promise<ToolResult> {
  const targetId = pageId || currentPageId;
  if (!targetId) {
    return { success: false, output: 'No active page. Navigate to a URL first.' };
  }
  
  const page = pages.get(targetId);
  if (!page) {
    return { success: false, output: `Page not found: ${targetId}` };
  }

  try {
    let content: string;
    
    if (selector) {
      // Get specific element content
      await page.waitForSelector(selector, { timeout: 5000 }).catch(() => {});
      content = await page.$eval(selector, el => el.textContent || '').catch(() => '');
    } else {
      // Get full page content
      content = await page.content();
      // Strip scripts and styles for readability
      content = content
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    
    return { success: true, output: content.slice(0, 8000) };
  } catch (e: unknown) {
    return { success: false, output: `Get content error: ${(e as Error).message}` };
  }
}

export async function browserWaitFor(selector: string, timeout: number = 10000, pageId?: string): Promise<ToolResult> {
  const targetId = pageId || currentPageId;
  if (!targetId) {
    return { success: false, output: 'No active page. Navigate to a URL first.' };
  }
  
  const page = pages.get(targetId);
  if (!page) {
    return { success: false, output: `Page not found: ${targetId}` };
  }

  try {
    await page.waitForSelector(selector, { visible: true, timeout });
    return { success: true, output: `Element appeared: ${selector}` };
  } catch (e: unknown) {
    return { success: false, output: `Wait error: ${(e as Error).message}` };
  }
}

export async function browserScroll(direction: 'up' | 'down' | 'top' | 'bottom', amount: number = 300, pageId?: string): Promise<ToolResult> {
  const targetId = pageId || currentPageId;
  if (!targetId) {
    return { success: false, output: 'No active page. Navigate to a URL first.' };
  }
  
  const page = pages.get(targetId);
  if (!page) {
    return { success: false, output: `Page not found: ${targetId}` };
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
    
    return { success: true, output: `Scrolled ${direction}` };
  } catch (e: unknown) {
    return { success: false, output: `Scroll error: ${(e as Error).message}` };
  }
}

export async function browserPress(key: string, pageId?: string): Promise<ToolResult> {
  const targetId = pageId || currentPageId;
  if (!targetId) {
    return { success: false, output: 'No active page. Navigate to a URL first.' };
  }
  
  const page = pages.get(targetId);
  if (!page) {
    return { success: false, output: `Page not found: ${targetId}` };
  }

  try {
    await page.keyboard.press(key as KeyInput);
    return { success: true, output: `Pressed key: ${key}` };
  } catch (e: unknown) {
    return { success: false, output: `Press error: ${(e as Error).message}` };
  }
}

export async function browserGetUrl(pageId?: string): Promise<ToolResult> {
  const targetId = pageId || currentPageId;
  if (!targetId) {
    return { success: false, output: 'No active page. Navigate to a URL first.' };
  }
  
  const page = pages.get(targetId);
  if (!page) {
    return { success: false, output: `Page not found: ${targetId}` };
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
  const targetId = pageId || currentPageId;
  if (!targetId) {
    return { success: false, output: 'No page to close.' };
  }
  
  const page = pages.get(targetId);
  if (!page) {
    return { success: false, output: `Page not found: ${targetId}` };
  }

  try {
    await page.close();
    pages.delete(targetId);
    
    if (currentPageId === targetId) {
      currentPageId = pages.size > 0 ? pages.keys().next().value! : null;
    }
    
    return { success: true, output: `Closed page: ${targetId}` };
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
