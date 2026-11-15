/**
 * emotionAnalyzer — everything that turns tracked faces into meaning:
 * label stabilisation, transition detection, session aggregation and
 * two-person comparison metrics.
 *
 * Deliberately framework-free so the logic is testable in isolation.
 */
import {
  Emotion,
  EMOTIONS,
  createEmptyScores,
  type EmotionScores,
  type EmotionSnapshot,
  type MirrorEvent,
  type TransitionEvent,
} from '@/types/emotion'
import type {
  Gender,
  TrackedFace,
  VideoAnalytics,
  VideoFace,
  VideoFrame,
  VideoPersonSummary,
} from '@/types/face'
import type { SessionStats } from '@/types/session'
import {
  BASELINE_SUBTRACT_RATIO,
  CALIBRATION_MS,
  COMPARISON_GRACE_SEC,
  EMOTION_THRESHOLDS,
  HYSTERESIS_FRAMES,
  HYSTERESIS_MARGIN,
  MIRROR_WINDOW_SEC,
  MODE_WINDOW_SIZE,
  SUDDEN_TRANSITION_MS,
  TRANSITION_MIN_FRAMES,
  TRANSITION_STABLE_MS,
} from '@/utils/constants'
import { createId } from '@/utils/formatters'
import { getMode, subtractBaseline } from '@/utils/smoothing'
import { TemporalEmotionFilter, topEmotion } from '@/utils/temporalFilter'

export function getDominantEmotion(scores: EmotionScores): {
  emotion: Emotion
  confidence: number
} {
  let best = Emotion.Neutral
  let bestValue = -1
  for (const emotion of EMOTIONS) {
    const value = scores[emotion]
    if (value > bestValue) {
      bestValue = value
      best = emotion
    }
  }
  return { emotion: best, confidence: Math.max(0, bestValue) }
}

/** Emotion with the most accumulated time in a distribution. */
export function getDistributionLeader(distribution: EmotionScores): Emotion {
  let best = Emotion.Neutral
  let bestValue = 0
  for (const emotion of EMOTIONS) {
    if (distribution[emotion] > bestValue) {
      bestValue = distribution[emotion]
      best = emotion
    }
  }
  return best
}

/** Mean of every visible face's scores — the "room" emotion. */
export function averageScores(faces: readonly TrackedFace[]): EmotionScores {
  const result = createEmptyScores()
  if (faces.length === 0) return result
  for (const face of faces) {
    for (const emotion of EMOTIONS) {
      result[emotion] += face.expressions[emotion] / faces.length
    }
  }
  return result
}

/* ── Temporal stabilization (Part A.2) ──────────────────────────── */

interface StabilizerState {
  /** Smoothed probability vector S_t. */
  smoothed: EmotionScores
  /** Emotion currently holding the display lock. */
  locked: Emotion
  /** Challenger that has been beating the incumbent, and for how long. */
  challenger: { emotion: Emotion; frames: number } | null
  /** Resting-face baseline accumulation. */
  baselineSum: EmotionScores
  baselineFrames: number
  baseline: EmotionScores | null
  calibrationStartedMs: number
  isInitialized: boolean
}

export interface StabilizedResult {
  scores: EmotionScores
  dominant: Emotion
  confidence: number
  isLowConfidence: boolean
}

/**
 * Turns noisy per-frame probability vectors into a stable label.
 *
 * Three independent mechanisms, in order:
 *  1. EMA over the probability distribution removes frame-to-frame noise
 *     while keeping the full vector meaningful for the bar chart.
 *  2. Hysteresis stops the label oscillating when two emotions sit within
 *     a few percent: a challenger must lead by a margin AND hold it for
 *     several consecutive frames before it takes the display lock.
 *  3. A confidence floor refuses to assert a label the model isn't sure
 *     about, falling back to Neutral and flagging the uncertainty.
 *
 * Plus a per-person resting-face baseline, captured over the first seconds
 * of tracking, which corrects for individuals the model reads as mildly
 * Sad or Angry at rest.
 */
export class EmotionStabilizer {
  private people = new Map<number, StabilizerState>()
  private filter = new TemporalEmotionFilter()

  reset(): void {
    this.people.clear()
    this.filter.reset()
  }

