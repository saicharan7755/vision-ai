/**
 * Persisted session types.
 *
 * Everything here crosses the IndexedDB boundary, so it is marked readonly —
 * a session is constructed once, persisted, and never mutated in place.
 */
import type { Emotion, EmotionScores, EmotionSnapshot, TransitionEvent } from './emotion'

export interface Session {
  readonly id: string
  /** Epoch milliseconds. */
  readonly startedAt: number
  readonly endedAt: number
  readonly durationSec: number
  readonly peakFaces: number
  readonly dominantEmotion: Emotion
  /** Mean confidence of the dominant emotion, 0..1. */
  readonly avgIntensity: number
  readonly transitions: readonly TransitionEvent[]
  /** Seconds spent in each emotion. */
  readonly distribution: EmotionScores
  readonly timeline: readonly EmotionSnapshot[]
  /**
   * 'calibrated' marks a session whose emotion scores came from the
   * authored demo timeline rather than model inference, so stored data is
   * never mistaken for real AI output.
   */
  readonly source: 'live' | 'video' | 'calibrated'
}

/** Aggregated live counters shown on the dashboard. */
export interface SessionStats {
  readonly durationSec: number
  readonly faceCount: number
  readonly peakFaces: number
  readonly transitionCount: number
  readonly mirrorCount: number
  readonly avgIntensity: number
  readonly distribution: EmotionScores
  readonly dominantEmotion: Emotion
}
