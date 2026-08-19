import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DeepSeekWebRpa } from './rpa.ts'

const pluginDir = dirname(fileURLToPath(import.meta.url))

export const name = 'deepseek-web-rpa'
export const inject = ['tools', 'systemPrompt']

export interface Config {
  headed: boolean
  timeoutMs: number
  userDataDir: string
}

export const Config: z<Config> = z.object({
  headed: z.boolean().default(true),
  timeoutMs: z.number().default(180_000),
  userDataDir: z.string().default(''),
})

export function apply(ctx: Context, config: Config) {
  const rpa = new DeepSeekWebRpa({
    headed: config.headed,
    timeoutMs: config.timeoutMs,
    userDataDir: config.userDataDir || join(pluginDir, '..', '.browser-profile'),
  })

  ctx.effect(() => () => {
    void rpa.close()
  })

  ctx.systemPrompt.section({
    name: 'deepseek-web-rpa',
    order: 180,
    text: [
      'You can operate the official DeepSeek web chat via the `deepseek_web_chat` tool.',
      'Use it when the user asks to send a message on https://chat.deepseek.com, to simulate RPA against that site, or to bring a web-chat reply back into this session.',
      'Pass the exact user-facing prompt as `message`. Set `new_chat` true to start a fresh conversation.',
      'If the tool returns status `login_required`, tell the user to finish login in the opened Chromium window, then retry.',
      'After a successful call, summarize the returned `reply` in this Web UI; do not claim the web chat succeeded unless the tool did.',
    ].join(' '),
  })

  ctx.tools.register(defineTool({
    name: 'deepseek_web_chat',
    description: 'Open https://chat.deepseek.com in a real browser, send a chat message by RPA, and return the assistant reply.',
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => false,
    parameters: {
      message: {
        type: 'string',
        required: true,
        description: 'The exact text to type into the DeepSeek web chat input.',
      },
      new_chat: {
        type: 'boolean',
        description: 'If true, click New chat before sending. Defaults to true.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          reply: { type: 'string', required: true },
          pageUrl: { type: 'string', required: true },
        },
      },
      render(_args, value) {
        const status = String(value.status)
        if (status === 'login_required') {
          return [{ type: 'text', text: 'chat.deepseek.com 需要登录。请在弹出的 Chromium 窗口里完成登录，然后重试。' }]
        }
        return [{ type: 'text', text: String(value.reply) }]
      },
    },
    presentCall(args) {
      return {
        card: 'generic',
        kind: 'search',
        title: 'DeepSeek Web Chat',
        rawInput: args.message,
      }
    },
    presentResult(_args, result) {
      return {
        card: 'generic',
        title: result.isError ? 'DeepSeek Web Chat 失败' : 'DeepSeek Web Chat',
      }
    },
    async execute(args, exec) {
      const result = await rpa.chat(args.message, exec.signal, args.new_chat !== false)
      if (result.status === 'login_required') return result
      if (!result.reply) {
        throw new Error(`DeepSeek Web Chat 没有拿到回复（${result.pageUrl}）`)
      }
      return result
    },
  }))
}
