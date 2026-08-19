import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface KolorsGenerateRequest {
  prompt: string
  imageSize: string
  /** SiliconFlow img2img source: http(s) URL or data URL. */
  image?: string
  negativePrompt?: string
  batchSize: number
  numInferenceSteps: number
  guidanceScale: number
  seed?: number
  signal: AbortSignal
}

export interface KolorsGenerateResult {
  prompt: string
  imageSize: string
  imageUrl: string
  imagePath: string
  seed?: number
  model: string
  /** Whether this call used SiliconFlow img2img (`image` field). */
  mode: 't2i' | 'i2i'
  /** Short replay-safe description of the reference image. */
  referenceHint?: string
  /** Remote reference URL when available for card preview. */
  referencePreviewUrl?: string
}

export interface KolorsClientOptions {
  apiKey: string
  baseURL: string
  model: string
  timeoutMs: number
  outputDir: string
}

interface SiliconFlowImageResponse {
  images?: Array<{ url?: string }>
  data?: Array<{ url?: string }>
  seed?: number
}

/**
 * Call SiliconFlow images/generations for Kwai-Kolors and persist one local copy.
 */
export async function generateKolorsImage(
  options: KolorsClientOptions,
  request: KolorsGenerateRequest,
  reference?: { hint: string; previewUrl?: string },
): Promise<KolorsGenerateResult> {
  const endpoint = `${options.baseURL.replace(/\/$/, '')}/images/generations`
  const body: Record<string, unknown> = {
    model: options.model,
    prompt: request.prompt,
    image_size: request.imageSize,
    batch_size: request.batchSize,
    num_inference_steps: request.numInferenceSteps,
    guidance_scale: request.guidanceScale,
  }
  if (request.negativePrompt) body.negative_prompt = request.negativePrompt
  if (request.seed !== undefined) body.seed = request.seed
  if (request.image) body.image = request.image

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: request.signal,
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Kolors API ${response.status}: ${detail.slice(0, 500) || response.statusText}`)
  }

  const payload = await response.json() as SiliconFlowImageResponse
  const imageUrl = payload.images?.[0]?.url ?? payload.data?.[0]?.url
  if (!imageUrl) throw new Error('Kolors API returned no image URL')

  await mkdir(options.outputDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const imagePath = join(options.outputDir, `kolors-${stamp}.png`)
  const bytes = await downloadImage(imageUrl, request.signal)
  await writeFile(imagePath, bytes)

  const mode = request.image ? 'i2i' as const : 't2i' as const
  return {
    prompt: request.prompt,
    imageSize: request.imageSize,
    imageUrl,
    imagePath,
    ...(payload.seed !== undefined ? { seed: payload.seed } : {}),
    model: options.model,
    mode,
    ...(reference?.hint !== undefined ? { referenceHint: reference.hint } : {}),
    ...(reference?.previewUrl !== undefined ? { referencePreviewUrl: reference.previewUrl } : {}),
  }
}

async function downloadImage(url: string, signal: AbortSignal): Promise<Buffer> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Failed to download generated image (${response.status})`)
  }
  return Buffer.from(await response.arrayBuffer())
}
