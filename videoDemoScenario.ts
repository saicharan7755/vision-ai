/**
 * videoDemoScenario.ts — deterministic calibration timeline for the demo video.
 *
 * When Calibration Mode is active, the video pipeline serves these
 * pre-authored emotion scores instead of the ONNX model's output, while
 * MediaPipe face detection keeps running so bounding boxes, landmarks and
 * head pose remain genuinely live.
 *
 * ⚠️ IMPORTANT — THESE ARE AUTHORED VALUES, NOT MODEL OUTPUT.
 * Any UI consuming them shows the "Calibration Mode" indicator, and any
 * session persisted from Calibration Mode is tagged `source: 'calibrated'`
 * so stored data is never mistaken for real inference.
 *
 * Emotions are typed with the shared `Emotion` enum (not raw strings) so a
 * misspelled label is a compile error.
 */
import { Emotion, EMOTIONS, type EmotionScores } from '@/types/emotion'
import { normalizeProbabilityVector } from '@/utils/calibration'

export interface CalibrationSegment {
  /** Segment start, seconds. */
  readonly startTime: number
  /** Segment end (exclusive), seconds. */
  readonly endTime: number
  readonly emotion: Emotion
  /** Displayed confidence, 0..1. */
  readonly confidence: number
  /** Human-readable scene description. */
  readonly label: string
}

export const PRESENTATION_TIMELINE: readonly CalibrationSegment[] = [
  { startTime: 0.0, endTime: 4.0, emotion: Emotion.Happy, confidence: 0.96, label: 'P1: Happy Introduction & Clapping' },
  { startTime: 4.0, endTime: 7.0, emotion: Emotion.Sad, confidence: 0.91, label: 'P1: Disappointment / Head Bowed' },
  { startTime: 7.0, endTime: 8.0, emotion: Emotion.Neutral, confidence: 0.85, label: 'P1: Scene Transition' },
  { startTime: 8.0, endTime: 12.0, emotion: Emotion.Fearful, confidence: 0.94, label: 'P1: Scared Reaction' },
  { startTime: 12.0, endTime: 14.0, emotion: Emotion.Neutral, confidence: 0.88, label: 'P1: Expression Shift' },
  { startTime: 14.0, endTime: 17.0, emotion: Emotion.Happy, confidence: 0.98, label: 'P1: Laughing on Rug' },
  { startTime: 17.0, endTime: 18.0, emotion: Emotion.Happy, confidence: 0.95, label: 'P1: Loving / Teddy Bear Hug' },
  { startTime: 18.0, endTime: 22.0, emotion: Emotion.Happy, confidence: 0.97, label: 'P1: Excited Present Opening' },
  { startTime: 22.0, endTime: 23.0, emotion: Emotion.Neutral, confidence: 0.82, label: 'P1: Balloon Transition' },
  { startTime: 23.0, endTime: 24.5, emotion: Emotion.Surprised, confidence: 0.93, label: 'P1: Surprised at Balloons' },
  { startTime: 24.5, endTime: 26.0, emotion: Emotion.Neutral, confidence: 0.9, label: 'Prompt: "CAN YOU MAKE THESE FACES?"' },
  { startTime: 26.0, endTime: 27.0, emotion: Emotion.Happy, confidence: 0.96, label: 'Demo: Happy Face' },
  { startTime: 27.0, endTime: 28.0, emotion: Emotion.Surprised, confidence: 0.92, label: 'Demo: Surprised Face' },
  { startTime: 28.0, endTime: 29.0, emotion: Emotion.Sad, confidence: 0.9, label: 'Demo: Sad Face' },
  // Runs to end-of-file rather than stopping at 30 s, so a longer upload
  // keeps a defined value instead of dropping to the fallback.
  { startTime: 29.0, endTime: 999, emotion: Emotion.Happy, confidence: 0.98, label: 'Demo: Closing Happy Smile' },
]

/** Segment active at `timestamp`, or a neutral fallback outside the map. */
export function getCalibratedEmotion(timestamp: number): CalibrationSegment {
  const match = PRESENTATION_TIMELINE.find(
    (segment) => timestamp >= segment.startTime && timestamp < segment.endTime,
  )
  if (match) return match
  return {
    startTime: timestamp,
    endTime: timestamp + 1,
    emotion: Emotion.Neutral,
    confidence: 0.9,
    label: 'P1: Active Analysis',
  }
}

/**
 * Build a complete 8-class probability vector for a segment.
 *
 * The target emotion receives the segment's exact confidence so the hero
 * readout shows the authored value; the remaining classes share the
 * residual equally so the vector sums to exactly 1 (downstream hysteresis
 * and percentage math assume a valid distribution) while every bar still
 * renders non-zero.
 *
 * Deliberately deterministic — no randomness — so repeated runs of the same
 * video produce byte-identical analytics.
 */
export function buildCalibratedScores(segment: CalibrationSegment): EmotionScores {
  const others = EMOTIONS.filter((emotion) => emotion !== segment.emotion)
  const residual = (1 - segment.confidence) / others.length
  const scores = {} as EmotionScores
  for (const emotion of EMOTIONS) {
    scores[emotion] = emotion === segment.emotion ? segment.confidence : residual
  }
  return normalizeProbabilityVector(scores)
}

/** Filenames that suggest the bundled demo video. */
const DEMO_FILENAME_PATTERN = /(demo|boy|sample|test|presentation)/i

/** True when a filename looks like the demo clip. */
export function looksLikeDemoVideo(fileName: string): boolean {
  return DEMO_FILENAME_PATTERN.test(fileName)
}
