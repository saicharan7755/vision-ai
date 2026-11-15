/**
 * faceTracker — stable identity + geometric smoothing.
 *
 * Detections are matched against each track's PREDICTED position rather than
 * its last raw box, which is what keeps IDs from swapping when two people
 * cross paths. IDs are monotonic for the life of the tracker and are never
 * recycled, so a retired P3 can't reappear as a different person.
 */
import { Emotion, createEmptyScores, type EmotionScores } from '@/types/emotion'
import type { DetectedFace, Gender, TrackStatus, TrackedFace } from '@/types/face'
import {
  MAX_FACES,
  MAX_MISSED_FRAMES,
  OCCLUSION_FADE_MS,
  ALPHA_FAST,
  ALPHA_STILL,
  SIZE_ALPHA,
  SIZE_VELOCITY_GAIN,
  VELOCITY_FULL_RESPONSE,
  VELOCITY_GAIN,
} from '@/utils/constants'
import type { OrientedBox } from '@/utils/geometry'
import type { LandmarkRatios } from './landmarkEngine'
import { MotionFilter } from '@/utils/smoothing'

const AGE_ALPHA = 0.25

/** Assemble the smoothed oriented box, or null if landmarks never arrived. */
function buildOrientedBox(track: Track): OrientedBox | null {
  if (!track.obbCenterX || !track.obbCenterY || !track.obbWidth || !track.obbHeight || !track.obbAngle) {
    return null
  }
  return {
    centerX: track.obbCenterX.value,
    centerY: track.obbCenterY.value,
    width: Math.max(4, track.obbWidth.value),
    height: Math.max(4, track.obbHeight.value),
    angle: track.obbAngle.value,
  }
}

interface Track {
  id: number
  centerX: MotionFilter
  centerY: MotionFilter
  width: MotionFilter
  height: MotionFilter
  expressions: EmotionScores
  /** False until the emotion net has produced at least one reading. */
  hasEmotionData: boolean
  /** Mean luminance of the last crop, 0–255. */
  luminance: number
  /** Whether contrast equalization was applied to the last crop. */
  wasEnhanced: boolean
  /** Latest geometric ratios (ensemble Engine 2 evidence). */
  landmarkRatios: LandmarkRatios | null
  /** Smoothed oriented-box channels; null until landmarks first arrive. */
  obbCenterX: MotionFilter | null
  obbCenterY: MotionFilter | null
  obbWidth: MotionFilter | null
  obbHeight: MotionFilter | null
  obbAngle: MotionFilter | null
  age: number | null
  genderVotes: { male: number; female: number }
  bornAt: number
  lastUpdatedAt: number
  missedFrames: number
  status: TrackStatus
  expiringSince: number
}

function getDominant(scores: EmotionScores): { emotion: Emotion; confidence: number } {
  let best = Emotion.Neutral
  let bestValue = -1
  for (const [key, value] of Object.entries(scores) as [Emotion, number][]) {
    if (value > bestValue) {
      bestValue = value
      best = key
    }
  }
  return { emotion: best, confidence: Math.max(0, bestValue) }
}

export class FaceTracker {
  private tracks = new Map<number, Track>()
  private nextId = 1
  /** Monotonic timestamp of the last update()/coast() call. */
  private lastCoastAt = 0
  /**
   * Maximum simultaneously tracked faces. Defaults to the configured env
   * cap; the live loop passes the adaptive preset's cap instead.
   */
  private readonly maxFaces: number

  constructor(maxFaces: number = MAX_FACES) {
    this.maxFaces = maxFaces
  }

  /** Drop all state. Called when a session starts. */
  reset(): void {
    this.tracks.clear()
    this.nextId = 1
    this.lastCoastAt = 0
  }

  /**
   * Advance active tracks by their velocity WITHOUT running detection.
   *
   * Called on frames between detection passes so bounding boxes keep gliding
   * at display rate. Deliberately:
   *  • does NOT age tracks toward occlusion/retirement (we didn't look, so
   *    a miss would be a false negative), and
   *  • leaves occluded tracks frozen at their last known position, per the
   *    occlusion spec ("box at last known position").
   */
  coast(nowMs: number): TrackedFace[] {
    const reference = this.lastCoastAt || nowMs
    const dt = Math.max(0, (nowMs - reference) / 1000)
    if (dt > 0) {
      for (const track of this.tracks.values()) {
        if (track.status !== 'active') continue
        track.centerX.coast(dt)
        track.centerY.coast(dt)
        // Size has no new information this frame — hold it steady.
        track.lastUpdatedAt = nowMs
      }
    }
    this.lastCoastAt = nowMs
    return this.snapshot()
  }

  /** Number of tracks that are not already fading out. */
  get liveCount(): number {
    let count = 0
    for (const track of this.tracks.values()) {
      if (track.status !== 'expiring') count += 1
    }
    return count
  }

