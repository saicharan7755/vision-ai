/**
 * imageProcessor — still-image analysis and annotated export.
 *
 * Owns all canvas work for the Upload flow. Every object URL and canvas it
 * creates is released explicitly; leaking them is what makes repeated
 * uploads balloon memory until the tab dies.
 */
import { EMOTION_META, MAX_IMAGE_BYTES, ACCEPTED_IMAGE_TYPES } from '@/utils/constants'
import { clamp } from '@/utils/geometry'
import { formatAge, formatGender } from '@/utils/formatters'
import { createEmptyScores } from '@/types/emotion'
import type { AnalyzedFace, BoundingBox, DetectedFace } from '@/types/face'
import { detectFaces, loadModels } from './detectionEngine'
import { getDominantEmotion } from './emotionAnalyzer'

export interface LoadedImage {
  element: HTMLImageElement
  url: string
  width: number
  height: number
  name: string
}

export type ImageValidationError = 'type' | 'size' | 'decode'

export interface ImageValidationResult {
  isValid: boolean
  error?: ImageValidationError
  message?: string
}

export function validateImageFile(file: File): ImageValidationResult {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return {
      isValid: false,
      error: 'type',
      message: 'Please choose a JPG, PNG or WEBP image.',
    }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      isValid: false,
      error: 'size',
      message: 'File too large. Maximum size is 10MB.',
    }
  }
  return { isValid: true }
}

/** Decode a file into an <img>. Revokes its own URL on failure. */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  const url = URL.createObjectURL(file)
  const element = new Image()
  element.src = url
  try {
    await element.decode()
  } catch (error) {
    URL.revokeObjectURL(url)
    console.error('[VISION AI] image decode failed', error)
    throw new Error('That image could not be read. It may be corrupted.')
  }
  return {
    element,
    url,
    width: element.naturalWidth,
    height: element.naturalHeight,
    name: file.name,
  }
}

/** Free an image's object URL. Safe to call more than once. */
export function releaseImage(image: LoadedImage | null): void {
  if (!image) return
  URL.revokeObjectURL(image.url)
}

/** Square, padded face crop used as a result thumbnail. */
function createThumbnail(element: HTMLImageElement, box: BoundingBox): string {
  const padX = box.width * 0.3
  const padY = box.height * 0.3
  const sx = clamp(box.x - padX, 0, Math.max(0, element.naturalWidth - 1))
  const sy = clamp(box.y - padY, 0, Math.max(0, element.naturalHeight - 1))
  const sw = clamp(box.width + padX * 2, 1, element.naturalWidth - sx)
  const sh = clamp(box.height + padY * 2, 1, element.naturalHeight - sy)
  const side = Math.min(sw, sh)

  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const context = canvas.getContext('2d')
  if (!context) return ''
  context.drawImage(element, sx + (sw - side) / 2, sy + (sh - side) / 2, side, side, 0, 0, 96, 96)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  // Release the backing buffer immediately.
  canvas.width = 0
  canvas.height = 0
  return dataUrl
}

/** Detect and classify every face in a still image. */
export async function analyzeImage(image: LoadedImage): Promise<AnalyzedFace[]> {
  await loadModels()
  const detections: DetectedFace[] = await detectFaces(image.element, {
    quality: 'balanced',
    withAgeGender: true,
  })
  return detections.map((detection, index) => {
    const dominant = getDominantEmotion(detection.expressions ?? createEmptyScores())
    return {
      ...detection,
      id: index + 1,
      dominant: dominant.emotion,
      confidence: dominant.confidence,
      thumbnailUrl: createThumbnail(image.element, detection.box),
    }
  })
}

/* ── annotated export ───────────────────────────────────────────── */

function traceRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}

/**
 * Render the image with boxes and labels baked in and trigger a download.
 * Resolves once the blob has been handed to the browser.
 */
export async function exportAnnotatedImage(
  image: LoadedImage,
  faces: readonly AnalyzedFace[],
  shouldShowAgeGender: boolean,
): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not render the annotated image.')

  context.drawImage(image.element, 0, 0)
  const scale = clamp(image.width / 1100, 0.85, 2.4)

  for (const face of faces) {
    const meta = EMOTION_META[face.dominant]
    const { x, y, width, height } = face.box

    context.strokeStyle = meta.color
    context.lineWidth = 2.4 * scale
    traceRoundedRect(context, x, y, width, height, 5 * scale)
    context.stroke()

    // person id badge
    context.beginPath()
    context.arc(x, y, 9.5 * scale, 0, Math.PI * 2)
    context.fillStyle = '#FF6B00'
    context.fill()
    context.fillStyle = '#FFFFFF'
    context.font = `700 ${9.5 * scale}px Inter, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(`P${face.id}`, x, y + 0.5)
    context.textAlign = 'left'

    // label pill
    const primaryLabel = `${meta.label} ${Math.round(face.confidence * 100)}%`
    const parts: string[] = []
    if (shouldShowAgeGender) {
      const gender = formatGender(face.gender ?? null)
      const age = formatAge(typeof face.age === 'number' ? face.age : null)
      if (gender) parts.push(gender)
      if (age) parts.push(age)
    }
    const secondaryLabel = parts.join(' · ')

    context.font = `600 ${12 * scale}px Inter, sans-serif`
    const primaryWidth = context.measureText(primaryLabel).width
    context.font = `400 ${11 * scale}px Inter, sans-serif`
    const secondaryWidth = secondaryLabel ? context.measureText(secondaryLabel).width : 0

    const dotRadius = 3 * scale
    const padX = 9 * scale
    const gap = 5.5 * scale
    const pillWidth = padX * 2 + dotRadius * 2 + gap + Math.max(primaryWidth, secondaryWidth)
    const pillHeight = secondaryLabel ? 36 * scale : 22 * scale
    const pillRadius = secondaryLabel ? 8 * scale : pillHeight / 2

    let pillY = y - pillHeight - 7 * scale
    if (pillY < 4) pillY = y + 7 * scale
    const pillX = clamp(x, 2, Math.max(2, image.width - pillWidth - 2))

    traceRoundedRect(context, pillX, pillY, pillWidth, pillHeight, pillRadius)
    context.fillStyle = '#FFFFFF'
    context.fill()
    context.strokeStyle = `${meta.color}AA`
    context.lineWidth = 1.1 * scale
    context.stroke()

    const primaryY = secondaryLabel ? pillY + 12 * scale : pillY + pillHeight / 2
    context.beginPath()
    context.arc(pillX + padX + dotRadius, primaryY, dotRadius, 0, Math.PI * 2)
    context.fillStyle = meta.color
    context.fill()

    context.textBaseline = 'middle'
    context.font = `600 ${12 * scale}px Inter, sans-serif`
    context.fillStyle = '#0F172A'
    context.fillText(primaryLabel, pillX + padX + dotRadius * 2 + gap, primaryY + 0.5)

    if (secondaryLabel) {
      context.font = `400 ${11 * scale}px Inter, sans-serif`
      context.fillStyle = '#64748B'
      context.fillText(secondaryLabel, pillX + padX + dotRadius * 2 + gap, pillY + 25 * scale)
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })

  // Release the (potentially very large) canvas buffer right away.
  canvas.width = 0
  canvas.height = 0

  if (!blob) throw new Error('Could not render the annotated image.')

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${image.name.replace(/\.\w+$/, '') || 'vision'}-annotated.png`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
