/**
 * facePreprocessor.ts
 *
 * Spatial preprocessing for the emotion classifier. Raw detector boxes are
 * tight, axis-aligned and unlit-corrected, which is the dominant source of
 * emotion misclassification: chins and mouth corners fall outside the crop,
 * tilted heads present rotated features, and dark rooms flatten the very
 * contrast the classifier keys on.
 *
 * This module produces a padded, eye-levelled, contrast-normalized crop on
 * a pooled canvas. Canvases are reused across frames — allocating one per
 * face per frame would hand the GC a steady stream of large buffers and
 * cause exactly the micro-stutter this pipeline is trying to eliminate.
 */
import type { BoundingBox } from '@/types/face'
import { getPerformancePreset } from '@/utils/hardware'
import { useSettingsStore } from '@/store/settingsStore'
import {
  CROP_PADDING_RATIO,
  FACE_CROP_SIZE,
  LUMINANCE_DARK,
  LUMINANCE_BRIGHT,
  HISTOGRAM_CLIP_LIMIT,
} from '@/utils/constants'

/** Minimal eye geometry, kept library-agnostic on purpose. */
export interface EyeCenters {
  left: { x: number; y: number }
  right: { x: number; y: number }
}

export interface PreparedFace {
  /** Pooled canvas holding the aligned crop. Valid until the next frame. */
  canvas: HTMLCanvasElement
  /** Mean luminance of the face region, 0–255. */
  luminance: number
  /** True when contrast equalization was applied. */
  wasEnhanced: boolean
  /** Eye-levelling rotation applied, in radians. */
  rotationRad: number
}

/**
 * Contrast-equalization switch. Disabled on low-end hardware by the
 * adaptive preset — it costs 1–2 ms per poorly-lit face, which a 10 FPS
 * detection budget cannot spare.
 */
let isContrastEqualizationEnabled = getPerformancePreset().enableCLAHE

/** Enable/disable equalization at runtime (preset changes). */
export function setContrastEqualizationEnabled(isEnabled: boolean): void {
  isContrastEqualizationEnabled = isEnabled
}

/** Reused crop canvases, indexed by face slot. */
const canvasPool: HTMLCanvasElement[] = []

function getPooledCanvas(slot: number): HTMLCanvasElement {
  let canvas = canvasPool[slot]
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = FACE_CROP_SIZE
    canvas.height = FACE_CROP_SIZE
    canvasPool[slot] = canvas
  }
  return canvas
}

/** Release pooled canvases (called on engine teardown). */
export function releaseCropPool(): void {
  for (const canvas of canvasPool) {
    canvas.width = 0
    canvas.height = 0
  }
  canvasPool.length = 0
}

/**
 * Crop inspector — the visual debugger required by the diagnostics
 * directive. When a canvas is registered, every crop prepared for slot 0
 * (the primary/largest face) is copied onto it AFTER padding, rotation and
 * contrast correction, so the canvas shows EXACTLY what the model receives.
 *
 * Note the preview is deliberately NOT mirrored even when the video preview
 * is: the classifier sees the raw camera frame, and the point of the
 * debugger is to show the model's actual input.
 */
let cropInspector: HTMLCanvasElement | null = null

/** Register (or clear) the debug preview canvas. */
export function setCropInspector(canvas: HTMLCanvasElement | null): void {
  cropInspector = canvas
}

/**
 * Tilt of the eye line; 0 when the eyes are level.
 *
 * CRITICAL: the eye line is a LINE, not a ray. face-api's getLeftEye()/
 * getRightEye() use the ANATOMICAL convention, so in the raw (unmirrored)
 * camera frame the subject's left eye sits at LARGER image x — a level
 * face makes (right.x − left.x) NEGATIVE and atan2 return ≈ ±π. Rotating
 * by that would turn every frontal crop 180° and feed the model an
 * upside-down face. Normalizing into (−π/2, π/2] makes a horizontal eye
 * line 0 under EITHER landmark convention, and a ±20° head tilt ±20°.
 */
export function getEyeTilt(eyes: EyeCenters): number {
  const raw = Math.atan2(eyes.right.y - eyes.left.y, eyes.right.x - eyes.left.x)
  if (raw > Math.PI / 2) return raw - Math.PI
  if (raw <= -Math.PI / 2) return raw + Math.PI
  return raw
}

