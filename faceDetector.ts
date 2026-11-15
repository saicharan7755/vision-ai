/**
 * faceDetector.ts — the MediaPipe FaceLandmarker detection backbone.
 *
 * PRIMARY detector. Runs face detection and a 478-point 3D mesh (including
 * iris refinement) in a SINGLE GPU inference, replacing the previous
 * two-pass arrangement where TinyFaceDetector localized and a separate
 * landmark net then found 68 points. One pass means lower per-frame cost,
 * and the dense mesh gives:
 *
 *  • real forehead landmarks (iBUG-68 has none — its jaw runs ear-to-ear
 *    and stops at the brows, which previously forced the OBB to extrapolate
 *    its top edge),
 *  • iris tracking, so the eye-centre estimates driving roll are accurate
 *    through spectacles and at extreme angles,
 *  • a facial transformation matrix, which is a genuine 3D head pose
 *    (pitch/yaw/roll) rather than the 2D approximation landmarks allow.
 *
 * Everything is delegated when unavailable: if MediaPipe cannot initialize
 * (no WebGL, blocked CDN, offline first run) `detectFacesMediaPipe` returns
 * null and detectionEngine falls back to the face-api path unchanged.
 *
 * COORDINATE SPACES
 * -----------------
 * MediaPipe returns NORMALIZED [0,1] landmarks; the rest of this codebase
 * works in source-frame pixels. Conversion happens here, once, because it
 * needs the frame dimensions. Ratios are computed after conversion, though
 * they are dimensionless either way.
 */
import {
  computeRatios,
  headPoseFromLandmarks,
  headPoseFromMatrix,
  semanticPointsFromMediaPipe,
  type HeadPose,
  type LandmarkRatios,
} from './landmarkEngine'
import { applyNMS, orientedBoxFromHullAndAngle, type OrientedBox } from '@/utils/geometry'
import type { BoundingBox, DetectedFace } from '@/types/face'
import {
  DETECTION_SCORE_THRESHOLD,
  MAX_FACES,
  MIN_FACE_FRAME_FRACTION,
  MIN_FACE_SIZE_PX,
  OBB_HEIGHT_MARGIN,
  OBB_WIDTH_MARGIN,
} from '@/utils/constants'

type FaceLandmarkerModule = typeof import('@mediapipe/tasks-vision')

let landmarker: import('@mediapipe/tasks-vision').FaceLandmarker | null = null
let initPromise: Promise<boolean> | null = null
let isPermanentlyFailed = false
/** Monotonic timestamp guard — MediaPipe rejects a non-increasing value. */
let lastTimestampUs = -1

/** WASM runtime + model weights, both CDN-hosted. */
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

/**
 * MediaPipe's canonical face-oval contour. Used as the oriented-box hull;
 * unlike iBUG-68 this set already includes the forehead (index 10).
 */
const FACE_OVAL: readonly number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
]

/** True once the landmarker has initialized successfully. */
export function isMediaPipeReady(): boolean {
  return landmarker !== null
}

/**
 * Initialize the FaceLandmarker with the GPU delegate.
 *
 * Idempotent; resolves false (never throws) when MediaPipe is unavailable,
 * leaving the caller on the face-api fallback.
 *
 * @returns true when the landmarker is ready for `detectFacesMediaPipe`.
 */
export async function initFaceDetector(): Promise<boolean> {
  if (landmarker) return true
  if (isPermanentlyFailed) return false
  if (initPromise) return initPromise

  initPromise = (async (): Promise<boolean> => {
    try {
      const vision = await import('@mediapipe/tasks-vision')
      const fileset = await (
        vision as FaceLandmarkerModule
      ).FilesetResolver.forVisionTasks(WASM_BASE)

      // GPU first for sub-10ms latency; MediaPipe falls back to CPU
      // internally when WebGL is unavailable, so one attempt covers both.
      landmarker = await (
        vision as FaceLandmarkerModule
      ).FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: MAX_FACES,
        minFaceDetectionConfidence: DETECTION_SCORE_THRESHOLD,
        minFacePresenceConfidence: DETECTION_SCORE_THRESHOLD,
        // Deliberately one notch looser than detection/presence: tracking
        // only needs to hold onto an already-confirmed face, and a stricter
        // value causes the mesh to drop mid-movement, forcing a costly
        // re-detection cycle that reads as flicker.
        minTrackingConfidence: 0.6,
        // Blendshapes are not consumed today; the transformation matrixes
        // ARE — they are the source of true 3D head pose.
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
      })
      return true
    } catch (error) {
      console.error('[VISION AI] MediaPipe FaceLandmarker init failed', error)
      landmarker = null
      isPermanentlyFailed = true
      return false
    }
  })()

  return initPromise
}

/** Release the landmarker. Model assets are not re-downloaded on re-init. */
export function disposeFaceDetector(): void {
  if (!landmarker) return
  landmarker.close()
  landmarker = null
  lastTimestampUs = -1
  // Keep initPromise resolved: a re-init after dispose is cheap and the
  // WASM/model are already in the HTTP cache.
}