  /**
   * Advance the tracker by one frame.
   * @param detections NMS-filtered detections in source pixels
   * @param nowMs monotonic clock (performance.now)
   */
  update(detections: DetectedFace[], nowMs: number): TrackedFace[] {
    this.lastCoastAt = nowMs
    const candidates = detections.map((detection) => ({
      detection,
      centerX: detection.box.x + detection.box.width / 2,
      centerY: detection.box.y + detection.box.height / 2,
      isClaimed: false,
    }))

    // ── match detections to predicted track positions ──
    interface Pairing {
      track: Track
      index: number
      distance: number
    }
    const pairings: Pairing[] = []

    for (const track of this.tracks.values()) {
      if (track.status === 'expiring') continue
      const dt = Math.max(0.001, (nowMs - track.lastUpdatedAt) / 1000)
      const isOccluded = track.status === 'occluded'
      const predictedX = isOccluded ? track.centerX.value : track.centerX.predict(dt)
      const predictedY = isOccluded ? track.centerY.value : track.centerY.predict(dt)
      // A re-appearing face may have moved further, so widen the gate.
      const radius = isOccluded
        ? Math.min(220, Math.max(90, track.width.value * 1.1))
        : Math.min(150, Math.max(60, track.width.value * 0.8))

      candidates.forEach((candidate, index) => {
        const distance = Math.hypot(candidate.centerX - predictedX, candidate.centerY - predictedY)
        if (distance < radius) pairings.push({ track, index, distance })
      })
    }

    pairings.sort((a, b) => a.distance - b.distance)
    const claimedTracks = new Set<number>()
    for (const pairing of pairings) {
      const candidate = candidates[pairing.index]
      if (!candidate || candidate.isClaimed || claimedTracks.has(pairing.track.id)) continue
      candidate.isClaimed = true
      claimedTracks.add(pairing.track.id)
      this.correctTrack(pairing.track, candidate.detection, candidate.centerX, candidate.centerY, nowMs)
    }

    // ── age out unmatched tracks ──
    for (const track of [...this.tracks.values()]) {
      if (claimedTracks.has(track.id)) continue
      if (track.status === 'expiring') {
        if (nowMs - track.expiringSince > OCCLUSION_FADE_MS) this.tracks.delete(track.id)
        continue
      }
      track.missedFrames += 1
      if (track.missedFrames >= 2 && track.status === 'active') track.status = 'occluded'
      if (track.missedFrames >= MAX_MISSED_FRAMES) {
        track.status = 'expiring'
        track.expiringSince = nowMs
      }
    }

    // ── spawn tracks for unclaimed detections ──
    for (const candidate of candidates) {
      if (candidate.isClaimed) continue
      if (this.liveCount >= this.maxFaces) continue
      this.createTrack(candidate.detection, candidate.centerX, candidate.centerY, nowMs)
    }

    return this.snapshot()
  }

  private correctTrack(
    track: Track,
    detection: DetectedFace,
    centerX: number,
    centerY: number,
    nowMs: number,
  ): void {
    const dt = Math.max(0.016, (nowMs - track.lastUpdatedAt) / 1000)

    /*
     * ADAPTIVE GAIN — the single biggest contributor to perceived
     * tracking quality. A fixed alpha forces a choice: low values look
     * rock-steady on a still face but lag visibly during fast movement,
     * high values track tightly but shimmer when the subject is still.
     *
     * Interpolating the gain on current speed gets both behaviours. Speed
     * is normalized by face width so the response is identical whether the
     * subject is close to the camera or far from it.
     */
    const speed = Math.hypot(track.centerX.rate, track.centerY.rate)
    const faceWidths = speed / Math.max(1, track.width.value)
    const t = Math.min(1, faceWidths / VELOCITY_FULL_RESPONSE)
    const adaptiveAlpha = ALPHA_STILL + (ALPHA_FAST - ALPHA_STILL) * t

    track.centerX.correct(centerX, dt, adaptiveAlpha, VELOCITY_GAIN)
    track.centerY.correct(centerY, dt, adaptiveAlpha, VELOCITY_GAIN)
    // Size uses gentler gains so the box doesn't "breathe" frame to frame.
    track.width.correct(detection.box.width, dt, SIZE_ALPHA, SIZE_VELOCITY_GAIN)
    track.height.correct(detection.box.height, dt, SIZE_ALPHA, SIZE_VELOCITY_GAIN)
    /*
     * Expressions are stored RAW. Temporal smoothing is owned entirely by
     * EmotionStabilizer's weighted window downstream; applying an EMA here
     * too would compound the two filters and roughly double the latency of
     * a genuine expression change. The tracker's job is geometry.
     *
     * The tiered scheduler skips the emotion net on most frames; when it
     * does, the previous vector is kept rather than decaying toward zero.
     */
    if (detection.expressions) {
      track.expressions = detection.expressions
      track.hasEmotionData = true
    }
    if (typeof detection.luminance === 'number') track.luminance = detection.luminance
    track.wasEnhanced = detection.wasEnhanced === true

    /*
     * Oriented box — smoothed on its own channels so the HUD rotates with
     * head roll. Angle uses the SIZE gains rather than the adaptive
     * position gain: roll changes slowly, and a twitchy rotation is far
     * more noticeable than a twitchy translation.
     *
     * The measured angle is unwrapped against the current estimate before
     * correction. atan2 output jumps between −π/2 and +π/2 at the
     * boundary, and feeding that discontinuity to a linear filter would
     * spin the box the long way round.
     */
    const obb = detection.orientedBox
    if (obb) {
      if (!track.obbAngle) {
        track.obbCenterX = new MotionFilter(obb.centerX)
        track.obbCenterY = new MotionFilter(obb.centerY)
        track.obbWidth = new MotionFilter(obb.width)
        track.obbHeight = new MotionFilter(obb.height)
        track.obbAngle = new MotionFilter(obb.angle)
      } else {
        track.obbCenterX?.correct(obb.centerX, dt, adaptiveAlpha, VELOCITY_GAIN)
        track.obbCenterY?.correct(obb.centerY, dt, adaptiveAlpha, VELOCITY_GAIN)
        track.obbWidth?.correct(obb.width, dt, SIZE_ALPHA, SIZE_VELOCITY_GAIN)
        track.obbHeight?.correct(obb.height, dt, SIZE_ALPHA, SIZE_VELOCITY_GAIN)

        let measured = obb.angle
        const current = track.obbAngle.value
        while (measured - current > Math.PI / 2) measured -= Math.PI
        while (measured - current < -Math.PI / 2) measured += Math.PI
        track.obbAngle.correct(measured, dt, SIZE_ALPHA, SIZE_VELOCITY_GAIN)
      }
    }
    track.status = 'active'
    track.missedFrames = 0
    track.lastUpdatedAt = nowMs

    // Age/gender only arrive on throttled frames; accumulate rather than replace.
    if (typeof detection.age === 'number') {
      track.age =
        track.age === null ? detection.age : track.age + (detection.age - track.age) * AGE_ALPHA
    }
    if (detection.gender) {
      track.genderVotes[detection.gender] += detection.genderProbability ?? 0.5
    }
  }