/**
 * Clip-limited global histogram equalization over luminance.
 *
 * This is intentionally NOT tile-based CLAHE: a per-tile implementation
 * costs several milliseconds per face in JS and would eat the frame budget
 * this pipeline is trying to protect. Clipping the histogram before
 * equalizing captures most of CLAHE's benefit (it prevents the noise
 * amplification that plain equalization causes in flat, dark regions) at a
 * fraction of the cost.
 *
 * Colour is preserved by scaling each channel toward its new luminance
 * rather than writing a grayscale image back.
 */
function equalizeContrast(imageData: ImageData): void {
  const { data } = imageData
  const pixelCount = data.length / 4

  const histogram = new Uint32Array(256)
  const luminance = new Uint8Array(pixelCount)

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const value =
      0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)
    const level = value < 0 ? 0 : value > 255 ? 255 : Math.round(value)
    luminance[p] = level
    histogram[level] = (histogram[level] ?? 0) + 1
  }

  // Clip tall bins and redistribute the excess uniformly.
  const clipHeight = Math.max(1, Math.floor((pixelCount / 256) * HISTOGRAM_CLIP_LIMIT))
  let excess = 0
  for (let level = 0; level < 256; level += 1) {
    const count = histogram[level] ?? 0
    if (count > clipHeight) {
      excess += count - clipHeight
      histogram[level] = clipHeight
    }
  }
  const bonus = Math.floor(excess / 256)
  for (let level = 0; level < 256; level += 1) {
    histogram[level] = (histogram[level] ?? 0) + bonus
  }

  // Cumulative distribution → lookup table.
  const lut = new Uint8Array(256)
  let cumulative = 0
  const total = pixelCount || 1
  for (let level = 0; level < 256; level += 1) {
    cumulative += histogram[level] ?? 0
    lut[level] = Math.min(255, Math.round((cumulative / total) * 255))
  }

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const original = luminance[p] ?? 0
    const mapped = lut[original] ?? original
    if (original === mapped) continue
    // Scale channels proportionally so hue survives the correction.
    const factor = mapped / Math.max(1, original)
    const r = (data[i] ?? 0) * factor
    const g = (data[i + 1] ?? 0) * factor
    const b = (data[i + 2] ?? 0) * factor
    data[i] = r > 255 ? 255 : r
    data[i + 1] = g > 255 ? 255 : g
    data[i + 2] = b > 255 ? 255 : b
  }
}

/** Mean luminance (ITU-R 601) of an RGBA buffer, 0–255. */
function measureMeanLuminance(data: Uint8ClampedArray): number {
  let sum = 0
  const pixelCount = data.length / 4
  if (pixelCount === 0) return 0
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)
  }
  return sum / pixelCount
}

export interface PrepareOptions {
  /** Pool slot, so concurrent faces don't share a canvas. */
  slot: number
  /** Eye centres in SOURCE coordinates; omit to skip rotation. */
  eyes?: EyeCenters
  /** Disable contrast correction (used for already-normalized stills). */
  shouldEqualize?: boolean
}

/**
 * Produce an aligned, padded, contrast-corrected square crop ready for the
 * expression / age-gender nets.
 *
 * @param source  Frame to sample from (video, image or canvas).
 * @param box     Detection box in source coordinates.
 * @param frameWidth  Source width, for clamping the padded box.
 * @param frameHeight Source height, for clamping the padded box.
 * @param options Pool slot, optional eye centres, equalization switch.
 * @returns Pooled canvas plus the luminance/enhancement metadata, or null
 *          when the crop would be degenerate.
 */
