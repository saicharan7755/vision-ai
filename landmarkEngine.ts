/**
 * landmarkEngine.ts — Engine 2 of the dual-emotion ensemble.
 *
 * Derives physical expression evidence from facial landmark geometry and
 * turns it into per-emotion confidence boosts that the fusion engine
 * combines with the CNN stream. Where the CNN reads pixels (and is
 * therefore fooled by lighting, shadows and texture), geometry measures
 * actual muscle positions — a mouth corner is either raised or it isn't,
 * regardless of how the light falls.
 *
 * TWO LANDMARK MODELS, ONE RATIO ENGINE
 * -------------------------------------
 * The ratio math is model-agnostic: every output is a distance *ratio*
 * normalized by another distance on the same face, so values are comparable
 * across models. Only the INDEX used to locate a semantic point differs.
 *
 *  • iBUG-68      — face-api.js `faceLandmark68TinyNet` (the fallback path)
 *  • MediaPipe    — `FaceLandmarker` 478-point mesh (the primary path)
 *
 * Both build a `SemanticFacialPoints` and hand it to `computeRatios()`, so
 * the thresholds in constants.ts mean the same thing whichever model is
 * active. The MediaPipe indices are the ones the ensemble design originally
 * specified; iBUG-68 was a stand-in while that model was unavailable.
 */
import { Emotion, createEmptyScores, type EmotionScores } from '@/types/emotion'
import {
  ANGRY_BOOST,
  BROW_COMPRESSION_THRESHOLD,
  DISGUST_BOOST,
  EAR_FEAR,
  EAR_SURPRISE,
  FEAR_BOOST,
  MAR_FEAR,
  MAR_SURPRISE,
  NOSE_CONTRACTION_RATIO,
  SAD_BOOST,
  SMILE_BOOST,
  SMILE_RATIO_NEGATIVE,
  SMILE_RATIO_POSITIVE,
  SURPRISE_BOOST,
} from '@/utils/constants'

/** Minimal point shape consumed from either landmark model. */
export interface LandmarkPoint {
  x: number
  y: number
}

/**
 * The semantic points the verifiers need, in model-agnostic terms.
 * "Right"/"left" follow the SUBJECT's anatomy; every ratio below is
 * symmetric across that axis, so a flipped convention cannot change a value.
 */
export interface SemanticFacialPoints {
  mouthRight: LandmarkPoint
  mouthLeft: LandmarkPoint
  noseBase: LandmarkPoint
  chin: LandmarkPoint
  browInnerRight: LandmarkPoint
  browInnerLeft: LandmarkPoint
  eyeOuterRight: LandmarkPoint
  eyeOuterLeft: LandmarkPoint
  lipInnerTop: LandmarkPoint
  lipInnerBottom: LandmarkPoint
  noseBridge: LandmarkPoint
  lipUpperCentre: LandmarkPoint
  /** Six-point eye ring, standard EAR ordering (outer, top1, top2, inner, bottom2, bottom1). */
  rightEyeRing: readonly LandmarkPoint[]
  leftEyeRing: readonly LandmarkPoint[]
}

/** Raw geometric measurements for one face, all scale-invariant. */
export interface LandmarkRatios {
  /** Mouth-corner elevation: >SMILE_RATIO_POSITIVE = smile, <NEGATIVE = frown. */
  readonly smileRatio: number
  /** Inner-brow gap / eye width: <THRESHOLD = brows furrowed. */
  readonly browCompression: number
  /** Mouth aperture / mouth width: 0 closed, ~0.5+ wide open. */
  readonly mouthAperture: number
  /** Eye aspect ratio: ~0.3 open, <0.18 squinting. */
  readonly eyeAspect: number
  /** Nose-bridge→upper-lip gap / face width: shrinks when the nose wrinkles. */
  readonly noseGap: number
}

/** Head pose in radians, from the facial transformation matrix. */
export interface HeadPose {
  /** Nod. Positive = looking up. */
  readonly pitch: number
  /** Turn. Positive = looking to the subject's left. */
  readonly yaw: number
  /** Tilt. Positive = top of head tilted toward the subject's right shoulder. */
  readonly roll: number
}

