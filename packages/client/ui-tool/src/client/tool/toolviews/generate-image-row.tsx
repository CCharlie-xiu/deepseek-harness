// generate_image toolview: AIcss-style shimmer canvas while generating,
// then the SiliconFlow preview URL once the call settles.
// @see https://www.aicss.dev/components/image-generation

import type { CSSProperties } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import css from './GenerateImageCard.module.css'

type GenerateImageRowProps = ToolCallViewProps & PropsLocale<'conversation'>

interface ImageGenMeta {
  prompt?: string
  imageSize?: string
  imageUrl?: string
  imagePath?: string
  model?: string
  mode?: string
  referenceHint?: string
  referencePreviewUrl?: string
  seed?: number
}

const ASPECT_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '9:16': '720x1280',
  '16:9': '1280x720',
  '3:4': '960x1280',
  '4:3': '1280x960',
  '1:2': '720x1440',
  '2:1': '1440x720',
}

function parsePrompt(argsRaw: string): {
  prompt: string
  imageSize: string
  mode: 't2i' | 'i2i'
  referenceHint?: string
} {
  try {
    const parsed = JSON.parse(argsRaw) as {
      prompt?: unknown
      image_size?: unknown
      aspect_ratio?: unknown
      image?: unknown
      use_last_user_image?: unknown
    }
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt : argsRaw
    const useLast = parsed.use_last_user_image === true
    const image = typeof parsed.image === 'string' ? parsed.image.trim() : ''
    const mode: 't2i' | 'i2i' = useLast || image !== '' ? 'i2i' : 't2i'
    const referenceHint = useLast
      ? '会话中最近一张用户附件'
      : image !== '' ? image : undefined

    if (typeof parsed.aspect_ratio === 'string') {
      const key = parsed.aspect_ratio.trim().replaceAll('：', ':').replaceAll(/\s+/g, '')
      const mapped = ASPECT_TO_SIZE[key]
      if (mapped !== undefined) {
        return {
          prompt,
          imageSize: mapped,
          mode,
          ...(referenceHint !== undefined ? { referenceHint } : {}),
        }
      }
    }
    if (typeof parsed.image_size === 'string' && parsed.image_size.trim() !== '') {
      return {
        prompt,
        imageSize: parsed.image_size,
        mode,
        ...(referenceHint !== undefined ? { referenceHint } : {}),
      }
    }
    return {
      prompt,
      imageSize: '1024x1024',
      mode,
      ...(referenceHint !== undefined ? { referenceHint } : {}),
    }
  } catch {
    return { prompt: argsRaw, imageSize: '1024x1024', mode: 't2i' }
  }
}

function formatSize(size: string): string {
  return size.includes('×') ? size : size.replace(/x/i, ' × ')
}

function parseWxH(size: string): { w: number; h: number } {
  const match = /(\d+)\s*[x×]\s*(\d+)/i.exec(size)
  if (match === null) return { w: 1, h: 1 }
  return { w: Number(match[1]), h: Number(match[2]) }
}

function frameStyle(size: string): CSSProperties {
  const { w, h } = parseWxH(size)
  const maxW = h > w ? 300 : w > h ? 520 : 400
  return {
    '--ig-ratio': `${w} / ${h}`,
    '--ig-max-w': `${maxW}px`,
  } as CSSProperties
}

function readMeta(block: GenerateImageRowProps['block']): ImageGenMeta | null {
  if (!('meta' in block) || block.meta === undefined || block.meta === null) return null
  if (typeof block.meta !== 'object') return null
  return block.meta as ImageGenMeta
}

function ImageGenerationPending({
  prompt,
  resolution,
  size,
  mode,
  referenceHint,
}: {
  prompt: string
  resolution: string
  size: string
  mode: 't2i' | 'i2i'
  referenceHint?: string
}) {
  return (
    <div className={css.igWrap} style={frameStyle(size)}>
      <div className={css.igCanvas} role="img" aria-label={mode === 'i2i' ? '正在图生图' : '正在生成图片'}>
        <span className={css.igDots} aria-hidden />
        <span className={css.igGlow} aria-hidden />
        <span className={css.igRes}>{resolution}</span>
      </div>
      <div className={css.igMeta}>
        <span className={css.igLabel}>{mode === 'i2i' ? '正在图生图' : '正在生成图片'}</span>
        {referenceHint ? <span className={css.igRef}>参考：{referenceHint}</span> : null}
        <span className={css.igPrompt}>“{prompt}”</span>
      </div>
    </div>
  )
}

