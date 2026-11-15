/**
 * Emotion domain types.
 * Emotion labels are a strict enum — never raw strings — so a typo
 * becomes a compile error rather than a silent runtime bug.
 */

export enum Emotion {
  Happy = 'happy',
  Sad = 'sad',
  Angry = 'angry',
  Surprised = 'surprised',
  Fearful = 'fearful',
  Disgusted = 'disgusted',
  /** AffectNet 8th class; only produced by the HSEmotion engine. */
  Contempt = 'contempt',
  Neutral = 'neutral',
}

/** Declaration order is the canonical display order. */
export const EMOTIONS: readonly Emotion[] = Object.freeze([
  Emotion.Happy,
  Emotion.Sad,
  Emotion.Angry,
  Emotion.Surprised,
  Emotion.Fearful,
  Emotion.Disgusted,
  Emotion.Contempt,
  Emotion.Neutral,
])

/** Confidence per emotion, always 0..1 and always complete. */
export type EmotionScores = Record<Emotion, number>

export interface EmotionMeta {
  readonly key: Emotion
  readonly label: string
  readonly color: string
  readonly soft: string
}

/** A single point on the session emotion timeline. */
export interface EmotionSnapshot {
  /** Seconds since session start. */
  readonly t: number
  readonly faceCount: number
  readonly scores: EmotionScores
  readonly dominant: Emotion
}

export type TransitionSpeed = 'sudden' | 'gradual'

export interface TransitionEvent {
  readonly id: string
  /** Seconds since session start. */
  readonly t: number
  readonly personId: number
  readonly from: Emotion
  readonly to: Emotion
  readonly speed: TransitionSpeed
}

export interface MirrorEvent {
  readonly id: string
  readonly t: number
  readonly leaderId: number
  readonly followerId: number
  readonly emotion: Emotion
  readonly delaySec: number
}

/** Builds a zeroed, complete score map. */
export function createEmptyScores(): EmotionScores {
  return {
    [Emotion.Happy]: 0,
    [Emotion.Sad]: 0,
    [Emotion.Angry]: 0,
    [Emotion.Surprised]: 0,
    [Emotion.Fearful]: 0,
    [Emotion.Disgusted]: 0,
    [Emotion.Contempt]: 0,
    [Emotion.Neutral]: 0,
  }
}

/** Type guard for values coming out of the ML model (untyped strings). */
export function isEmotion(value: string): value is Emotion {
  return (EMOTIONS as readonly string[]).includes(value)
}