  /** Drop state for people who are no longer tracked. */
  retainOnly(ids: readonly number[]): void {
    const keep = new Set(ids)
    for (const id of [...this.people.keys()]) {
      if (!keep.has(id)) this.people.delete(id)
    }
    this.filter.retainOnly(ids)
  }

  /** Restart baseline capture — backs the "Recalibrate" control. */
  recalibrate(nowMs: number): void {
    for (const state of this.people.values()) {
      state.baseline = null
      state.baselineSum = createEmptyScores()
      state.baselineFrames = 0
      state.calibrationStartedMs = nowMs
    }
  }

  /** True while any tracked person is still capturing their baseline. */
  isCalibrating(nowMs: number): boolean {
    for (const state of this.people.values()) {
      if (state.baseline === null && nowMs - state.calibrationStartedMs < CALIBRATION_MS) {
        return true
      }
    }
    return false
  }

  /**
   * Fold one reading into a person's stabilized state.
   *
   * @param personId  Stable track id.
   * @param raw       Fresh probability vector, or null on frames where the
   *                  emotion net was skipped (state is returned unchanged).
   * @param nowMs     Monotonic clock.
   */
  update(personId: number, raw: EmotionScores | null, nowMs: number): StabilizedResult {
    let state = this.people.get(personId)
    if (!state) {
      state = {
        smoothed: raw ? { ...raw } : createEmptyScores(),
        locked: Emotion.Neutral,
        challenger: null,
        baselineSum: createEmptyScores(),
        baselineFrames: 0,
        baseline: null,
        calibrationStartedMs: nowMs,
        isInitialized: raw !== null,
      }
      this.people.set(personId, state)
    }

    if (raw) {
      // ── baseline capture ──
      if (state.baseline === null) {
        if (nowMs - state.calibrationStartedMs < CALIBRATION_MS) {
          for (const emotion of EMOTIONS) state.baselineSum[emotion] += raw[emotion]
          state.baselineFrames += 1
        } else if (state.baselineFrames > 0) {
          const averaged = createEmptyScores()
          for (const emotion of EMOTIONS) {
            averaged[emotion] = state.baselineSum[emotion] / state.baselineFrames
          }
          state.baseline = averaged
        } else {
          // No readings during the window (face arrived late) — restart.
          state.calibrationStartedMs = nowMs
        }
      }

      const corrected = state.baseline
        ? subtractBaseline(raw, state.baseline, BASELINE_SUBTRACT_RATIO)
        : raw

      // ── temporal smoothing: weighted window over recent readings ──
      state.smoothed = this.filter.push(personId, corrected)
      state.isInitialized = true

      // ── adaptive hysteresis ──
      // A challenger takes the display lock only when it clears its OWN
      // threshold and leads the incumbent by the margin for N consecutive
      // readings. Everything else leaves the current label untouched.
      const top = topEmotion(state.smoothed)
      const meetsOwnThreshold = top.value >= EMOTION_THRESHOLDS[top.emotion]

      if (top.emotion === state.locked) {
        state.challenger = null
      } else if (meetsOwnThreshold) {
        const margin = top.value - state.smoothed[state.locked]
        if (margin >= HYSTERESIS_MARGIN) {
          state.challenger =
            state.challenger && state.challenger.emotion === top.emotion
              ? { emotion: top.emotion, frames: state.challenger.frames + 1 }
              : { emotion: top.emotion, frames: 1 }
          if (state.challenger.frames >= HYSTERESIS_FRAMES) {
            state.locked = top.emotion
            state.challenger = null
          }
        } else {
          state.challenger = null
        }
      } else {
        state.challenger = null
      }
    } else if (state.isInitialized) {
      // Skipped-inference frame: replay the existing window so the label
      // holds steady instead of decaying between emotion passes.
      const held = this.filter.peek(personId)
      if (held) state.smoothed = held
    }

    // ── uncertainty fallback ──
    // If the locked emotion no longer clears its own threshold, nothing is
    // confident enough to assert — fall back to Neutral and flag it.
    const lockedConfidence = state.smoothed[state.locked]
    const isLowConfidence =
      !state.isInitialized || lockedConfidence < EMOTION_THRESHOLDS[state.locked]
    return {
      scores: state.smoothed,
      dominant: isLowConfidence ? Emotion.Neutral : state.locked,
      confidence: isLowConfidence ? state.smoothed[Emotion.Neutral] : lockedConfidence,
      isLowConfidence,
    }
  }
}