/** Result of one MediaPipe detection pass. */
export interface MediaPipeDetections {
  readonly faces: readonly DetectedFace[]
  /** True when the GPU/WebGL path reported an error this frame. */
  readonly hadError: boolean
}

/**
 * Run one detection pass over a video frame.
 *
 * @param video        Source element (must have videoWidth > 0).
 * @param timestampMs  Monotonic frame timestamp in milliseconds. MediaPipe
 *                     requires strictly increasing values, so a repeated or
 *                     older timestamp is skipped rather than throwing.
 * @returns null when the detector is not initialized — callers fall back.
 */
export function detectFacesMediaPipe(
  video: HTMLVideoElement,
  timestampMs: number,
): MediaPipeDetections | null {
  if (!landmarker) return null
  if (!video.videoWidth || !video.videoHeight) return null

  // MediaPipe wants microseconds and rejects non-increasing timestamps.
  const timestampUs = Math.round(timestampMs * 1000)
  if (timestampUs <= lastTimestampUs) {
    return { faces: [], hadError: false }
  }
  lastTimestampUs = timestampUs

  let result: import('@mediapipe/tasks-vision').FaceLandmarkerResult
  try {
    result = landmarker.detectForVideo(video, timestampUs)
  } catch (error) {
    console.error('[VISION AI] MediaPipe detection failed', error)
    return { faces: [], hadError: true }
  }

  const width = video.videoWidth
  const height = video.videoHeight
  const faces: DetectedFace[] = []

  for (let faceIndex = 0; faceIndex < result.faceLandmarks.length; faceIndex += 1) {
    const normalized = result.faceLandmarks[faceIndex]
    if (!normalized || normalized.length === 0) continue

    // ── normalized [0,1] → source-frame pixels ──
    const points = normalized.map((p) => ({ x: p.x * width, y: p.y * height }))

    const face = buildFace(points, result, faceIndex)
    if (face) faces.push(face)
  }

  return { faces: filterFaces(faces, width), hadError: false }
}

/** Assemble one DetectedFace from a pixel-space mesh. */
function buildFace(
  points: readonly { x: number; y: number }[],
  result: import('@mediapipe/tasks-vision').FaceLandmarkerResult,
  faceIndex: number,
): DetectedFace | null {
  // Tight axis-aligned extent of the whole mesh. MediaPipe's mesh covers
  // forehead-to-chin and cheek-to-cheek, so this IS the face box.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX)) return null

  const box: BoundingBox = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }

  // ── geometric ratios (ensemble Engine 2) ──
  const semantic = semanticPointsFromMediaPipe(points)
  const landmarkRatios: LandmarkRatios | null = semantic ? computeRatios(semantic) : null

  // ── head pose: prefer the 3D transformation matrix, fall back to
  //    landmarks. ROLL for crop alignment always comes from the eye line
  //    (see headPoseFromLandmarks) so levelling the crop is exact.
  let headPose: HeadPose | null = null
  const matrix = result.facialTransformationMatrixes?.[faceIndex]
  if (matrix && matrix.rows === 4 && matrix.columns === 4) {
    headPose = headPoseFromMatrix(matrix.data)
  }
  if (!headPose && semantic) {
    const noseTip = points[1] ?? semantic.noseBase
    headPose = headPoseFromLandmarks(semantic, noseTip)
  }

  // ── oriented box from the face-oval hull ──
  // No forehead extrapolation is needed: the MediaPipe hull already
  // includes index 10 (forehead top), unlike the iBUG-68 jaw+brow hull.
  let orientedBox: OrientedBox | null = null
  if (semantic) {
    let roll = Math.atan2(
      semantic.eyeOuterLeft.y - semantic.eyeOuterRight.y,
      semantic.eyeOuterLeft.x - semantic.eyeOuterRight.x,
    )
    if (roll > Math.PI / 2) roll -= Math.PI
    else if (roll <= -Math.PI / 2) roll += Math.PI

    const hull: { x: number; y: number }[] = []
    for (const index of FACE_OVAL) {
      const p = points[index]
      if (p) hull.push(p)
    }
    orientedBox = orientedBoxFromHullAndAngle(
      hull,
      roll,
      OBB_WIDTH_MARGIN,
      OBB_HEIGHT_MARGIN,
      0,
    )
  }

  return {
    box,
    detectionScore: 1,
    landmarkRatios: landmarkRatios ?? undefined,
    orientedBox: orientedBox ?? undefined,
    headPose: headPose ?? undefined,
    // Full mesh retained for downstream consumers (eye-levelling crops).
    landmarks: points,
  }
}

/**
 * Minimum-size filter then IoU NMS.
 *
 * Size filtering runs FIRST so an oversized spurious box cannot claim one
 * of two genuine adjacent faces during merging.
 */
function filterFaces(faces: readonly DetectedFace[], frameWidth: number): DetectedFace[] {
  const minSize = Math.max(MIN_FACE_SIZE_PX, frameWidth * MIN_FACE_FRAME_FRACTION)
  const sizeOk = faces.filter(
    (face) => face.box.width >= minSize && face.box.height >= minSize,
  )
  return applyNMS(sizeOk).slice(0, MAX_FACES)
}