  private createTrack(
    detection: DetectedFace,
    centerX: number,
    centerY: number,
    nowMs: number,
  ): void {
    const id = this.nextId
    this.nextId += 1
    this.tracks.set(id, {
      id,
      centerX: new MotionFilter(centerX),
      centerY: new MotionFilter(centerY),
      width: new MotionFilter(detection.box.width),
      height: new MotionFilter(detection.box.height),
      expressions: detection.expressions ? { ...detection.expressions } : createEmptyScores(),
      hasEmotionData: detection.expressions !== undefined,
      luminance: detection.luminance ?? 255,
      wasEnhanced: detection.wasEnhanced === true,
      landmarkRatios: detection.landmarkRatios ?? null,
      obbCenterX: detection.orientedBox ? new MotionFilter(detection.orientedBox.centerX) : null,
      obbCenterY: detection.orientedBox ? new MotionFilter(detection.orientedBox.centerY) : null,
      obbWidth: detection.orientedBox ? new MotionFilter(detection.orientedBox.width) : null,
      obbHeight: detection.orientedBox ? new MotionFilter(detection.orientedBox.height) : null,
      obbAngle: detection.orientedBox ? new MotionFilter(detection.orientedBox.angle) : null,
      age: typeof detection.age === 'number' ? detection.age : null,
      genderVotes: {
        male: detection.gender === 'male' ? (detection.genderProbability ?? 0.5) : 0,
        female: detection.gender === 'female' ? (detection.genderProbability ?? 0.5) : 0,
      },
      bornAt: nowMs,
      lastUpdatedAt: nowMs,
      missedFrames: 0,
      status: 'active',
      expiringSince: 0,
    })
  }

  private snapshot(): TrackedFace[] {
    const faces: TrackedFace[] = []
    for (const track of this.tracks.values()) {
      const totalVotes = track.genderVotes.male + track.genderVotes.female
      let gender: Gender | null = null
      if (totalVotes > 0) {
        gender = track.genderVotes.male >= track.genderVotes.female ? 'male' : 'female'
      }
      const dominant = getDominant(track.expressions)
      faces.push({
        id: track.id,
        box: {
          x: track.centerX.value - track.width.value / 2,
          y: track.centerY.value - track.height.value / 2,
          width: Math.max(4, track.width.value),
          height: Math.max(4, track.height.value),
        },
        expressions: { ...track.expressions },
        dominant: dominant.emotion,
        confidence: dominant.confidence,
        status: track.status,
        bornAt: track.bornAt,
        age: track.age,
        gender,
        genderConfidence: gender && totalVotes > 0 ? track.genderVotes[gender] / totalVotes : 0,
        // Emotion semantics are decided downstream by the stabilizer; the
        // tracker only reports raw geometry and the smoothed vector.
        isLowConfidence: !track.hasEmotionData,
        luminance: track.luminance,
        wasEnhanced: track.wasEnhanced,
        landmarkRatios: track.landmarkRatios,
        orientedBox: buildOrientedBox(track),
      })
    }
    return faces.sort((a, b) => a.id - b.id)
  }
}