interface PersonState {
  history: Emotion[]
  display: Emotion
  stable: Emotion
  candidate: { emotion: Emotion; sinceMs: number; frames: number } | null
}

/**
 * Stabilises labels and emits transitions.
 *
 * Two independent guards stop noise becoming a false transition:
 *  1. the displayed emotion is the MODE of the last N frames, and
 *  2. a change must then hold for both a minimum time AND a minimum
 *     number of consecutive frames.
 */
export class EmotionAnalyzer {
  private people = new Map<number, PersonState>()

  reset(): void {
    this.people.clear()
  }

  /** Forget a person once their track is retired (prevents stale state). */
  forget(personId: number): void {
    this.people.delete(personId)
  }

  /** Retain only the given ids. */
  retainOnly(ids: readonly number[]): void {
    const keep = new Set(ids)
    for (const id of [...this.people.keys()]) {
      if (!keep.has(id)) this.people.delete(id)
    }
  }

  /** Stabilised label for a face; call once per face per frame. */
  getStableEmotion(face: TrackedFace): Emotion {
    const state = this.ensure(face)
    return state.display
  }

  /**
   * Feed one frame and collect any transitions that became final.
   * @param sessionT seconds since session start (used for the log timestamp)
   */
  process(faces: readonly TrackedFace[], nowMs: number, sessionT: number): TransitionEvent[] {
    const events: TransitionEvent[] = []
    for (const face of faces) {
      if (face.status !== 'active') continue
      const state = this.ensure(face)

      state.history.push(face.dominant)
      if (state.history.length > MODE_WINDOW_SIZE) state.history.shift()
      state.display = getMode(state.history, face.dominant)

      if (state.display === state.stable) {
        state.candidate = null
        continue
      }
      if (state.candidate && state.candidate.emotion === state.display) {
        state.candidate.frames += 1
        const heldMs = nowMs - state.candidate.sinceMs
        if (heldMs >= TRANSITION_STABLE_MS && state.candidate.frames >= TRANSITION_MIN_FRAMES) {
          events.push({
            id: createId(),
            t: sessionT,
            personId: face.id,
            from: state.stable,
            to: state.display,
            speed: heldMs < SUDDEN_TRANSITION_MS ? 'sudden' : 'gradual',
          })
          state.stable = state.display
          state.candidate = null
        }
      } else {
        state.candidate = { emotion: state.display, sinceMs: nowMs, frames: 1 }
      }
    }
    return events
  }

  private ensure(face: TrackedFace): PersonState {
    const existing = this.people.get(face.id)
    if (existing) return existing
    const created: PersonState = {
      history: [face.dominant],
      display: face.dominant,
      stable: face.dominant,
      candidate: null,
    }
    this.people.set(face.id, created)
    return created
  }
}

/* ── Comparative analysis ───────────────────────────────────────── */

export interface ComparisonPerson {
  id: number
  dominant: Emotion
  confidence: number
  age: number | null
  gender: Gender | null
  avgIntensity: number
}

export interface GanttSegment {
  emotion: Emotion
  start: number
  end: number
}

export interface ComparisonSample {
  t: number
  a: number
  b: number
  same: boolean
}

export type SynchronyTone = 'danger' | 'warning' | 'success' | 'accent'

export interface ComparisonState {
  isActive: boolean
  people: ComparisonPerson[]
  extraFaces: number
  synchrony: number
  synchronyLabel: { text: string; tone: SynchronyTone }
  sharedFrames: number
  dominanceDelta: number
  mirrorEvents: MirrorEvent[]
  lanes: Record<number, GanttSegment[]>
  series: ComparisonSample[]
}

export function getSynchronyLabel(value: number): { text: string; tone: SynchronyTone } {
  const percent = value * 100
  if (percent <= 30) return { text: 'Low Alignment', tone: 'danger' }
  if (percent <= 60) return { text: 'Moderate Alignment', tone: 'warning' }
  if (percent <= 85) return { text: 'High Alignment', tone: 'success' }
  return { text: 'Strong Alignment', tone: 'accent' }
}

