// @vitest-environment jsdom
/** generate_image toolview: canvas follows WxH, not a hardcoded square. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { GenerateImageRow, generateImageToolview } from '../src/client/tool/toolviews/generate-image-row.tsx'
import { CONVERSATION_NS as NS } from '../src/client/locale.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)

const runningCall = (argsRaw: string) => ({
  callId: 'c1', name: 'generate_image', argsRaw, turn: 1, step: 1, time: 1_000, callView: null, subCalls: [],
})

const resultNode = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callTime: 1_000, callId: 'c1',
  call: { name: 'generate_image', argsRaw: '{"prompt":"夏日风景"}' },
  content: [{ type: 'text', text: 'ok' }],
  isError: false, callView: null, resultView: null, subCalls: [],
  ...over,
})

function rowProps(block: unknown): Parameters<typeof GenerateImageRow>[0] {
  return {
    callId: 'c1', toolName: 'generate_image', block, t,
    openFile: vi.fn(),
    sessionId: 's1',
    useSessions: () => undefined,
  } as unknown as Parameters<typeof GenerateImageRow>[0]
}

function frameVars(view: ReturnType<typeof render>): { ratio: string; maxW: string } {
  const wrap = view.container.firstElementChild as HTMLElement
  return {
    ratio: wrap.style.getPropertyValue('--ig-ratio'),
    maxW: wrap.style.getPropertyValue('--ig-max-w'),
  }
}

describe('GenerateImageRow', () => {
  it('sizes the pending canvas to a 9:16 portrait from aspect_ratio, ignoring a landscape image_size', () => {
    const view = render(<GenerateImageRow {...rowProps(runningCall(JSON.stringify({
      prompt: '夏日风景',
      aspect_ratio: '9:16',
      image_size: '960x540',
    })))} />)
    expect(screen.getByText('正在生成图片')).toBeTruthy()
    expect(screen.getByText('720 × 1280')).toBeTruthy()
    expect(frameVars(view)).toEqual({ ratio: '720 / 1280', maxW: '300px' })
  })

  it('labels pending image-to-image from use_last_user_image or image', () => {
    render(<GenerateImageRow {...rowProps(runningCall(JSON.stringify({
      prompt: '改成油画',
      use_last_user_image: true,
    })))} />)
    expect(screen.getByText('正在图生图')).toBeTruthy()
    expect(screen.getByText('参考：会话中最近一张用户附件')).toBeTruthy()
    cleanup()
    render(<GenerateImageRow {...rowProps(runningCall(JSON.stringify({
      prompt: '改成水彩',
      image: 'https://example.test/ref.png',
    })))} />)
    expect(screen.getByText('正在图生图')).toBeTruthy()
    expect(screen.getByText('参考：https://example.test/ref.png')).toBeTruthy()
  })

  it('maps a fullwidth 9：16 ratio and a landscape 16:9 ratio', () => {
    const portrait = render(<GenerateImageRow {...rowProps(runningCall('{"aspect_ratio":"9：16","prompt":"p"}'))} />)
    expect(frameVars(portrait)).toEqual({ ratio: '720 / 1280', maxW: '300px' })
    portrait.unmount()
    const landscape = render(<GenerateImageRow {...rowProps(runningCall('{"aspect_ratio":"16:9","prompt":"p"}'))} />)
    expect(frameVars(landscape)).toEqual({ ratio: '1280 / 720', maxW: '520px' })
  })

  it('falls back to image_size or a square when aspect_ratio is missing or unknown', () => {
    const fromSize = render(<GenerateImageRow {...rowProps(runningCall('{"prompt":"p","image_size":"960x540"}'))} />)
    expect(screen.getByText('960 × 540')).toBeTruthy()
    expect(frameVars(fromSize)).toEqual({ ratio: '960 / 540', maxW: '520px' })
    fromSize.unmount()
    const unknown = render(<GenerateImageRow {...rowProps(runningCall('{"prompt":"p","aspect_ratio":"5:7"}'))} />)
    expect(frameVars(unknown)).toEqual({ ratio: '1024 / 1024', maxW: '400px' })
    unknown.unmount()
    const emptySize = render(<GenerateImageRow {...rowProps(runningCall('{"prompt":"p","image_size":"  "}'))} />)
    expect(frameVars(emptySize)).toEqual({ ratio: '1024 / 1024', maxW: '400px' })
  })

  it('uses the raw args as prompt on non-string prompt or invalid JSON', () => {
    render(<GenerateImageRow {...rowProps(runningCall('{"prompt":1}'))} />)
    expect(screen.getByText('“{"prompt":1}”')).toBeTruthy()
    cleanup()
    render(<GenerateImageRow {...rowProps(runningCall('not-json'))} />)
    expect(screen.getByText('“not-json”')).toBeTruthy()
  })

  it('renders the finished image at the meta size, including a preformatted × badge', () => {
    const view = render(<GenerateImageRow {...rowProps(resultNode({
      meta: {
        prompt: '湖景',
        imageSize: '720 × 1280',
        imageUrl: 'https://example.test/a.png',
        imagePath: 'C:\\\\tmp\\\\a.png',
        mode: 'i2i',
        referenceHint: 'ref.png',
        referencePreviewUrl: 'https://example.test/ref.png',
      },
    }))} />)
    expect(screen.getByText('图生图已完成')).toBeTruthy()
    expect(screen.getByRole('img', { name: '湖景' })).toHaveProperty('src', 'https://example.test/a.png')
    expect(screen.getByRole('img', { name: '参考图' })).toHaveProperty('src', 'https://example.test/ref.png')
    expect(screen.getByText('720 × 1280')).toBeTruthy()
    expect(screen.getByText('C:\\\\tmp\\\\a.png')).toBeTruthy()
    expect(frameVars(view)).toEqual({ ratio: '720 / 1280', maxW: '300px' })
  })

  it('shows a text reference hint when there is no preview URL', () => {
    render(<GenerateImageRow {...rowProps(resultNode({
      meta: {
        imageUrl: 'https://example.test/out.png',
        mode: 'i2i',
        referenceHint: 'C:\\\\in.png',
      },
    }))} />)
    expect(screen.getByText('图生图已完成')).toBeTruthy()
    expect(screen.getByText('参考：C:\\\\in.png')).toBeTruthy()
  })

  it('keeps a settled call without a preview URL on the pending canvas', () => {
    render(<GenerateImageRow {...rowProps(resultNode({ meta: { prompt: 'x', imageSize: 'foo' } }))} />)
    expect(screen.getByText('正在生成图片')).toBeTruthy()
    expect(screen.getByText('foo')).toBeTruthy()
  })

  it('omits the path line when meta has a URL but no path', () => {
    render(<GenerateImageRow {...rowProps(resultNode({
      meta: { imageUrl: 'https://example.test/b.png', imagePath: 1 },
    }))} />)
    expect(screen.getByText('图片已生成')).toBeTruthy()
    expect(screen.queryByText(/generated-images/)).toBeNull()
  })

  it('shows the error summary, then the fallback copy when the result has no text', () => {
    render(<GenerateImageRow {...rowProps(resultNode({
      isError: true, content: [{ type: 'text', text: 'Kolors API 400' }],
    }))} />)
    expect(screen.getByText('Kolors API 400')).toBeTruthy()
    cleanup()
    render(<GenerateImageRow {...rowProps(resultNode({ isError: true, content: [] }))} />)
    expect(screen.getByText('图片生成失败')).toBeTruthy()
  })

  it('ignores missing, null, and non-object meta and a window-truncated call', () => {
    render(<GenerateImageRow {...rowProps(resultNode({ meta: undefined }))} />)
    expect(screen.getByText('正在生成图片')).toBeTruthy()
    cleanup()
    render(<GenerateImageRow {...rowProps(resultNode({ meta: null }))} />)
    expect(screen.getByText('正在生成图片')).toBeTruthy()
    cleanup()
    render(<GenerateImageRow {...rowProps(resultNode({ meta: 'nope' }))} />)
    expect(screen.getByText('正在生成图片')).toBeTruthy()
    cleanup()
    render(<GenerateImageRow {...rowProps(resultNode({ call: null, meta: { imageUrl: 1 } }))} />)
    expect(screen.getByText('正在生成图片')).toBeTruthy()
  })

  it('injects the keyed toolview declaration directly', () => {
    expect(generateImageToolview.name).toBe('generate-image-toolview')
    expect(generateImageToolview.inject).toEqual(['slots'])
    const register = vi.fn(() => () => undefined)
    const inject = vi.fn((_name: string, callback: () => () => void) => callback())
    generateImageToolview.apply({ slots: { inject, register } } as never)
    expect(inject).toHaveBeenCalledWith('tool.call.toolview', expect.any(Function))
    expect(register).toHaveBeenCalledWith(
      { name: 'tool.call.toolview', key: 'generate_image', locale: NS },
      GenerateImageRow,
    )
  })
})
