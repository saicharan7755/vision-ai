/**
 * Face detection and tracking types.
 */
import type { Emotion, EmotionScores, EmotionSnapshot, MirrorEvent } from './emotion'
import type { HeadPose, LandmarkPoint, LandmarkRatios } from '@/services/landmarkEngine'
import type { OrientedBox } from '@/utils/geometry'

/** Axis-aligned box in source-pixel coordinates. */
export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export type Gender = 'male' | 'female'

/** Raw, untracked output of a single inference pass. */
export interface DetectedFace {
  box: BoundingBox
  detectionScore: number
  /**
   * Omitted on frames where the emotion net was skipped by the tiered
   * scheduler — consumers reuse their cached vector rather than treating
   * the gap as an all-zero reading.
   */
  expressions?: EmotionScores
  /** Only present on frames where the age/gender net ran. */
  age?: number
  gender?: Gender
  genderProbability?: number
  /** Mean luminance of the face crop, 0–255. */
  luminance?: number
  /** True when contrast equalization was applied to the crop. */
  wasEnhanced?: boolean
  /**
   * Scale-invariant landmark ratios for this face (Engine 2 of the
   * ensemble). Absent when the landmark net did not run, in which case the
   * fusion engine degrades to CNN-only.
   */
  landmarkRatios?: LandmarkRatios
  /** Raw landmark-anchored oriented box, before temporal smoothing. */
  orientedBox?: OrientedBox
  /** 3D head pose (pitch/yaw/roll); absent when no pose source was available. */
  headPose?: HeadPose
  /** Full landmark set in source-frame pixels, for crop alignment. */
  landmarks?: readonly LandmarkPoint[]
}

/**
 * Track lifecycle.
 *  active   — matched to a detection this frame
 *  occluded — briefly missing, box frozen and ghosted, ID reserved
 *  expiring — fading out, about to be retired
 */
export type TrackStatus = 'active' | 'occluded' | 'expiring'

/** A face with a stable identity and smoothed geometry. */
export interface TrackedFace {
  id: number
  box: BoundingBox
  expressions: EmotionScores
  dominant: Emotion
  confidence: number
  status: TrackStatus
  /** performance.now() at track creation — drives entrance animation. */
  bornAt: number
  age: number | null
  gender: Gender | null
  genderConfidence: number
  /**
   * True when the top probability fell below the confidence floor. The
   * label is forced to Neutral and the UI marks it as uncertain rather
   * than asserting a guess.
   */
  isLowConfidence: boolean
  /** Mean luminance of the face crop, 0–255. */
  luminance: number
  /** True when contrast equalization was applied to this face's crop. */
  wasEnhanced: boolean
  /** Latest geometric ratios, or null when the landmark net did not run. */
  landmarkRatios: LandmarkRatios | null
  /**
   * Smoothed landmark-anchored box that rotates with head roll. Drives the
   * HUD overlay. Null when landmarks are unavailable, in which case the
   * overlay falls back to the axis-aligned `box`.
   */
  orientedBox: OrientedBox | null
}

/** Result of a static (single image) analysis. */
export interface AnalyzedFace extends DetectedFace {
  id: number
  dominant: Emotion
  confidence: number
  thumbnailUrl: string
}

/* ── Video analysis ─────────────────────────────────────────────── */

/** One tracked face at one sampled moment, normalized 0..1 against the
 * video's intrinsic size so overlays never need the source dimensions. */
export interface VideoFace {
  id: number
  x: number
  y: number
  width: number
  height: number
  dominant: Emotion
  confidence: number
  expressions: EmotionScores
  age: number | null
  gender: Gender | null
  status: TrackStatus
}

/** All faces detected in one sampled frame. */
export interface VideoFrame {
  /** Seconds from the start of the video. */
  t: number
  faces: VideoFace[]
}

/** Rolling summary for one person across the whole video. */
export interface VideoPersonSummary {
  id: number
  dominant: Emotion
  /** Seconds of video where this person was visible. */
  presenceSec: number
  distribution: EmotionScores
  /** Mean dominant-emotion confidence across visible frames. */
  avgConfidence: number
  age: number | null
  gender: Gender | null
  frames: number
}

/** Aggregate analytics for a processed video. */
export interface VideoAnalytics {
  timeline: EmotionSnapshot[]
  distribution: EmotionScores
  peakFaces: number
  /** Frames where ≥2 faces were visible simultaneously. */
  sharedFrames: number
  synchrony: number
  mirrors: MirrorEvent[]
  avgIntensity: number
  people: VideoPersonSummary[]
}