export function createIdleComparison(): ComparisonState {
  return {
    isActive: false,
    people: [],
    extraFaces: 0,
    synchrony: 0,
    synchronyLabel: getSynchronyLabel(0),
    sharedFrames: 0,
    dominanceDelta: 0,
    mirrorEvents: [],
    lanes: {},
    series: [],
  }
}

const MAX_SERIES = 240
const MAX_LANE_SEGMENTS = 400

interface PersonAggregate {
  confidenceSum: number
  frames: number
  age: number | null
  gender: Gender | null
}

/** Tracks synchrony, dominance and mirroring for the two largest faces. */
export class ComparisonAnalyzer {
  private aggregates = new Map<number, PersonAggregate>()
  private lanes = new Map<number, GanttSegment[]>()
  private series: ComparisonSample[] = []
  private recentTransitions: TransitionEvent[] = []
  private mirrors: MirrorEvent[] = []
  private pair: [number, number] | null = null
  private sharedFrames = 0
  private matchingFrames = 0
  private lastPairT = 0
  private currentT = 0
  private cachedPeople: ComparisonPerson[] = []
  /** Set when a compared partner disappears; read and cleared by the caller. */
  departedPersonId: number | null = null

  reset(): void {
    this.aggregates.clear()
    this.lanes.clear()
    this.series = []
    this.recentTransitions = []
    this.mirrors = []
    this.pair = null
    this.sharedFrames = 0
    this.matchingFrames = 0
    this.lastPairT = 0
    this.currentT = 0
    this.cachedPeople = []
    this.departedPersonId = null
  }

  get mirrorCount(): number {
    return this.mirrors.length
  }

  observe(faces: readonly TrackedFace[], sessionT: number): void {
    this.currentT = sessionT
    const active = faces.filter((face) => face.status === 'active')

    for (const face of active) {
      const aggregate = this.aggregates.get(face.id) ?? {
        confidenceSum: 0,
        frames: 0,
        age: null,
        gender: null,
      }
      aggregate.confidenceSum += face.confidence
      aggregate.frames += 1
      if (face.age !== null) aggregate.age = face.age
      if (face.gender) aggregate.gender = face.gender
      this.aggregates.set(face.id, aggregate)

      const lane = this.lanes.get(face.id) ?? []
      const last = lane[lane.length - 1]
      if (last && last.emotion === face.dominant) {
        last.end = sessionT
      } else {
        if (last) last.end = sessionT
        lane.push({ emotion: face.dominant, start: sessionT, end: sessionT })
        if (lane.length > MAX_LANE_SEGMENTS) lane.shift()
      }
      this.lanes.set(face.id, lane)
    }

    // Bound memory: person IDs are monotonic and never reused, so aggregates
    // and Gantt lanes for anyone no longer tracked (including occluded
    // ghosts, which still appear in `faces`) would otherwise accumulate
    // forever in a long session with people coming and going.
    const presentIds = new Set(faces.map((face) => face.id))
    for (const id of [...this.aggregates.keys()]) {
      if (!presentIds.has(id)) this.aggregates.delete(id)
    }
    for (const id of [...this.lanes.keys()]) {
      if (!presentIds.has(id)) this.lanes.delete(id)
    }

    const prominent = [...active]
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)
      .slice(0, 2)

