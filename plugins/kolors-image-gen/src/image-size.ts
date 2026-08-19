/**
 * Kolors `image_size` values from SiliconFlow
 * https://api-docs.siliconflow.cn/docs/api/images-generations-post
 */
export const KOLORS_OFFICIAL_SIZES = [
  '1024x1024',
  '960x1280',
  '768x1024',
  '720x1440',
  '720x1280',
] as const

export type KolorsOfficialSize = (typeof KOLORS_OFFICIAL_SIZES)[number]

/** Documented Kolors ratios, plus landscape transposes of the official portrait sizes. */
const RATIO_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '3:4': '960x1280',
  '4:3': '1280x960',
  '9:16': '720x1280',
  '16:9': '1280x720',
  '1:2': '720x1440',
  '2:1': '1440x720',
}

const SIZE_SET = new Set<string>([
  ...KOLORS_OFFICIAL_SIZES,
  '1280x960',
  '1280x720',
  '1440x720',
])

export interface ResolveKolorsImageSizeInput {
  aspectRatio?: string
  imageSize?: string
  prompt?: string
  fallback: string
}

/**
 * Map tool args to a SiliconFlow Kolors size. The chat model often invents
 * pixels such as `960x540` (16:9) when the user asked for 9:16.
 * @param input aspect_ratio, image_size, prompt, and plugin default
 * @returns a widthxheight string to send as `image_size`
 */
export function resolveKolorsImageSize(input: ResolveKolorsImageSizeInput): string {
  const fromAspect = mapRatio(input.aspectRatio)
  if (fromAspect) return fromAspect

  const fromPrompt = detectRatioInPrompt(input.prompt)
  if (fromPrompt) return fromPrompt

  const normalized = input.imageSize?.trim().toLowerCase()
  if (normalized && SIZE_SET.has(normalized)) return normalized

  const parsed = parseWxH(normalized)
  if (parsed) return snapToOfficial(parsed.w, parsed.h)

  return SIZE_SET.has(input.fallback) ? input.fallback : '1024x1024'
}

function mapRatio(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const key = raw.trim().replace(/\s+/g, '').replace('：', ':')
  return RATIO_TO_SIZE[key]
}

function detectRatioInPrompt(prompt: string | undefined): string | undefined {
  if (!prompt) return undefined
  const text = prompt.replace(/：/g, ':')

  if (/9\s*:\s*16/.test(text) || /竖屏|竖版|手机壁纸|portrait/i.test(text)) {
    return RATIO_TO_SIZE['9:16']
  }
  if (/16\s*:\s*9/.test(text) || /横屏|横版|宽屏|landscape/i.test(text)) {
    return RATIO_TO_SIZE['16:9']
  }
  if (/3\s*:\s*4/.test(text)) return RATIO_TO_SIZE['3:4']
  if (/4\s*:\s*3/.test(text)) return RATIO_TO_SIZE['4:3']
  if (/1\s*:\s*2/.test(text)) return RATIO_TO_SIZE['1:2']
  if (/2\s*:\s*1/.test(text)) return RATIO_TO_SIZE['2:1']
  if (/1\s*:\s*1/.test(text) || /方形|正方形|square/i.test(text)) {
    return RATIO_TO_SIZE['1:1']
  }
  return undefined
}

function parseWxH(raw: string | undefined): { w: number; h: number } | undefined {
  if (!raw) return undefined
  const match = /^(\d+)x(\d+)$/i.exec(raw)
  if (!match) return undefined
  return { w: Number(match[1]), h: Number(match[2]) }
}

function snapToOfficial(w: number, h: number): string {
  const ratio = w / h
  let best: string = KOLORS_OFFICIAL_SIZES[0]
  let bestDiff = Number.POSITIVE_INFINITY
  for (const size of SIZE_SET) {
    const parsed = parseWxH(size)
    if (!parsed) continue
    const diff = Math.abs(parsed.w / parsed.h - ratio)
    if (diff < bestDiff) {
      best = size
      bestDiff = diff
    }
  }
  return best
}
