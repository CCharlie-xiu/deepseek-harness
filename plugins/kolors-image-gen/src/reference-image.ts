import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export interface ResolvedReferenceImage {
  /** Value for SiliconFlow `image` (http(s) URL or data URL). */
  siliconflowImage: string
  /** Short replay-safe hint for UI / model text (never a huge data URL). */
  hint: string
  /** HTTP(S) URL when the source is already remote (safe for card preview). */
  previewUrl?: string
  /** Intrinsic pixels when loaded from an attachment. */
  width?: number
  height?: number
}

/**
 * Resolve a model-supplied image source into a SiliconFlow `image` value.
 * @param source http(s) URL, data URL, or local filesystem path
 * @param signal abort for file / attachment reads
 */
export async function resolveImageSource(
  source: string,
  signal: AbortSignal,
): Promise<ResolvedReferenceImage> {
  const trimmed = source.trim()
  if (trimmed === '') throw new Error('image is empty')

  if (/^https?:\/\//i.test(trimmed)) {
    return { siliconflowImage: trimmed, hint: trimmed, previewUrl: trimmed }
  }

  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
    return { siliconflowImage: trimmed, hint: 'inline base64 image' }
  }

  const bytes = await readFile(trimmed, { signal })
  const mediaType = detectMediaType(bytes, trimmed)
  return {
    siliconflowImage: `data:${mediaType};base64,${bytes.toString('base64')}`,
    hint: trimmed,
  }
}

/**
 * Load the most recent human-uploaded image from the session log.
 * @param session live agent session
 * @param attachments attachment store
 * @param signal abort for the attachment read
 */
export async function resolveLastUserImage(
  session: Session,
  attachments: AttachmentStore,
  signal: AbortSignal,
): Promise<ResolvedReferenceImage> {
  const resolved = await tryResolveLastUserImage(session, attachments, signal)
  if (resolved === undefined) {
    throw new Error(
      'No user-attached image found in this session. Attach an image in chat, or pass image as a URL / local path.',
    )
  }
  return resolved
}

/**
 * Like {@link resolveLastUserImage}, but only if the tip human message itself
 * carries an image (used for auto img2img when the model forgets the flag).
 * @param session live agent session
 * @param attachments attachment store
 * @param signal abort for the attachment read
 */
export async function tryResolveLatestUserMessageImage(
  session: Session,
  attachments: AttachmentStore,
  signal: AbortSignal,
): Promise<ResolvedReferenceImage | undefined> {
  const ref = findLatestUserMessageImageRef(session)
  if (ref === undefined) return undefined
  const stored = await attachments.readImage(ref, signal)
  return {
    siliconflowImage: `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`,
    hint: stored.ref.name ?? `attachment ${String(stored.ref.attachmentId)}`,
    width: stored.ref.width,
    height: stored.ref.height,
  }
}

/**
 * Like {@link resolveLastUserImage}, but returns undefined when none exists.
 * @param session live agent session
 * @param attachments attachment store
 * @param signal abort for the attachment read
 */
export async function tryResolveLastUserImage(
  session: Session,
  attachments: AttachmentStore,
  signal: AbortSignal,
): Promise<ResolvedReferenceImage | undefined> {
  const ref = findLastUserImageRef(session)
  if (ref === undefined) return undefined
  const stored = await attachments.readImage(ref, signal)
  return {
    siliconflowImage: `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`,
    hint: stored.ref.name ?? `attachment ${String(stored.ref.attachmentId)}`,
    width: stored.ref.width,
    height: stored.ref.height,
  }
}

function findLatestUserMessageImageRef(session: Session): ImageAttachmentRef | undefined {
  for (let i = session.events.length - 1; i >= 0; i -= 1) {
    const event = session.events[i]
    if (event?.type !== 'user/message') continue
    if (event.data.source.kind !== 'user') continue
    return firstImageRef(event.data.content)
  }
  return undefined
}

function findLastUserImageRef(session: Session): ImageAttachmentRef | undefined {
  for (let i = session.events.length - 1; i >= 0; i -= 1) {
    const event = session.events[i]
    if (event?.type !== 'user/message') continue
    if (event.data.source.kind !== 'user') continue
    const hit = firstImageRef(event.data.content)
    if (hit !== undefined) return hit
  }
  return undefined
}

function firstImageRef(content: readonly ContentBlock[]): ImageAttachmentRef | undefined {
  for (const block of content) {
    if (block.type === 'image') return block.attachment
  }
  return undefined
}

function detectMediaType(bytes: Buffer, pathHint: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes.length >= 6
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif'
  }
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }

  switch (extname(pathHint).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.png':
    default:
      return 'image/png'
  }
}
