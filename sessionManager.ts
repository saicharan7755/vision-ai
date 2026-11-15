/**
 * sessionManager — durable storage for analysis sessions.
 *
 * Uses IndexedDB (Dexie) with an automatic in-memory fallback for private
 * browsing, where IndexedDB may be unavailable or throw on write. Every
 * record is validated on read so a single corrupt row can never blank out
 * the History page.
 */
import Dexie, { type EntityTable } from 'dexie'
import { notify } from '@/store/appStore'
import {
  EMOTIONS,
  createEmptyScores,
  isEmotion,
  type EmotionScores,
  type EmotionSnapshot,
  type TransitionEvent,
} from '@/types/emotion'
import type { Session } from '@/types/session'
import { MAX_STORED_SESSIONS } from '@/utils/constants'

interface VisionDatabase extends Dexie {
  sessions: EntityTable<Session, 'id'>
}

let database: VisionDatabase | null = null
let isPersistent = true
const memoryStore = new Map<string, Session>()

function getDatabase(): VisionDatabase | null {
  if (!isPersistent) return null
  if (database) return database
  try {
    if (typeof indexedDB === 'undefined') {
      isPersistent = false
      return null
    }
    const instance = new Dexie('vision-ai') as VisionDatabase
    instance.version(1).stores({ sessions: 'id, startedAt' })
    database = instance
    return instance
  } catch (error) {
    console.error('[VISION AI] IndexedDB unavailable, using memory store', error)
    isPersistent = false
    return null
  }
}

/** False when running without durable storage (e.g. private browsing). */
export function getIsPersistent(): boolean {
  return isPersistent
}

/* ── validation ─────────────────────────────────────────────────── */

function coerceScores(input: unknown): EmotionScores {
  const scores = createEmptyScores()
  if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isEmotion(key) && typeof value === 'number' && Number.isFinite(value)) {
        scores[key] = value
      }
    }
  }
  return scores
}

/**
 * Sanitize stored transitions. A record missing its id would surface as a
 * React "unique key" warning in the feed, and a bad emotion string would
 * break every color lookup — so malformed entries are dropped, not passed on.
 */
function coerceTransitions(input: unknown): TransitionEvent[] {
  if (!Array.isArray(input)) return []
  const result: TransitionEvent[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const id = record.id
    const t = Number(record.t)
    const personId = Number(record.personId)
    if (typeof id !== 'string' || id.length === 0) continue
    if (!Number.isFinite(t) || !Number.isFinite(personId)) continue
    if (typeof record.from !== 'string' || !isEmotion(record.from)) continue
    if (typeof record.to !== 'string' || !isEmotion(record.to)) continue
    result.push({
      id,
      t,
      personId,
      from: record.from,
      to: record.to,
      speed: record.speed === 'sudden' ? 'sudden' : 'gradual',
    })
  }
  return result
}

/** Sanitize stored timeline points (missing scores would render NaN in charts). */
function coerceTimeline(input: unknown): EmotionSnapshot[] {
  if (!Array.isArray(input)) return []
  const result: EmotionSnapshot[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const t = Number(record.t)
    if (!Number.isFinite(t) || t < 0) continue
    const scores = coerceScores(record.scores)
    const dominant =
      typeof record.dominant === 'string' && isEmotion(record.dominant)
        ? record.dominant
        : (EMOTIONS.find((emotion) => scores[emotion] > 0) ?? EMOTIONS[EMOTIONS.length - 1])
    result.push({
      t,
      faceCount: Number.isFinite(Number(record.faceCount)) ? Number(record.faceCount) : 0,
      scores,
      dominant,
    })
  }
  return result
}

/**
 * Repair a stored record into a valid Session, or return null if it is too
 * damaged to display. Never throws.
 */
