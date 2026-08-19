import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveKolorsImageSize } from './image-size.ts'
import { generateKolorsImage } from './kolors.ts'
import { resolveImageSource, resolveLastUserImage, tryResolveLatestUserMessageImage } from './reference-image.ts'

export const name = 'kolors-image-gen'
export const inject = ['tools', 'systemPrompt']

export interface Config {
  apiKeyEnv: string
  baseURL: string
  model: string
  defaultImageSize: string
  timeoutMs: number
  outputDir: string
}

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().default('SILICONFLOW_API_KEY'),
  baseURL: z.string().default('https://api.siliconflow.cn/v1'),
  model: z.string().default('Kwai-Kolors/Kolors'),
  defaultImageSize: z.string().default('1024x1024'),
  timeoutMs: z.number().default(180_000),
  outputDir: z.string().default(''),
})

async function resolveApiKey(ctx: Context, apiKeyEnv: string): Promise<string> {
  const credentials = ctx.get('credentials')
  if (credentials) {
    const hit = await credentials.resolve(apiKeyEnv)
    if (hit?.value) return hit.value
  }
  const fromEnv = process.env[apiKeyEnv]?.trim()
  if (fromEnv) return fromEnv
  throw new Error(
    `Missing SiliconFlow API key. Set ${apiKeyEnv} in the environment, or store it as credential "${apiKeyEnv}".`,
  )
}

