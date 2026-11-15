/**
 * User-configurable settings.
 */

/**
 * 'auto' (the default) follows the detected hardware preset; the others are
 * explicit user overrides.
 */
export type DetectionQuality = 'auto' | 'fast' | 'balanced'
export type CameraFacing = 'user' | 'environment'

export interface Settings {
  /** Selfie-style flipped preview. */
  readonly isMirrored: boolean
  /** Detector input resolution profile. */
  readonly quality: DetectionQuality
  /** Show AI-estimated age and gender on face labels. */
  readonly shouldShowAgeGender: boolean
  /** Front or rear camera (mobile). */
  readonly facingMode: CameraFacing
}

/** Discriminated union for the ML engine lifecycle. */
export type ModelStatus =
  | { phase: 'idle' }
  | { phase: 'loading'; progress: number }
  | { phase: 'ready'; hasEmotion: boolean; hasAgeGender: boolean }
  | { phase: 'error'; message: string }

/** Discriminated union for camera lifecycle. */
export type CameraStatus =
  | { phase: 'off' }
  | { phase: 'starting' }
  | { phase: 'on' }
  | { phase: 'error'; reason: CameraErrorReason; message: string }

export type CameraErrorReason =
  | 'denied'
  | 'notFound'
  | 'busy'
  | 'unsupported'
  | 'unknown'