export function prepareFaceCrop(
  source: CanvasImageSource,
  box: BoundingBox,
  frameWidth: number,
  frameHeight: number,
  options: PrepareOptions,
): PreparedFace | null {
  if (box.width < 8 || box.height < 8) return null

  const canvas = getPooledCanvas(options.slot)
  const context = canvas.getContext('2d', {
    alpha: false,
    willReadFrequently: true,
    // Explicit sRGB: without it the browser may tag the canvas with the
    // display's colour profile, so the pixels handed to getImageData (and
    // therefore the tensor) shift subtly versus what the model was trained on.
    colorSpace: 'srgb',
  })
  if (!context) return null

  /*
   * High-quality bilinear filtering for the (often large) downscale into
   * 224×224 — the canvas default ('low') uses a cheaper kernel that loses
   * fine expression detail (mouth corners, brow tension).
   *
   * NOTE: deliberately NOT disabled. The colour-space guidance suggests
   * `imageSmoothingEnabled = false` to avoid a "YUV→RGB matrix shift", but
   * that flag controls the RESAMPLING FILTER, not colour conversion — the
   * YUV→RGB step happens during decode, before this canvas sees anything.
   * Disabling it here would switch the 1920×1080 → 224×224 downscale to
   * nearest-neighbour, aliasing away mouth-corner and brow detail, which is
   * precisely the expression signal the classifier depends on.
   */
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  /*
   * ANIMATED-CONTENT MODE
   *
   * AffectNet models were trained on photographs. Cartoon faces have flat
   * colour regions and no skin texture, so the CNN keys instead on the line
   * art around eyes and mouth — and a plain drawImage renders those lines
   * too softly for the model to latch onto. A modest contrast/saturation
   * boost accentuates the line art without moving the image far off the
   * training distribution.
   *
   * Gated on an explicit user setting rather than auto-detection, because
   * applying it to a photographic face would perturb the input the model
   * was trained on and silently change real-video results.
   *
   * `ctx.filter` is unsupported in Safari < 16.4, where it is ignored —
   * an acceptable degradation, not a failure.
   */
  if (useSettingsStore.getState().isAnimatedContent) {
    context.filter = 'contrast(1.25) saturate(1.15)'
  }

  const rotationRad = options.eyes ? getEyeTilt(options.eyes) : 0

  /*
   * Rotating a square sample into a square canvas leaves empty wedges in
   * the corners — at a 20° tilt roughly a quarter of each corner is blank,
   * and those hard black triangles are themselves out-of-distribution
   * input. Sampling a region enlarged by (|cos| + |sin|) and drawing it to
   * a correspondingly enlarged destination fills those corners with real
   * pixels while keeping the face at exactly the same scale in the output
   * (the source→destination ratio is unchanged); the surplus is clipped by
   * the canvas bounds.
   */
  const coverage =
    rotationRad === 0 ? 1 : Math.abs(Math.cos(rotationRad)) + Math.abs(Math.sin(rotationRad))

  /*
   * SQUARE sampling. The naive padded box (w·1.3 × h·1.3) is not square,
   * and drawing a non-square source region into the square 224×224 canvas
   * squashes the face — for a typical 140×180 detection box that is ~22%
   * horizontal compression, and clamping at frame edges distorts further.
   * AffectNet crops are uniformly scaled, so distortion is an
   * out-of-distribution input. Instead: take the LARGER box dimension,
   * expand it by the padding ratio on both sides, and sample that square.
   */
  const boxSide = Math.max(box.width, box.height)
  const side = Math.min(
    Math.max(boxSide * (1 + CROP_PADDING_RATIO * 2), 8),
    Math.min(frameWidth, frameHeight),
  )
  const half = side / 2
  // Clamp the square's CENTER, not its edges: clamping edges would shrink
  // one dimension and re-introduce the squash. A face at the frame edge
  // gets a slightly off-centre crop instead of a distorted one.
  const boxCenterX = box.x + box.width / 2
  const boxCenterY = box.y + box.height / 2
  const centerX = Math.min(Math.max(boxCenterX, half), Math.max(frameWidth - half, half))
  const centerY = Math.min(Math.max(boxCenterY, half), Math.max(frameHeight - half, half))

  const sampleSide = side * coverage
  const destinationSize = FACE_CROP_SIZE * coverage

  context.save()
  context.translate(FACE_CROP_SIZE / 2, FACE_CROP_SIZE / 2)
  // Counter-rotate so the eye line ends up horizontal.
  if (rotationRad !== 0) context.rotate(-rotationRad)
  context.drawImage(
    source,
    centerX - sampleSide / 2,
    centerY - sampleSide / 2,
    sampleSide,
    sampleSide,
    -destinationSize / 2,
    -destinationSize / 2,
    destinationSize,
    destinationSize,
  )
  context.restore()

  const imageData = context.getImageData(0, 0, FACE_CROP_SIZE, FACE_CROP_SIZE)
  const luminance = measureMeanLuminance(imageData.data)

  let wasEnhanced = false
  const isPoorlyLit = luminance < LUMINANCE_DARK || luminance > LUMINANCE_BRIGHT
  if (isPoorlyLit && isContrastEqualizationEnabled && options.shouldEqualize !== false) {
    equalizeContrast(imageData)
    context.putImageData(imageData, 0, 0)
    wasEnhanced = true
  }

  // Debug preview: copied AFTER equalization so the inspector shows the
  // true model input, CLAHE included. Slot 0 only — the largest face.
  if (cropInspector && options.slot === 0) {
    cropInspector.getContext('2d')?.drawImage(canvas, 0, 0)
  }

  return { canvas, luminance, wasEnhanced, rotationRad }
}