    if (prominent.length === 2) {
      const [first, second] = prominent as [TrackedFace, TrackedFace]
      const key: [number, number] =
        first.id < second.id ? [first.id, second.id] : [second.id, first.id]
      const isNewPair = !this.pair || this.pair[0] !== key[0] || this.pair[1] !== key[1]
      if (isNewPair) {
        this.pair = key
        this.sharedFrames = 0
        this.matchingFrames = 0
        this.series = []
      }
      this.sharedFrames += 1
      if (first.dominant === second.dominant) this.matchingFrames += 1
      this.lastPairT = sessionT
    } else if (this.pair && sessionT - this.lastPairT > COMPARISON_GRACE_SEC) {
      const present = new Set(active.map((face) => face.id))
      const [a, b] = this.pair
      const missing = !present.has(a) ? a : !present.has(b) ? b : null
      if (missing !== null) this.departedPersonId = missing
      this.pair = null
      this.cachedPeople = []
    }
  }

  /** Append one point to the confidence series (call at UI rate, not frame rate). */
  sample(faces: readonly TrackedFace[], sessionT: number): void {
    if (!this.pair) return
    const [idA, idB] = this.pair
    const a = faces.find((face) => face.id === idA && face.status === 'active')
    const b = faces.find((face) => face.id === idB && face.status === 'active')
    if (!a || !b) return
    this.series.push({
      t: Math.round(sessionT * 10) / 10,
      a: Math.round(a.confidence * 100) / 100,
      b: Math.round(b.confidence * 100) / 100,
      same: a.dominant === b.dominant,
    })
    if (this.series.length > MAX_SERIES) this.series.shift()
  }

  /** Detect mirroring: another person adopting the same emotion shortly after. */
  noteTransitions(events: readonly TransitionEvent[]): void {
    for (const event of events) {
      const leader = this.recentTransitions.find(
        (candidate) =>
          candidate.personId !== event.personId &&
          candidate.to === event.to &&
          event.t >= candidate.t &&
          event.t - candidate.t <= MIRROR_WINDOW_SEC,
      )
      if (leader) {
        this.mirrors.unshift({
          id: createId(),
          t: event.t,
          leaderId: leader.personId,
          followerId: event.personId,
          emotion: event.to,
          delaySec: Math.max(0.1, Math.round((event.t - leader.t) * 10) / 10),
        })
        if (this.mirrors.length > 40) this.mirrors.pop()
      }
      this.recentTransitions.push(event)
      this.recentTransitions = this.recentTransitions.filter(
        (candidate) => event.t - candidate.t <= MIRROR_WINDOW_SEC + 1,
      )
    }
  }

  getState(faces: readonly TrackedFace[]): ComparisonState {
    const idle = createIdleComparison()
    idle.mirrorEvents = this.mirrors.slice(0, 20)
    if (!this.pair) return idle

    const active = faces.filter((face) => face.status === 'active')
    const [idA, idB] = this.pair
    const faceA = active.find((face) => face.id === idA)
    const faceB = active.find((face) => face.id === idB)

    const build = (face: TrackedFace): ComparisonPerson => {
      const aggregate = this.aggregates.get(face.id)
      return {
        id: face.id,
        dominant: face.dominant,
        confidence: face.confidence,
        age: aggregate?.age ?? face.age,
        gender: aggregate?.gender ?? face.gender,
        avgIntensity:
          aggregate && aggregate.frames > 0
            ? aggregate.confidenceSum / aggregate.frames
            : face.confidence,
      }
    }

    let people: ComparisonPerson[]
    if (faceA && faceB) {
      people = [build(faceA), build(faceB)]
      this.cachedPeople = people
    } else if (
      this.cachedPeople.length === 2 &&
      this.currentT - this.lastPairT <= COMPARISON_GRACE_SEC
    ) {
      // Hold the last pair briefly so a blink doesn't collapse the layout.
      people = this.cachedPeople
    } else {
      return idle
    }

    const [personA, personB] = people as [ComparisonPerson, ComparisonPerson]
    const synchrony = this.sharedFrames > 0 ? this.matchingFrames / this.sharedFrames : 0
    const lanes: Record<number, GanttSegment[]> = {}
    for (const id of [idA, idB]) {
      const lane = this.lanes.get(id)
      if (lane) lanes[id] = lane
    }

    return {
      isActive: true,
      people,
      extraFaces: Math.max(0, active.length - 2),
      synchrony,
      synchronyLabel: getSynchronyLabel(synchrony),
      sharedFrames: this.sharedFrames,
      dominanceDelta: personA.avgIntensity - personB.avgIntensity,
      mirrorEvents: this.mirrors.slice(0, 20),
      lanes,
      series: [...this.series],
    }
  }
}

/* ── Session aggregation ────────────────────────────────────────── */

export function createEmptyStats(): SessionStats {
  return {
    durationSec: 0,
    faceCount: 0,
    peakFaces: 0,
    transitionCount: 0,
    mirrorCount: 0,
    avgIntensity: 0,
    distribution: createEmptyScores(),
    dominantEmotion: Emotion.Neutral,
  }
}

/* ── Video analytics ────────────────────────────────────────────── */

/**
 * Derive the full per-video analytics (timeline, distribution, per-person
 * summaries, synchrony, mirroring) from processed frames and transitions.
 * Extracted from the page so the Video tab renders data it is handed
 * rather than computing it in a render function.
 */