export function apply(ctx: Context, config: Config) {
  const outputDir = config.outputDir || join(homedir(), '.dsh', 'generated-images')

  ctx.systemPrompt.section({
    name: 'kolors-image-gen',
    order: 175,
    text: [
      'You can generate images with the `generate_image` tool (Kwai-Kolors / SiliconFlow).',
      'Text-to-image: pass prompt (+ aspect_ratio) when the user did NOT attach a reference image.',
      'Image-to-image (图生图): when the user attaches an image and asks to restyle / edit / 改成 / 图生图 / 基于这张图, you MUST set use_last_user_image=true (the tool also auto-uses the latest user attachment if you forget).',
      'Or pass image as an http(s) URL or a local file path (including a prior generate_image save path under ~/.dsh/generated-images).',
      'Do not invent image_size pixels. Prefer aspect_ratio. Never invent sizes such as 960x540.',
      'Kolors official sizes: 1024x1024 (1:1), 960x1280 (3:4), 768x1024 (3:4), 720x1440 (1:2), 720x1280 (9:16).',
      'User 9:16 / 竖屏 / 手机壁纸 → aspect_ratio "9:16" → 720x1280. 16:9 → 1280x720.',
      'After success, tell the user the image is ready in this chat card; include the saved file path if useful.',
      'Do not claim an image was generated unless the tool returned successfully.',
    ].join(' '),
  })

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate or restyle an image with Kwai-Kolors/Kolors via SiliconFlow (text-to-image or image-to-image).',
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => false,
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'Text description of the desired image. For img2img, describe the change / target style.',
      },
      aspect_ratio: {
        type: 'string',
        description: 'Required when the user names a ratio. One of 1:1, 9:16, 16:9, 3:4, 4:3, 1:2, 2:1. Never pass pixel sizes.',
      },
      image: {
        type: 'string',
        description: 'Optional reference for image-to-image: http(s) URL or local filesystem path. Prefer use_last_user_image when the user attached a chat image.',
      },
      use_last_user_image: {
        type: 'boolean',
        description: 'When true, use the most recent human-attached image in this session as the SiliconFlow img2img reference.',
      },
      negative_prompt: {
        type: 'string',
        description: 'Optional elements to avoid in the image.',
      },
      seed: {
        type: 'integer',
        description: 'Optional fixed seed for reproducible results.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', required: true },
          imageSize: { type: 'string', required: true },
          imageUrl: { type: 'string', required: true },
          imagePath: { type: 'string', required: true },
          model: { type: 'string', required: true },
          mode: { type: 'string', required: true },
          seed: { type: 'integer' },
          referenceHint: { type: 'string' },
          referencePreviewUrl: { type: 'string' },
        },
      },
      render(_args, value) {
        const lines = [
          value.mode === 'i2i'
            ? `Image-to-image with ${String(value.model)}.`
            : `Generated image with ${String(value.model)}.`,
          `Size: ${String(value.imageSize)}`,
          `Saved to: ${String(value.imagePath)}`,
          `Preview URL (temporary): ${String(value.imageUrl)}`,
        ]
        if (typeof value.referenceHint === 'string') {
          lines.push(`Reference: ${value.referenceHint}`)
        }
        if (value.seed !== undefined) lines.push(`Seed: ${String(value.seed)}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
      presentationMeta(_args, value) {
        return {
          prompt: value.prompt,
          imageSize: value.imageSize,
          imageUrl: value.imageUrl,
          imagePath: value.imagePath,
          model: value.model,
          mode: value.mode,
          ...(typeof value.referenceHint === 'string' ? { referenceHint: value.referenceHint } : {}),
          ...(typeof value.referencePreviewUrl === 'string'
            ? { referencePreviewUrl: value.referencePreviewUrl }
            : {}),
          ...(value.seed !== undefined ? { seed: value.seed } : {}),
        }
      },
    },
    presentCall(args) {
      const size = resolveKolorsImageSize({
        aspectRatio: args.aspect_ratio,
        prompt: args.prompt,
        fallback: config.defaultImageSize,
      })
      const i2i = args.use_last_user_image === true || (typeof args.image === 'string' && args.image.trim() !== '')
      return {
        card: 'generic',
        kind: 'other',
        title: i2i ? 'Image-to-image' : 'Generating image',
        rawInput: args.prompt,
        content: [{ type: 'text', text: `${size}\n${args.prompt}` }],
      }
    },
    presentResult(args, result) {
      const i2i = args.use_last_user_image === true || (typeof args.image === 'string' && args.image.trim() !== '')
      return {
        card: 'generic',
        title: result.isError
          ? 'Image generation failed'
          : i2i ? 'Image-to-image done' : 'Generated image',
      }
    },
    async execute(args, exec) {
      const apiKey = await resolveApiKey(ctx, config.apiKeyEnv)

      let reference: { hint: string; previewUrl?: string } | undefined
      let siliconflowImage: string | undefined
      let sourcePixels: { width: number; height: number } | undefined

      if (args.use_last_user_image === true) {
        const attachments = ctx.get('attachments')
        const agent = exec.agent
        if (!attachments) {
          throw new Error('Attachment store is not available; pass image as a URL or local path instead.')
        }
        if (!agent) {
          throw new Error('No agent session available to read the last user image.')
        }
        const resolved = await resolveLastUserImage(agent.session, attachments, exec.signal)
        siliconflowImage = resolved.siliconflowImage
        reference = {
          hint: resolved.hint,
          ...(resolved.previewUrl !== undefined ? { previewUrl: resolved.previewUrl } : {}),
        }
        if (resolved.width !== undefined && resolved.height !== undefined) {
          sourcePixels = { width: resolved.width, height: resolved.height }
        }
      } else if (typeof args.image === 'string' && args.image.trim() !== '') {
        const resolved = await resolveImageSource(args.image, exec.signal)
        siliconflowImage = resolved.siliconflowImage
        reference = {
          hint: resolved.hint,
          ...(resolved.previewUrl !== undefined ? { previewUrl: resolved.previewUrl } : {}),
        }
      } else if (exec.agent) {
        // Weak models often forget use_last_user_image after a vision upload.
        // If the latest human message carries an image, treat this call as img2img.
        const attachments = ctx.get('attachments')
        if (attachments) {
          const resolved = await tryResolveLatestUserMessageImage(exec.agent.session, attachments, exec.signal)
          if (resolved !== undefined) {
            siliconflowImage = resolved.siliconflowImage
            reference = {
              hint: resolved.hint,
              ...(resolved.previewUrl !== undefined ? { previewUrl: resolved.previewUrl } : {}),
            }
            if (resolved.width !== undefined && resolved.height !== undefined) {
              sourcePixels = { width: resolved.width, height: resolved.height }
            }
          }
        }
      }

      const imageSize = resolveKolorsImageSize({
        aspectRatio: args.aspect_ratio,
        imageSize: sourcePixels !== undefined
          ? `${sourcePixels.width}x${sourcePixels.height}`
          : undefined,
        prompt: args.prompt,
        fallback: config.defaultImageSize,
      })

      return generateKolorsImage({
        apiKey,
        baseURL: config.baseURL,
        model: config.model,
        timeoutMs: config.timeoutMs,
        outputDir,
      }, {
        prompt: args.prompt,
        imageSize,
        ...(siliconflowImage !== undefined ? { image: siliconflowImage } : {}),
        negativePrompt: args.negative_prompt,
        batchSize: 1,
        numInferenceSteps: 20,
        guidanceScale: 7.5,
        seed: args.seed,
        signal: exec.signal,
      }, reference)
    },
  }))
}
