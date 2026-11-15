/**
 * sessionStore — live analysis state and session recording.
 *
 * High-frequency data (30 fps tracked faces) is published here at the UI
 * rate only; the long-lived accumulators live in a non-reactive recorder
 * object so that appending a timeline sample never re-renders the tree.
 */
import { create } from 'zustand'
import {
  createEmptyScores,
  type Emotion,
  type EmotionScores,
  type EmotionSnapshot,
  type TransitionEvent,
} from '@/types/emotion'
import type { TrackedFace } from '@/types/face'
import type { Session, SessionStats } from '@/types/session'
import {
  createEmptyStats,
  createIdleComparison,
  getDistributionLeader,
  getDominantEmotion,
  type ComparisonState,
} from '@/services/emotionAnalyzer'
import { getIsPersistent, saveSession } from '@/services/sessionManager'
import {
  MAX_TIMELINE_ENTRIES,
  MAX_TRANSITION_ENTRIES,
  MIN_SESSION_SEC,
  TIMELINE_WINDOW_SAMPLES,
} from '@/utils/constants'
import { createId } from '@/utils/formatters'

/** Non-reactive accumulators for the session being recorded. */
interface Recorder {
  isRecording: boolean
  startedAtEpoch: number
  startedAtPerf: number
  fullTimeline: EmotionSnapshot[]
  allTransitions: TransitionEvent[]
  distribution: EmotionScores
  intensitySum: number
  intensityCount: number
  peakFaces: number
  hasSeenFace: boolean
  lastFullSampleMs: number
  lastDistributionT: number
}

function createRecorder(): Recorder {
  return {
    isRecording: false,
    startedAtEpoch: 0,
    startedAtPerf: 0,
    fullTimeline: [],
    allTransitions: [],
    distribution: createEmptyScores(),
    intensitySum: 0,
    intensityCount: 0,
    peakFaces: 0,
    hasSeenFace: false,
    lastFullSampleMs: 0,
    lastDistributionT: 0,
  }
}

let recorder = createRecorder()

export interface FramePayload {
  faces: TrackedFace[]
  comparison: ComparisonState
  sessionT: number
}

export interface StopSessionResult {
  session: Session | null
  /** False when the write fell back to the in-memory store. */
  isPersistent: boolean
  /** Sessions deleted to stay under the storage cap. */
  prunedCount: number
}

interface SessionState {
  isActive: boolean
  startedAt: number | null
  faces: TrackedFace[]
  timeline: EmotionSnapshot[]
  transitions: TransitionEvent[]
  stats: SessionStats
  comparison: ComparisonState
  pinnedPersonId: number | null

  startSession: () => void
  /**
   * Publish ONLY the tracked faces, at overlay rate (~30 Hz). Split from
   * publishFrame so boxes can glide at display speed without re-rendering
   * the heavier stats/comparison panels.
   */
  publishFaces: (faces: TrackedFace[]) => void
  /** Publish stats + comparison (called at UI rate, not detection rate). */
  publishFrame: (payload: FramePayload) => void
  /** Append transitions as they are confirmed. */
  addTransitions: (events: TransitionEvent[], mirrorCount: number) => void
  /** Record one timeline sample (2 Hz). */
  recordSample: (snapshot: EmotionSnapshot, sessionT: number) => void
  /**
   * Finish and persist.
   * `session` is null when the session was too short to keep; the other
   * fields report HOW it was persisted so callers can warn about private
   * browsing / storage pruning instead of failing silently.
   */
  stopSession: (source: 'live' | 'video') => Promise<StopSessionResult>
  setPinnedPersonId: (id: number | null) => void
  reset: () => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  isActive: false,
  startedAt: null,
  faces: [],
  timeline: [],
  transitions: [],
  stats: createEmptyStats(),
  comparison: createIdleComparison(),
  pinnedPersonId: null,

  startSession: () => {
    recorder = createRecorder()
    recorder.isRecording = true
    recorder.startedAtEpoch = Date.now()
    recorder.startedAtPerf = performance.now()
    set({
      isActive: true,
      startedAt: recorder.startedAtEpoch,
      faces: [],
      timeline: [],
      transitions: [],
      stats: createEmptyStats(),
      comparison: createIdleComparison(),
      pinnedPersonId: null,
    })
  },

  publishFaces: (faces) => {
    // Guard: never resurrect face data after the session has ended, or the
    // dashboard would show a stale face that already left.
    if (!recorder.isRecording) return
    set({ faces })
  },

