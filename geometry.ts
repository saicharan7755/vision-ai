/**
 * Pure box geometry: IoU, distance, non-maximum suppression and the
 * video→DOM coordinate mapping used by the overlay.
 */
import type { BoundingBox, DetectedFace } from '@/types/face'
import { NMS_IOU_THRESHOLD } from './constants'

export function getCenter(box: BoundingBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export function getArea(box: BoundingBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height)
}

/** Intersection over union, 0..1. */
export function getIoU(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = getArea(a) + getArea(b) - intersection
  return union > 0 ? intersection / union : 0
}

export function getCentroidDistance(a: BoundingBox, b: BoundingBox): number {
  const ca = getCenter(a)
  const cb = getCenter(b)
  return Math.hypot(ca.x - cb.x, ca.y - cb.y)
}

/**
 * Non-maximum suppression.
 * Detectors sometimes emit two boxes for one face; keep the higher-scoring
 * box whenever a pair overlaps beyond the IoU threshold.
 */
export function applyNMS(
  faces: DetectedFace[],
  iouThreshold: number = NMS_IOU_THRESHOLD,
): DetectedFace[] {
  const sorted = [...faces].sort((a, b) => b.detectionScore - a.detectionScore)
  const kept: DetectedFace[] = []
  for (const candidate of sorted) {
    const isDuplicate = kept.some((k) => getIoU(k.box, candidate.box) > iouThreshold)
    if (!isDuplicate) kept.push(candidate)
  }
  return kept
}

export interface RenderedBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Map a source-pixel box onto a container that renders the video with
 * `object-fit: cover`, optionally mirrored.
 *
 * `cover` scales by the LARGER ratio and center-crops the overflow, so the
 * letterbox offset can be negative — this is the usual cause of "boxes are
 * offset by a fixed amount" bugs.
 */
export function mapBoxToContainer(
  box: BoundingBox,
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number,
  isMirrored: boolean,
): RenderedBox | null {
  if (!sourceWidth || !sourceHeight || !containerWidth || !containerHeight) return null
  const scale = Math.max(containerWidth / sourceWidth, containerHeight / sourceHeight)
  const offsetX = (containerWidth - sourceWidth * scale) / 2
  const offsetY = (containerHeight - sourceHeight * scale) / 2
  const x = isMirrored ? sourceWidth - box.x - box.width : box.x
  return {
    left: offsetX + x * scale,
    top: offsetY + box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
  }
}

