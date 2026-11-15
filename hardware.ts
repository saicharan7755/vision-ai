/**
 * hardware.ts — device capability detection and adaptive quality presets.
 *
 * The same build runs on a 4K desktop and a 3-year-old phone; a fixed
 * inference configuration is wrong for at least one of them. The presets
 * below trade inference resolution, detection rate and face capacity
 * against the frame budget each device class can actually afford.
 *
 * The preset only applies when the user's quality setting is 'auto' (the
 * default); an explicit 'fast' / 'balanced' choice always wins.
 */
import type { DetectionQuality } from '@/types/settings'
import { MAX_FACES } from './constants'

export type DeviceTier = 'low' | 'medium' | 'high'

export interface PerformancePreset {
  readonly tier: DeviceTier
  /** UI label, shown in the diagnostics overlay. */
  readonly name: 'Low' | 'Medium' | 'High'
  /** Width the frame is downscaled to before detection. */
  readonly inferenceWidth: number
  /** Minimum spacing between detection passes. */
  readonly detectionIntervalMs: number
  /** Target spacing between emotion classifications. */
  readonly emotionIntervalMs: number
  /** Hard cap on simultaneously tracked faces. */
  readonly maxTrackedFaces: number
  /** Contrast equalization on poorly-lit crops (costs ~1–2 ms per face). */
  readonly enableCLAHE: boolean
}

export const PERFORMANCE_PRESETS: Record<DeviceTier, PerformancePreset> = {
  low: {
    tier: 'low',
    name: 'Low',
    inferenceWidth: 224,
    detectionIntervalMs: 100, // ~10 FPS detection
    emotionIntervalMs: 200, // ~5 FPS emotion
    maxTrackedFaces: 2,
    enableCLAHE: false,
  },
  medium: {
    tier: 'medium',
    name: 'Medium',
    inferenceWidth: 320,
    detectionIntervalMs: 66, // ~15 FPS detection
    emotionIntervalMs: 133, // ~7.5 FPS emotion
    maxTrackedFaces: 3,
    enableCLAHE: true,
  },
  high: {
    tier: 'high',
    name: 'High',
    inferenceWidth: 480,
    detectionIntervalMs: 33, // ~30 FPS detection
    emotionIntervalMs: 66, // ~15 FPS emotion
    maxTrackedFaces: 5,
    enableCLAHE: true,
  },
}

/** WebGL presence is the divider between medium and high on desktop. */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export function detectDeviceTier(): DeviceTier {
  if (typeof navigator === 'undefined') return 'medium'
  const cores = navigator.hardwareConcurrency || 4
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent)
  // Mobile browsers also under-report cores and share the main thread with
  // the camera pipeline, so they are low-tier regardless of the count.
  if (isMobile || cores < 4) return 'low'
  // High tier needs real headroom: 8+ cores AND a GPU. Mid-range 4–6 core
  // desktops land on medium (320px / 15 FPS / 3 faces) rather than
  // over-committing the frame budget.
  return cores >= 8 && hasWebGL() ? 'high' : 'medium'
}

let cachedPreset: PerformancePreset | null = null

/** Resolve (and memoize) this device's preset. */
export function getPerformancePreset(): PerformancePreset {
  if (!cachedPreset) cachedPreset = PERFORMANCE_PRESETS[detectDeviceTier()]
  return cachedPreset
}

/**
 * Effective face cap: the preset's on 'auto', the configured maximum for
 * an explicit quality choice.
 */
export function getFaceCap(quality: DetectionQuality): number {
  return quality === 'auto' ? getPerformancePreset().maxTrackedFaces : MAX_FACES
}

/** Downscale width for a quality setting, resolving 'auto' via the preset. */
export function getInferenceWidth(quality: DetectionQuality): number {
  return quality === 'auto' ? getPerformancePreset().inferenceWidth : quality === 'fast' ? 320 : 480
}

/** Detector input size for a quality setting, resolving 'auto' via the preset. */
export function getDetectorInputSize(quality: DetectionQuality): number {
  // Below ~240px of downscale the 160-input detector is the right partner;
  // above it, 224 recovers small faces.
  return getInferenceWidth(quality) <= 240 ? 160 : 224
}