  publishFrame: ({ faces, comparison, sessionT }) => {
    if (!recorder.isRecording) return
    const activeFaces = faces.filter((face) => face.status === 'active')
    if (activeFaces.length > recorder.peakFaces) recorder.peakFaces = activeFaces.length
    if (activeFaces.length > 0) recorder.hasSeenFace = true

    set((state) => ({
      faces,
      comparison,
      stats: {
        ...state.stats,
        durationSec: sessionT,
        faceCount: activeFaces.length,
        peakFaces: recorder.peakFaces,
      },
      // Clear a pin whose person has left, otherwise the hero panel would
      // keep showing a face that is no longer in frame.
      pinnedPersonId:
        state.pinnedPersonId !== null &&
        !activeFaces.some((face) => face.id === state.pinnedPersonId)
          ? null
          : state.pinnedPersonId,
    }))
  },

  addTransitions: (events, mirrorCount) => {
    if (events.length === 0 && get().stats.mirrorCount === mirrorCount) return
    if (events.length > 0) {
      recorder.allTransitions.push(...events)
      if (recorder.allTransitions.length > MAX_TRANSITION_ENTRIES) {
        recorder.allTransitions.splice(0, recorder.allTransitions.length - MAX_TRANSITION_ENTRIES)
      }
    }
    set((state) => ({
      transitions:
        events.length > 0
          ? [...events].reverse().concat(state.transitions).slice(0, 60)
          : state.transitions,
      stats: {
        ...state.stats,
        transitionCount: recorder.allTransitions.length,
        mirrorCount,
      },
    }))
  },

  recordSample: (snapshot, sessionT) => {
    if (!recorder.isRecording) return
    const nowMs = performance.now()

    // Rolling 60 s window for the live chart.
    set((state) => ({
      timeline: [...state.timeline.slice(-(TIMELINE_WINDOW_SAMPLES - 1)), snapshot],
    }))

    // Persisted timeline at 1 Hz, hard-capped so it cannot grow unbounded.
    if (nowMs - recorder.lastFullSampleMs >= 1000) {
      recorder.fullTimeline.push(snapshot)
      if (recorder.fullTimeline.length > MAX_TIMELINE_ENTRIES) recorder.fullTimeline.shift()
      recorder.lastFullSampleMs = nowMs
    }

    if (snapshot.faceCount > 0) {
      const delta =
        recorder.lastDistributionT > 0 ? Math.min(2, sessionT - recorder.lastDistributionT) : 0.5
      const dominant = getDominantEmotion(snapshot.scores)
      recorder.distribution[dominant.emotion] += delta
      recorder.intensitySum += dominant.confidence
      recorder.intensityCount += 1
    }
    recorder.lastDistributionT = sessionT

    const dominantEmotion: Emotion = getDistributionLeader(recorder.distribution)
    set((state) => ({
      stats: {
        ...state.stats,
        avgIntensity:
          recorder.intensityCount > 0 ? recorder.intensitySum / recorder.intensityCount : 0,
        distribution: { ...recorder.distribution },
        dominantEmotion,
      },
    }))
  },

  stopSession: async (source) => {
    if (!recorder.isRecording) {
      set({ isActive: false, faces: [] })
      return { session: null, isPersistent: getIsPersistent(), prunedCount: 0 }
    }
    recorder.isRecording = false
    const durationSec = (performance.now() - recorder.startedAtPerf) / 1000

    // Always clear live state, even if persistence fails below.
    set({
      isActive: false,
      faces: [],
      comparison: createIdleComparison(),
      pinnedPersonId: null,
    })

    const isWorthKeeping = recorder.hasSeenFace && durationSec >= MIN_SESSION_SEC
    if (!isWorthKeeping) return { session: null, isPersistent: getIsPersistent(), prunedCount: 0 }

    const session: Session = {
      id: createId(),
      startedAt: recorder.startedAtEpoch,
      endedAt: Date.now(),
      durationSec,
      peakFaces: recorder.peakFaces,
      dominantEmotion: getDistributionLeader(recorder.distribution),
      avgIntensity:
        recorder.intensityCount > 0 ? recorder.intensitySum / recorder.intensityCount : 0,
      transitions: [...recorder.allTransitions],
      distribution: { ...recorder.distribution },
      timeline: [...recorder.fullTimeline],
      source,
    }

    try {
      const result = await saveSession(session)
      return {
        session,
        isPersistent: result.isPersistent,
        prunedCount: result.prunedCount,
      }
    } catch (error) {
      console.error('[VISION AI] could not persist session', error)
      return { session: null, isPersistent: getIsPersistent(), prunedCount: 0 }
    }
  },

  setPinnedPersonId: (pinnedPersonId) => set({ pinnedPersonId }),

  reset: () => {
    recorder = createRecorder()
    set({
      isActive: false,
      startedAt: null,
      faces: [],
      timeline: [],
      transitions: [],
      stats: createEmptyStats(),
      comparison: createIdleComparison(),
      pinnedPersonId: null,
    })
  },
}))