function distance(a: LandmarkPoint, b: LandmarkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/* ── iBUG-68 index table (face-api.js fallback path) ──────────────── */

const IBUG = {
  MOUTH_RIGHT: 48,
  MOUTH_LEFT: 54,
  NOSE_BASE: 33,
  CHIN: 8,
  BROW_INNER_RIGHT: 21,
  BROW_INNER_LEFT: 22,
  EYE_OUTER_RIGHT: 36,
  EYE_TOP_RIGHT_1: 37,
  EYE_TOP_RIGHT_2: 38,
  EYE_INNER_RIGHT: 39,
  EYE_BOTTOM_RIGHT_2: 40,
  EYE_BOTTOM_RIGHT_1: 41,
  EYE_INNER_LEFT: 42,
  EYE_BOTTOM_LEFT_1: 43,
  EYE_BOTTOM_LEFT_2: 47,
  EYE_OUTER_LEFT: 45,
  EYE_TOP_LEFT_1: 44,
  EYE_TOP_LEFT_2: 46,
  LIP_INNER_TOP: 62,
  LIP_INNER_BOTTOM: 66,
  NOSE_BRIDGE: 27,
  LIP_UPPER_CENTRE: 51,
} as const

const IBUG_COUNT = 68

function pick(points: readonly LandmarkPoint[], index: number): LandmarkPoint | null {
  const p = points[index]
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null
}

/**
 * Extract semantic points from an iBUG-68 landmark set.
 *
 * @returns null when the set is short or any required point is malformed.
 */
export function semanticPointsFromIbug68(
  points: readonly LandmarkPoint[],
): SemanticFacialPoints | null {
  if (points.length < IBUG_COUNT) return null

  const ring = (indices: readonly number[]): LandmarkPoint[] => {
    const out: LandmarkPoint[] = []
    for (const index of indices) {
      const p = pick(points, index)
      if (p) out.push(p)
    }
    return out
  }

  const required = [
    IBUG.MOUTH_RIGHT, IBUG.MOUTH_LEFT, IBUG.NOSE_BASE, IBUG.CHIN,
    IBUG.BROW_INNER_RIGHT, IBUG.BROW_INNER_LEFT, IBUG.EYE_OUTER_RIGHT,
    IBUG.EYE_OUTER_LEFT, IBUG.LIP_INNER_TOP, IBUG.LIP_INNER_BOTTOM,
    IBUG.NOSE_BRIDGE, IBUG.LIP_UPPER_CENTRE,
  ]
  for (const index of required) {
    if (!pick(points, index)) return null
  }

  const rightEyeRing = ring([
    IBUG.EYE_OUTER_RIGHT, IBUG.EYE_TOP_RIGHT_1, IBUG.EYE_TOP_RIGHT_2,
    IBUG.EYE_INNER_RIGHT, IBUG.EYE_BOTTOM_RIGHT_2, IBUG.EYE_BOTTOM_RIGHT_1,
  ])
  const leftEyeRing = ring([
    IBUG.EYE_INNER_LEFT, IBUG.EYE_TOP_LEFT_1, IBUG.EYE_TOP_LEFT_2,
    IBUG.EYE_OUTER_LEFT, IBUG.EYE_BOTTOM_LEFT_2, IBUG.EYE_BOTTOM_LEFT_1,
  ])
  if (rightEyeRing.length !== 6 || leftEyeRing.length !== 6) return null

  return {
    mouthRight: points[IBUG.MOUTH_RIGHT]!,
    mouthLeft: points[IBUG.MOUTH_LEFT]!,
    noseBase: points[IBUG.NOSE_BASE]!,
    chin: points[IBUG.CHIN]!,
    browInnerRight: points[IBUG.BROW_INNER_RIGHT]!,
    browInnerLeft: points[IBUG.BROW_INNER_LEFT]!,
    eyeOuterRight: points[IBUG.EYE_OUTER_RIGHT]!,
    eyeOuterLeft: points[IBUG.EYE_OUTER_LEFT]!,
    lipInnerTop: points[IBUG.LIP_INNER_TOP]!,
    lipInnerBottom: points[IBUG.LIP_INNER_BOTTOM]!,
    noseBridge: points[IBUG.NOSE_BRIDGE]!,
    lipUpperCentre: points[IBUG.LIP_UPPER_CENTRE]!,
    rightEyeRing,
    leftEyeRing,
  }
}

/* ── MediaPipe 478-point index table (primary path) ───────────────── */

export const MEDIAPIPE = {
  MOUTH_RIGHT: 61,
  MOUTH_LEFT: 291,
  NOSE_BASE: 2,
  CHIN: 152,
  BROW_INNER_RIGHT: 55,
  BROW_INNER_LEFT: 285,
  EYE_OUTER_RIGHT: 33,
  EYE_TOP_RIGHT_1: 160,
  EYE_TOP_RIGHT_2: 158,
  EYE_INNER_RIGHT: 133,
  EYE_BOTTOM_RIGHT_2: 153,
  EYE_BOTTOM_RIGHT_1: 144,
  EYE_INNER_LEFT: 362,
  EYE_TOP_LEFT_1: 385,
  EYE_TOP_LEFT_2: 387,
  EYE_OUTER_LEFT: 263,
  EYE_BOTTOM_LEFT_2: 373,
  EYE_BOTTOM_LEFT_1: 380,
  LIP_INNER_TOP: 13,
  LIP_INNER_BOTTOM: 14,
  NOSE_BRIDGE: 6,
  LIP_UPPER_CENTRE: 0,
  NOSE_TIP: 1,
  FOREHEAD: 10,
  CHEEK_RIGHT: 234,
  CHEEK_LEFT: 454,
  /** Full face-mesh hull extent, used for the oriented bounding box. */
  HULL_START: 10,
  HULL_END: 356,
} as const

/** Minimum mesh size accepted as a valid MediaPipe result. */
const MEDIAPIPE_MIN_COUNT = 400

/**
 * Extract semantic points from a MediaPipe 478-point mesh.
 *
 * @param points  PIXEL-space landmarks (the caller converts the normalized
 *                [0,1] output, because the conversion needs the frame size).
 */
export function semanticPointsFromMediaPipe(
  points: readonly LandmarkPoint[],
): SemanticFacialPoints | null {
  if (points.length < MEDIAPIPE_MIN_COUNT) return null

  const ring = (indices: readonly number[]): LandmarkPoint[] => {
    const out: LandmarkPoint[] = []
    for (const index of indices) {
      const p = pick(points, index)
      if (p) out.push(p)
    }
    return out
  }

  const required = [
    MEDIAPIPE.MOUTH_RIGHT, MEDIAPIPE.MOUTH_LEFT, MEDIAPIPE.NOSE_BASE,
    MEDIAPIPE.CHIN, MEDIAPIPE.BROW_INNER_RIGHT, MEDIAPIPE.BROW_INNER_LEFT,
    MEDIAPIPE.EYE_OUTER_RIGHT, MEDIAPIPE.EYE_OUTER_LEFT,
    MEDIAPIPE.LIP_INNER_TOP, MEDIAPIPE.LIP_INNER_BOTTOM,
    MEDIAPIPE.NOSE_BRIDGE, MEDIAPIPE.LIP_UPPER_CENTRE,
  ]
  for (const index of required) {
    if (!pick(points, index)) return null
  }

  const rightEyeRing = ring([
    MEDIAPIPE.EYE_OUTER_RIGHT, MEDIAPIPE.EYE_TOP_RIGHT_1,
    MEDIAPIPE.EYE_TOP_RIGHT_2, MEDIAPIPE.EYE_INNER_RIGHT,
    MEDIAPIPE.EYE_BOTTOM_RIGHT_2, MEDIAPIPE.EYE_BOTTOM_RIGHT_1,
  ])
  const leftEyeRing = ring([
    MEDIAPIPE.EYE_INNER_LEFT, MEDIAPIPE.EYE_TOP_LEFT_1,
    MEDIAPIPE.EYE_TOP_LEFT_2, MEDIAPIPE.EYE_OUTER_LEFT,
    MEDIAPIPE.EYE_BOTTOM_LEFT_2, MEDIAPIPE.EYE_BOTTOM_LEFT_1,
  ])
  if (rightEyeRing.length !== 6 || leftEyeRing.length !== 6) return null

  return {
    mouthRight: points[MEDIAPIPE.MOUTH_RIGHT]!,
    mouthLeft: points[MEDIAPIPE.MOUTH_LEFT]!,
    noseBase: points[MEDIAPIPE.NOSE_BASE]!,
    chin: points[MEDIAPIPE.CHIN]!,
    browInnerRight: points[MEDIAPIPE.BROW_INNER_RIGHT]!,
    browInnerLeft: points[MEDIAPIPE.BROW_INNER_LEFT]!,
    eyeOuterRight: points[MEDIAPIPE.EYE_OUTER_RIGHT]!,
    eyeOuterLeft: points[MEDIAPIPE.EYE_OUTER_LEFT]!,
    lipInnerTop: points[MEDIAPIPE.LIP_INNER_TOP]!,
    lipInnerBottom: points[MEDIAPIPE.LIP_INNER_BOTTOM]!,
    noseBridge: points[MEDIAPIPE.NOSE_BRIDGE]!,
    lipUpperCentre: points[MEDIAPIPE.LIP_UPPER_CENTRE]!,
    rightEyeRing,
    leftEyeRing,
  }
}

/* ── Ratio math (model-agnostic) ──────────────────────────────────── */

/** Standard eye-aspect ratio for a 6-point eye ring. */
function eyeAspect(ring: readonly LandmarkPoint[]): number | null {
  if (ring.length !== 6) return null
  const [p1, p2, p3, p4, p5, p6] = ring as [
    LandmarkPoint, LandmarkPoint, LandmarkPoint,
    LandmarkPoint, LandmarkPoint, LandmarkPoint,
  ]
  const width = distance(p1, p4)
  if (width < 1e-6) return null
  return (distance(p2, p6) + distance(p3, p5)) / (2 * width)
}

/**
 * Compute all geometric ratios from semantic points.
 *
 * @returns null when the geometry is degenerate (e.g. a zero-width face,
 *          which would divide by zero) — callers treat that as "no
 *          geometric evidence" and fall back to CNN-only.
 */
export function computeRatios(sp: SemanticFacialPoints): LandmarkRatios | null {
  const faceWidth = distance(sp.eyeOuterRight, sp.eyeOuterLeft)
  if (faceWidth < 1e-6) return null

  // Height of both mouth corners above the nose base, normalized by the
  // nose→chin span. Scale- and largely pose-invariant.
  const noseToChin = sp.chin.y - sp.noseBase.y
  if (Math.abs(noseToChin) < 1e-6) return null
  const smileRatio =
    (sp.noseBase.y - sp.mouthRight.y + (sp.noseBase.y - sp.mouthLeft.y)) / (2 * noseToChin)

  const browCompression = distance(sp.browInnerRight, sp.browInnerLeft) / faceWidth

  const mouthWidth = distance(sp.mouthRight, sp.mouthLeft)
  if (mouthWidth < 1e-6) return null
  const mouthAperture = Math.abs(sp.lipInnerTop.y - sp.lipInnerBottom.y) / mouthWidth

  const rightEar = eyeAspect(sp.rightEyeRing)
  const leftEar = eyeAspect(sp.leftEyeRing)
  const earValues = [rightEar, leftEar].filter((v): v is number => v !== null)
  if (earValues.length === 0) return null
  const ear = earValues.reduce((sum, v) => sum + v, 0) / earValues.length

  const noseGap = distance(sp.noseBridge, sp.lipUpperCentre) / faceWidth

  return { smileRatio, browCompression, mouthAperture, eyeAspect: ear, noseGap }
}

/** Back-compat wrapper for the iBUG-68 path. */
export function computeLandmarkRatios(
  points: readonly LandmarkPoint[],
): LandmarkRatios | null {
  const sp = semanticPointsFromIbug68(points)
  return sp ? computeRatios(sp) : null
}

/* ── Head pose ────────────────────────────────────────────────────── */

/**
 * Extract Tait-Bryan (yaw-pitch-roll) angles from a MediaPipe facial
 * transformation matrix.
 *
 * The matrix is COLUMN-MAJOR 4×4; the upper-left 3×3 is the rotation taking
 * the canonical face model into the detected pose. Convention follows the
 * common robotics/ROS formulation — documented here because a mismatched
 * convention produces confidently wrong angles rather than an error.
 *
 * @param data 16-element column-major matrix.
 * @returns null for a degenerate (gimbal-locked) rotation.
 */
export function headPoseFromMatrix(data: readonly number[]): HeadPose | null {
  if (data.length !== 16) return null

  // Column-major: data[col * 4 + row]
  const r00 = data[0] ?? 0
  const r10 = data[1] ?? 0
  const r20 = data[2] ?? 0
  const r21 = data[6] ?? 0
  const r22 = data[10] ?? 0

  const sy = Math.hypot(r00, r10)
  if (sy < 1e-6) return null // gimbal lock — angles are not unique

  return {
    roll: Math.atan2(r10, r00),
    pitch: Math.atan2(-r20, sy),
    yaw: Math.atan2(r21, r22),
  }
}

/**
 * Landmark-only head pose — the fallback when no transformation matrix is
 * available, and the source of ROLL for crop alignment (roll must come from
 * the eye line so that levelling the eyes in the crop is exact, regardless
 * of what the matrix says).
 */
export function headPoseFromLandmarks(sp: SemanticFacialPoints, noseTip: LandmarkPoint): HeadPose {
  // Roll from the eye line, normalized into (−π/2, π/2] so a level face
  // reads 0 under either eye-labelling convention.
  let roll = Math.atan2(
    sp.eyeOuterLeft.y - sp.eyeOuterRight.y,
    sp.eyeOuterLeft.x - sp.eyeOuterRight.x,
  )
  if (roll > Math.PI / 2) roll -= Math.PI
  else if (roll <= -Math.PI / 2) roll += Math.PI

  const eyeMid = {
    x: (sp.eyeOuterRight.x + sp.eyeOuterLeft.x) / 2,
    y: (sp.eyeOuterRight.y + sp.eyeOuterLeft.y) / 2,
  }
  const eyeDistance = distance(sp.eyeOuterRight, sp.eyeOuterLeft)
  const yaw = eyeDistance > 1e-6 ? Math.atan2(noseTip.x - eyeMid.x, eyeDistance) : 0

  // Pitch: how far the nose tip sits above/below the eye-to-chin midpoint,
  // normalized by that span. Looking up raises the nose relative to it.
  const chinToEye = Math.abs(sp.chin.y - eyeMid.y)
  const pitch =
    chinToEye > 1e-6 ? Math.atan2(noseTip.y - eyeMid.y, chinToEye) - Math.PI / 6 : 0

  return { pitch, yaw, roll }
}

/** A per-emotion geometric confidence vector plus the ratios it came from. */
export interface GeometricEvidence {
  /** Boost per emotion, 0 when there is no geometric support. */
  readonly scores: EmotionScores
  readonly ratios: LandmarkRatios
}

/**
 * Convert raw ratios into per-emotion geometric confidence boosts.
 *
 * Boosts follow the ensemble design: they are evidence *for* an emotion,
 * never evidence against one. A face showing no strong geometry yields an
 * all-zero vector, which the fusion engine collapses to CNN-only.
 *
 * @param ratios  Current measurements.
 * @param resting The person's captured resting ratios, if calibrated.
 *                Provided because the nose-wrinkle verifier is inherently
 *                relative — a contraction only means something versus how
 *                that same face looks at rest.
 */
export function buildGeometricScores(
  ratios: LandmarkRatios,
  resting?: LandmarkRatios | null,
): GeometricEvidence {
  const scores = createEmptyScores()

  if (ratios.smileRatio > SMILE_RATIO_POSITIVE) {
    scores[Emotion.Happy] = SMILE_BOOST
  } else if (ratios.smileRatio < SMILE_RATIO_NEGATIVE) {
    scores[Emotion.Sad] = SAD_BOOST
  }

  if (ratios.browCompression < BROW_COMPRESSION_THRESHOLD) {
    scores[Emotion.Angry] = ANGRY_BOOST
  }

  const isWideOpenMouth = ratios.mouthAperture > MAR_SURPRISE
  const isWideEyes = ratios.eyeAspect > EAR_SURPRISE
  const isSquinting = ratios.eyeAspect < EAR_FEAR

  if (isWideOpenMouth && isWideEyes) {
    scores[Emotion.Surprised] = SURPRISE_BOOST
  } else if (ratios.mouthAperture > MAR_FEAR && isSquinting) {
    scores[Emotion.Fearful] = FEAR_BOOST
  }

  // Nose wrinkle: only decidable against this person's resting gap.
  if (resting && resting.noseGap > 1e-6) {
    const contraction = (resting.noseGap - ratios.noseGap) / resting.noseGap
    if (contraction > NOSE_CONTRACTION_RATIO) {
      scores[Emotion.Disgusted] = DISGUST_BOOST
    }
  }

  return { scores, ratios }
}