export function buildVideoAnalytics(
  frames: readonly VideoFrame[],
  transitions: readonly TransitionEvent[],
  sampleFps: number,
): VideoAnalytics {
  const timeline: EmotionSnapshot[] = []
  const distribution = createEmptyScores()
  const perPerson = new Map<
    number,
    {
      frames: number
      distribution: EmotionScores
      age: number | null
      gender: Gender | null
      confidenceSum: number
    }
  >()
  let peakFaces = 0
  let confidenceSum = 0
  let confidenceCount = 0
  let sharedFrames = 0
  let matchingFrames = 0

  for (const frame of frames) {
    peakFaces = Math.max(peakFaces, frame.faces.length)

    if (frame.faces.length > 0) {
      for (const face of frame.faces) {
        const entry = perPerson.get(face.id) ?? {
          frames: 0,
          distribution: createEmptyScores(),
          age: null,
          gender: null,
          confidenceSum: 0,
        }
        entry.frames += 1
        entry.distribution[face.dominant] += 1 / sampleFps
        entry.confidenceSum += face.confidence
        if (face.age !== null) entry.age = face.age
        if (face.gender) entry.gender = face.gender
        perPerson.set(face.id, entry)
      }

      const primary = frame.faces.reduce((largest, candidate) =>
        largest.width * largest.height > candidate.width * candidate.height ? largest : candidate,
      )
      distribution[primary.dominant] += 1 / sampleFps
      confidenceSum += primary.confidence
      confidenceCount += 1

      if (frame.faces.length >= 2) {
        const [first, second] = [...frame.faces].sort(
          (a, b) => b.width * b.height - a.width * a.height,
        )
        if (first && second) {
          sharedFrames += 1
          if (first.dominant === second.dominant) matchingFrames += 1
        }
      }
    }

    const averaged = createEmptyScores()
    for (const face of frame.faces) {
      for (const emotion of EMOTIONS) {
        averaged[emotion] += face.expressions[emotion] / frame.faces.length
      }
    }
    timeline.push({
      t: frame.t,
      faceCount: frame.faces.length,
      scores: averaged,
      dominant: getDominantEmotion(averaged).emotion,
    })
  }

  // Mirroring across the whole video: one person adopts another's emotion
  // within the mirror window.
  const mirrors: MirrorEvent[] = []
  const ordered = [...transitions].sort((a, b) => a.t - b.t)
  ordered.forEach((event, index) => {
    for (let j = index - 1; j >= 0; j -= 1) {
      const previous = ordered[j]
      if (!previous || event.t - previous.t > MIRROR_WINDOW_SEC) break
      if (previous.personId !== event.personId && previous.to === event.to) {
        mirrors.push({
          id: createId(),
          t: event.t,
          leaderId: previous.personId,
          followerId: event.personId,
          emotion: event.to,
          delaySec: Math.max(0.1, Math.round((event.t - previous.t) * 10) / 10),
        })
        break
      }
    }
  })

  const people: VideoPersonSummary[] = [...perPerson.entries()]
    .map(([id, entry]) => ({
      id,
      dominant: getDistributionLeader(entry.distribution),
      presenceSec: entry.frames / sampleFps,
      distribution: entry.distribution,
      avgConfidence: entry.frames > 0 ? entry.confidenceSum / entry.frames : 0,
      age: entry.age,
      gender: entry.gender,
      frames: entry.frames,
    }))
    .sort((a, b) => a.id - b.id)

  return {
    timeline,
    distribution,
    peakFaces,
    sharedFrames,
    synchrony: sharedFrames > 0 ? matchingFrames / sharedFrames : 0,
    mirrors,
    avgIntensity: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
    people,
  }
}

/** Largest face at one moment, used for per-frame breakdown and reports. */
export function getPrimaryVideoFace(frame: VideoFrame | undefined): VideoFace | null {
  if (!frame || frame.faces.length === 0) return null
  return frame.faces.reduce((largest, candidate) =>
    largest.width * largest.height > candidate.width * candidate.height ? largest : candidate,
  )
}

export function createSnapshot(faces: readonly TrackedFace[], sessionT: number): EmotionSnapshot {
  const scores = averageScores(faces)
  return {
    t: Math.round(sessionT * 10) / 10,
    faceCount: faces.length,
    scores,
    dominant: getDominantEmotion(scores).emotion,
  }
}