export function validateSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Partial<Session> & Record<string, unknown>

  if (typeof record.id !== 'string' || record.id.length === 0) return null
  const startedAt = Number(record.startedAt)
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null

  const endedAt = Number.isFinite(Number(record.endedAt)) ? Number(record.endedAt) : startedAt
  const durationSec = Number.isFinite(Number(record.durationSec))
    ? Math.max(0, Number(record.durationSec))
    : Math.max(0, (endedAt - startedAt) / 1000)

  const dominant =
    typeof record.dominantEmotion === 'string' && isEmotion(record.dominantEmotion)
      ? record.dominantEmotion
      : EMOTIONS[EMOTIONS.length - 1]

  return {
    id: record.id,
    startedAt,
    endedAt,
    durationSec,
    peakFaces: Number.isFinite(Number(record.peakFaces)) ? Number(record.peakFaces) : 0,
    dominantEmotion: dominant,
    avgIntensity: Number.isFinite(Number(record.avgIntensity))
      ? Math.max(0, Math.min(1, Number(record.avgIntensity)))
      : 0,
    transitions: coerceTransitions(record.transitions),
    distribution: coerceScores(record.distribution),
    timeline: coerceTimeline(record.timeline),
    source:
      record.source === 'video' || record.source === 'calibrated'
        ? record.source
        : 'live',
  }
}

/* ── operations ─────────────────────────────────────────────────── */

export interface SaveResult {
  saved: boolean
  prunedCount: number
  isPersistent: boolean
}

/**
 * Persist a session, enforcing the storage cap by deleting the oldest
 * records so storage can never grow without bound.
 */
export async function saveSession(session: Session): Promise<SaveResult> {
  const db = getDatabase()
  let prunedCount = 0

  if (!db) {
    memoryStore.set(session.id, session)
    return { saved: true, prunedCount: 0, isPersistent: false }
  }

  try {
    await db.sessions.put(session)
    const total = await db.sessions.count()
    if (total > MAX_STORED_SESSIONS) {
      const excess = total - MAX_STORED_SESSIONS
      const oldest = await db.sessions.orderBy('startedAt').limit(excess).toArray()
      await db.sessions.bulkDelete(oldest.map((item) => item.id))
      prunedCount = oldest.length
    }
    return { saved: true, prunedCount, isPersistent: true }
  } catch (error) {
    // Quota exceeded is recoverable: clear the oldest half and retry once
    // so the user keeps their newest data instead of losing the save.
    const isQuotaError =
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' || error.name === 'QuotaExceeded')
    if (isQuotaError) {
      try {
        const all = await db.sessions.orderBy('startedAt').toArray()
        const removable = all.slice(0, Math.ceil(all.length / 2)).map((item) => item.id)
        await db.sessions.bulkDelete(removable)
        await db.sessions.put(session)
        notify(
          'warning',
          'Storage was full',
          `Removed ${removable.length} older session${removable.length === 1 ? '' : 's'} to free space.`,
        )
        return { saved: true, prunedCount: removable.length, isPersistent: true }
      } catch (retryError) {
        console.error('[VISION AI] session save retry failed', retryError)
      }
    }
    console.error('[VISION AI] session save failed, falling back to memory', error)
    isPersistent = false
    memoryStore.set(session.id, session)
    notify(
      'warning',
      'Storage unavailable',
      "This session is in memory only and won't survive a refresh.",
    )
    return { saved: true, prunedCount: 0, isPersistent: false }
  }
}

/** All sessions, newest first. Corrupt rows are skipped, not fatal. */
export async function listSessions(): Promise<Session[]> {
  const db = getDatabase()
  if (!db) {
    return [...memoryStore.values()].sort((a, b) => b.startedAt - a.startedAt)
  }
  try {
    const rows = await db.sessions.orderBy('startedAt').reverse().toArray()
    const valid: Session[] = []
    for (const row of rows) {
      const session = validateSession(row)
      if (session) valid.push(session)
      else console.error('[VISION AI] skipping corrupt session record', row)
    }
    return valid
  } catch (error) {
    console.error('[VISION AI] session read failed', error)
    return [...memoryStore.values()].sort((a, b) => b.startedAt - a.startedAt)
  }
}

export async function deleteSession(id: string): Promise<void> {
  memoryStore.delete(id)
  const db = getDatabase()
  if (!db) return
  try {
    await db.sessions.delete(id)
  } catch (error) {
    console.error('[VISION AI] session delete failed', error)
    throw new Error('Could not delete that session.')
  }
}

export async function clearAllSessions(): Promise<void> {
  memoryStore.clear()
  const db = getDatabase()
  if (!db) return
  try {
    await db.sessions.clear()
  } catch (error) {
    console.error('[VISION AI] clearing sessions failed', error)
    throw new Error('Could not clear stored data.')
  }
}
