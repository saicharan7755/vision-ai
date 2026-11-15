/**
 * useSessionHistory — the bridge between components and session storage.
 * Centralizes load/delete/clear with consistent toasts so every caller
 * (History page, navbar settings) behaves identically on failure.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  clearAllSessions,
  deleteSession,
  listSessions,
} from '@/services/sessionManager'
import { notify } from '@/store/appStore'
import type { Session } from '@/types/session'
import { formatDateTime } from '@/utils/formatters'

export interface UseSessionHistoryResult {
  /** null while loading, [] when empty. */
  sessions: Session[] | null
  reload: () => Promise<void>
  remove: (session: Session) => Promise<void>
  clearAll: () => Promise<void>
}

export function useSessionHistory(): UseSessionHistoryResult {
  const [sessions, setSessions] = useState<Session[] | null>(null)

  const reload = useCallback(async () => {
    try {
      setSessions(await listSessions())
    } catch (error) {
      console.error('[VISION AI] loading history failed', error)
      setSessions([])
      notify('error', "Couldn't load history", 'Local storage is unavailable in this browser.')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const remove = useCallback(
    async (session: Session) => {
      try {
        await deleteSession(session.id)
        notify('success', 'Session deleted', formatDateTime(session.startedAt))
      } catch (error) {
        console.error('[VISION AI] delete failed', error)
        notify('error', 'Delete failed', 'That session could not be removed.')
      }
      void reload()
    },
    [reload],
  )

  const clearAll = useCallback(async () => {
    try {
      await clearAllSessions()
      notify('success', 'All data deleted', 'Every saved session was removed from this device.')
    } catch (error) {
      console.error('[VISION AI] clear all failed', error)
      notify('error', "Couldn't delete data", 'Local storage is unavailable in this browser.')
    }
    void reload()
  }, [reload])

  return { sessions, reload, remove, clearAll }
}
