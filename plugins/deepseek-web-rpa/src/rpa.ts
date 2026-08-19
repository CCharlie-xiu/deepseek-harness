import { mkdir } from 'node:fs/promises'
import { chromium, type BrowserContext, type Page } from 'playwright'

const CHAT_URL = 'https://chat.deepseek.com/'

const INPUT_SELECTORS = [
  '#chat-input',
  'textarea[placeholder*="Message DeepSeek"]',
  'textarea[placeholder*="发送"]',
  'textarea[name="search"]',
  'textarea',
]

const LOGIN_SELECTORS = [
  '.ds-sign-in-form__main',
  '.ds-sign-in-form-wrapper',
  '.ds-auth-form-wrapper',
  'input[autocomplete="current-password"]',
  'input[type="password"]',
  'button:has-text("Log in")',
  'button:has-text("Sign in")',
  'button:has-text("登录")',
]

const REPLY_SELECTORS = [
  '.ds-markdown',
  '[data-message-author-role="assistant"]',
  '[class*="AssistantMessage"]',
]

const NEW_CHAT_SELECTORS = [
  'button:has-text("新对话")',
  'button:has-text("New chat")',
  'a[href="/"]',
  'button[aria-label*="New"]',
  'button[aria-label*="新"]',
]

export interface RpaConfig {
  headed: boolean
  userDataDir: string
  timeoutMs: number
}

export interface RpaResult {
  status: 'ok' | 'login_required' | 'error'
  reply: string
  pageUrl: string
}

export class DeepSeekWebRpa {
  private context: BrowserContext | undefined
  private page: Page | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly config: RpaConfig) {}

  async chat(message: string, signal: AbortSignal, newChat: boolean): Promise<RpaResult> {
    return this.enqueue(() => this.runChat(message, signal, newChat))
  }

  async close(): Promise<void> {
    const context = this.context
    this.context = undefined
    this.page = undefined
    await context?.close().catch(() => undefined)
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private async runChat(message: string, signal: AbortSignal, newChat: boolean): Promise<RpaResult> {
    throwIfAborted(signal)
    const page = await this.ensurePage()
    await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: this.config.timeoutMs })
    throwIfAborted(signal)

    const ready = await this.waitForChatOrLogin(page, signal)
    if (ready === 'login') {
      return {
        status: 'login_required',
        reply: '',
        pageUrl: page.url(),
      }
    }

    if (newChat) await this.openNewChat(page)

    const before = await collectReplies(page)
    await fillAndSend(page, message)
    throwIfAborted(signal)

    const reply = await waitForNewReply(page, before, this.config.timeoutMs, signal)
    return {
      status: 'ok',
      reply,
      pageUrl: page.url(),
    }
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page
    await mkdir(this.config.userDataDir, { recursive: true })
    this.context = await chromium.launchPersistentContext(this.config.userDataDir, {
      channel: 'chrome',
      headless: !this.config.headed,
      viewport: { width: 1280, height: 900 },
      locale: 'zh-CN',
      args: ['--disable-blink-features=AutomationControlled'],
    })
    this.page = this.context.pages()[0] ?? await this.context.newPage()
    return this.page
  }

  private async waitForChatOrLogin(page: Page, signal: AbortSignal): Promise<'ready' | 'login'> {
    const deadline = Date.now() + this.config.timeoutMs
    while (Date.now() < deadline) {
      throwIfAborted(signal)
      if (await firstVisible(page, INPUT_SELECTORS)) return 'ready'
      if (await firstVisible(page, LOGIN_SELECTORS) && !this.config.headed) return 'login'
      if (await firstVisible(page, LOGIN_SELECTORS) && this.config.headed) {
        // Keep the window open so the operator can finish login.
        await page.waitForTimeout(1000)
        continue
      }
      await page.waitForTimeout(400)
    }
    if (await firstVisible(page, INPUT_SELECTORS)) return 'ready'
    return 'login'
  }

  private async openNewChat(page: Page): Promise<void> {
    const button = await firstVisible(page, NEW_CHAT_SELECTORS)
    if (!button) return
    await button.click({ timeout: 3000 }).catch(() => undefined)
    await page.waitForTimeout(800)
  }
}

async function fillAndSend(page: Page, message: string): Promise<void> {
  const input = await firstVisible(page, INPUT_SELECTORS)
  if (!input) throw new Error('未找到 chat.deepseek.com 的输入框')
  await input.click({ timeout: 5000 })
  await input.fill('')
  await input.fill(message)
  await page.keyboard.press('Enter')
}

async function waitForNewReply(
  page: Page,
  before: string[],
  timeoutMs: number,
  signal: AbortSignal,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  let stableTicks = 0
  while (Date.now() < deadline) {
    throwIfAborted(signal)
    const replies = await collectReplies(page)
    const newest = newestReply(replies, before)
    if (newest && newest === last) {
      stableTicks += 1
      if (stableTicks >= 4 && newest.trim().length > 0) return newest.trim()
    } else {
      stableTicks = 0
      last = newest
    }
    await page.waitForTimeout(500)
  }
  if (last.trim()) return last.trim()
  throw new Error('等待 chat.deepseek.com 回复超时')
}

async function collectReplies(page: Page): Promise<string[]> {
  for (const selector of REPLY_SELECTORS) {
    const texts = await page.locator(selector).allInnerTexts().catch(() => [])
    const cleaned = texts.map((text) => text.trim()).filter(Boolean)
    if (cleaned.length > 0) return cleaned
  }
  return []
}

function newestReply(current: string[], before: string[]): string {
  if (current.length > before.length) return current[current.length - 1] ?? ''
  const lastBefore = before[before.length - 1] ?? ''
  const lastCurrent = current[current.length - 1] ?? ''
  return lastCurrent !== lastBefore ? lastCurrent : ''
}

async function firstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()
    if (await locator.count() === 0) continue
    if (await locator.isVisible().catch(() => false)) return locator
  }
  return undefined
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('DeepSeek Web RPA cancelled')
    error.name = 'AbortError'
    throw error
  }
}