/** Convert an absolute box into container-relative percentages. */
export function boxToPercent(
  box: BoundingBox,
  sourceWidth: number,
  sourceHeight: number,
): { left: string; top: string; width: string; height: string } {
  return {
    left: `${(box.x / sourceWidth) * 100}%`,
    top: `${(box.y / sourceHeight) * 100}%`,
    width: `${(box.width / sourceWidth) * 100}%`,
    height: `${(box.height / sourceHeight) * 100}%`,
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/* ── Oriented bounding box (landmark-anchored) ──────────────────── */

/**
 * A face box that rotates with head roll. Unlike an axis-aligned box it
 * stays tightly contoured when the head tilts, instead of ballooning to
 * contain the rotated face.
 */
export interface OrientedBox {
  /** Centre in source-frame pixels. */
  readonly centerX: number
  readonly centerY: number
  readonly width: number
  readonly height: number
  /** Roll angle in radians; 0 when the eye line is horizontal. */
  readonly angle: number
}

interface Point2D {
  x: number
  y: number
}

/**
 * iBUG-68 indices for the facial hull.
 *
 * The design references MediaPipe 468-mesh indices (p10 forehead, p152
 * chin, p234/p454 cheeks); those semantic roles map onto the 68-point
 * model as below. One genuine difference: iBUG-68 has NO forehead points —
 * the jaw outline runs ear-to-ear and the brows are the topmost features —
 * so the hull's top edge is extrapolated upward (see OBB_FOREHEAD_EXTENSION)
 * rather than measured.
 */
const JAW_START = 0 // p234 equivalent — left cheek boundary
const JAW_END = 16 // p454 equivalent — right cheek boundary
const CHIN_TIP = 8 // p152 equivalent
const BROW_START = 17
const BROW_END = 26
const RIGHT_EYE_RANGE: readonly [number, number] = [36, 41]
const LEFT_EYE_RANGE: readonly [number, number] = [42, 47]

function meanPoint(points: readonly Point2D[]): Point2D | null {
  if (points.length === 0) return null
  let x = 0
  let y = 0
  for (const p of points) {
    x += p.x
    y += p.y
  }
  return { x: x / points.length, y: y / points.length }
}

function sliceRange(
  points: readonly Point2D[],
  [start, end]: readonly [number, number],
): Point2D[] {
  const out: Point2D[] = []
  for (let i = start; i <= end; i += 1) {
    const p = points[i]
    if (p) out.push(p)
  }
  return out
}

/** Rotate a point around a centre by `angle` radians. */
function rotateAround(point: Point2D, cx: number, cy: number, angle: number): Point2D {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = point.x - cx
  const dy = point.y - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

/**
 * Compute an oriented bounding box from a 68-point landmark set.
 *
 * Method: measure the head's roll from the eye line, rotate the facial
 * hull flat, take the axis-aligned extent in that rotated frame, then
 * carry the angle back out. The resulting box hugs the face at any tilt,
 * where an axis-aligned box would have to grow to contain the same points.
 *
 * @returns null when the landmark set is missing or degenerate, in which
 *          case callers fall back to the detector's axis-aligned box.
 */
export function computeOrientedBox(
  points: readonly Point2D[],
  widthMargin: number,
  heightMargin: number,
  foreheadExtension: number,
): OrientedBox | null {
  if (points.length < 68) return null

  const rightEye = meanPoint(sliceRange(points, RIGHT_EYE_RANGE))
  const leftEye = meanPoint(sliceRange(points, LEFT_EYE_RANGE))
  const chin = points[CHIN_TIP]
  if (!rightEye || !leftEye || !chin) return null

  // ── roll angle from the eye line ──
  // Normalized into (−π/2, π/2]: the eye line is a LINE, not a ray, so a
  // level face must read 0 regardless of which eye the landmark model
  // labels "left" (anatomical vs. image convention).
  let angle = Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x)
  if (angle > Math.PI / 2) angle -= Math.PI
  else if (angle <= -Math.PI / 2) angle += Math.PI

  // Hull = jaw perimeter + brow line. These are the extreme anatomical
  // boundaries available in the 68-point model.
  const hull: Point2D[] = []
  for (let i = JAW_START; i <= JAW_END; i += 1) {
    const p = points[i]
    if (p) hull.push(p)
  }
  for (let i = BROW_START; i <= BROW_END; i += 1) {
    const p = points[i]
    if (p) hull.push(p)
  }
  if (hull.length < 8) return null

  const centre = meanPoint(hull)
  if (!centre) return null

  // ── level the hull, then measure its axis-aligned extent ──
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of hull) {
    const r = rotateAround(p, centre.x, centre.y, -angle)
    if (r.x < minX) minX = r.x
    if (r.x > maxX) maxX = r.x
    if (r.y < minY) minY = r.y
    if (r.y > maxY) maxY = r.y
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null

  const rawWidth = maxX - minX
  const rawHeight = maxY - minY
  if (rawWidth < 1 || rawHeight < 1) return null

  // Extend upward for the forehead the 68-point model cannot see.
  const foreheadPad = rawHeight * foreheadExtension
  const topY = minY - foreheadPad

  const width = rawWidth * widthMargin
  const height = (maxY - topY) * heightMargin

  // Centre of the extended box, still in the rotated frame…
  const rotatedCentreX = (minX + maxX) / 2
  const rotatedCentreY = (topY + maxY) / 2
  // …carried back into image space.
  const finalCentre = rotateAround(
    { x: rotatedCentreX, y: rotatedCentreY },
    centre.x,
    centre.y,
    angle,
  )

  return {
    centerX: finalCentre.x,
    centerY: finalCentre.y,
    width,
    height,
    angle,
  }
}

/**
 * Build an oriented box from an explicit hull and a pre-computed roll angle.
 *
 * Split out from `computeOrientedBox` so both landmark models can share the
 * rotate→extent→rotate-back math while each supplying its own hull: iBUG-68
 * has no forehead points, whereas the MediaPipe mesh does, so their hull
 * selection differs even though the geometry is identical.
 *
 * @param hull          Facial hull points, in source-frame pixels.
 * @param angle         Roll in radians, already in (−π/2, π/2].
 * @param widthMargin   Horizontal expansion factor.
 * @param heightMargin  Vertical expansion factor.
 * @param extraTop      Additional top extension as a fraction of hull
 *                      height — 0 when the hull already includes forehead
 *                      landmarks.
 */
export function orientedBoxFromHullAndAngle(
  hull: readonly Point2D[],
  angle: number,
  widthMargin: number,
  heightMargin: number,
  extraTop = 0,
): OrientedBox | null {
  if (hull.length < 8) return null

  let cx = 0
  let cy = 0
  for (const p of hull) {
    cx += p.x
    cy += p.y
  }
  const centre = { x: cx / hull.length, y: cy / hull.length }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of hull) {
    const r = rotateAround(p, centre.x, centre.y, -angle)
    if (r.x < minX) minX = r.x
    if (r.x > maxX) maxX = r.x
    if (r.y < minY) minY = r.y
    if (r.y > maxY) maxY = r.y
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null

  const rawWidth = maxX - minX
  const rawHeight = maxY - minY
  if (rawWidth < 1 || rawHeight < 1) return null

  const topY = minY - rawHeight * extraTop
  const width = rawWidth * widthMargin
  const height = (maxY - topY) * heightMargin

  const rotatedCentreX = (minX + maxX) / 2
  const rotatedCentreY = (topY + maxY) / 2
  const finalCentre = rotateAround(
    { x: rotatedCentreX, y: rotatedCentreY },
    centre.x,
    centre.y,
    angle,
  )

  return { centerX: finalCentre.x, centerY: finalCentre.y, width, height, angle }
}



export interface RenderedOrientedBox extends RenderedBox {
  /** Rotation to apply when rendering, in radians. */
  angle: number
}

/**
 * Map an oriented box into a container rendering the video with
 * `object-fit: cover`, optionally mirrored.
 *
 * Mirroring negates the angle: a head tilting right in the world tilts
 * left in a mirrored preview, and the box must follow the image.
 */
export function mapOrientedBoxToContainer(
  box: OrientedBox,
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number,
  isMirrored: boolean,
): RenderedOrientedBox | null {
  if (!sourceWidth || !sourceHeight || !containerWidth || !containerHeight) return null
  const scale = Math.max(containerWidth / sourceWidth, containerHeight / sourceHeight)
  const offsetX = (containerWidth - sourceWidth * scale) / 2
  const offsetY = (containerHeight - sourceHeight * scale) / 2

  const centerX = isMirrored ? sourceWidth - box.centerX : box.centerX
  const width = box.width * scale
  const height = box.height * scale

  return {
    left: offsetX + centerX * scale - width / 2,
    top: offsetY + box.centerY * scale - height / 2,
    width,
    height,
    angle: isMirrored ? -box.angle : box.angle,
  }
}