function ImageGenerationDone({
  prompt,
  resolution,
  imageUrl,
  imagePath,
  size,
  mode,
  referenceHint,
  referencePreviewUrl,
}: {
  prompt: string
  resolution: string
  imageUrl: string
  imagePath?: string
  size: string
  mode: 't2i' | 'i2i'
  referenceHint?: string
  referencePreviewUrl?: string
}) {
  return (
    <div className={css.igWrap} style={frameStyle(size)}>
      <a className={css.igResult} href={imageUrl} target="_blank" rel="noreferrer">
        <img className={css.igImage} src={imageUrl} alt={prompt} />
        <span className={css.igRes}>{resolution}</span>
      </a>
      <div className={css.igMeta}>
        <span className={css.igDoneLabel}>{mode === 'i2i' ? '图生图已完成' : '图片已生成'}</span>
        {referencePreviewUrl ? (
          <a className={css.igRefThumb} href={referencePreviewUrl} target="_blank" rel="noreferrer">
            <img src={referencePreviewUrl} alt="参考图" />
            <span>参考图</span>
          </a>
        ) : referenceHint ? (
          <span className={css.igRef}>参考：{referenceHint}</span>
        ) : null}
        <span className={css.igPrompt}>“{prompt}”</span>
        {imagePath ? <span className={css.igPath}>{imagePath}</span> : null}
      </div>
    </div>
  )
}

/** Keyed toolview for `generate_image`: shimmer while running, image when settled. */
export function GenerateImageRow({ toolName, block }: GenerateImageRowProps) {
  const model = toolRowModel(toolName, block)
  const argsRaw = 'argsRaw' in block
    ? block.argsRaw
    : (block.call?.argsRaw ?? '')
  const pending = parsePrompt(argsRaw)
  const meta = readMeta(block)
  const prompt = meta?.prompt ?? pending.prompt
  const imageUrl = typeof meta?.imageUrl === 'string' ? meta.imageUrl : undefined
  const size = meta?.imageSize ?? pending.imageSize
  const resolution = formatSize(size)
  const mode: 't2i' | 'i2i' = meta?.mode === 'i2i' || pending.mode === 'i2i' ? 'i2i' : 't2i'
  const referenceHint = typeof meta?.referenceHint === 'string'
    ? meta.referenceHint
    : pending.referenceHint
  const referencePreviewUrl = typeof meta?.referencePreviewUrl === 'string'
    ? meta.referencePreviewUrl
    : undefined

  if (model.state === 'error') {
    return (
      <div className={css.igWrap}>
        <div className={css.igMeta}>
          <span className={css.igError}>{model.errorSummary ?? '图片生成失败'}</span>
          <span className={css.igPrompt}>“{prompt}”</span>
        </div>
      </div>
    )
  }

  if (model.state === 'running' || imageUrl === undefined) {
    return (
      <ImageGenerationPending
        prompt={prompt}
        resolution={resolution}
        size={size}
        mode={mode}
        {...referenceHint !== undefined ? { referenceHint } : {}}
      />
    )
  }

  const imagePath = typeof meta?.imagePath === 'string' ? meta.imagePath : undefined
  return (
    <ImageGenerationDone
      prompt={prompt}
      resolution={resolution}
      imageUrl={imageUrl}
      size={size}
      mode={mode}
      {...imagePath !== undefined ? { imagePath } : {}}
      {...referenceHint !== undefined ? { referenceHint } : {}}
      {...referencePreviewUrl !== undefined ? { referencePreviewUrl } : {}}
    />
  )
}

/** Register the generate_image keyed toolview hole. */
export const generateImageToolview = {
  name: 'generate-image-toolview',
  inject: ['slots'],
  /**
   * @param ctx - registrant context.
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key: 'generate_image', locale: NS },
      GenerateImageRow,
    ))
  },
}
