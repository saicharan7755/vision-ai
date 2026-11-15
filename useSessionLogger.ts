/**
 * useSessionLogger — start/stop a recording session and report the outcome.
 * Wraps the store action so every caller gets consistent toasts.
 */
import { useCallback, useRef } from 'react'
import { notify, useAppStore } from '@/store/appStore'
import { useSessionStore, type StopSessionResult } from '@/store/sessionStore'
import { formatDuration } from '@/utils/formatters'

export function useSessionLogger() {
  const isActive = useSessionStore((state) => state.isActive)
  const stopSessionAction = useSessionStore((state) => state.stopSession)
  // Guard against double-stop (a Stop click can race the camera-off effect).
  const isStoppingRef = useRef(false)

  const stopSession = useCallback(
    async (options?: { isSilent?: boolean; source?: 'live' | 'video' }): Promise<StopSessionResult | null> => {
      if (isStoppingRef.current) return null
      isStoppingRef.current = true
      try {
        const result = await stopSessionAction(options?.source ?? 'live')
        if (options?.isSilent) return result

        if (result.session) {
          const count = result.session.transitions.length
          notify(
            'success',
            'Session saved to history',
            `${formatDuration(result.session.durationSec)} · ${count} transition${count === 1 ? '' : 's'}`,
          )
          // These two were previously swallowed: the app silently fell back
          // to memory or pruned old sessions without telling anyone.
          if (result.prunedCount > 0) {
            notify(
              'info',
              'Oldest session removed to free space',
              'Storage keeps the most recent sessions only.',
            )
          }
          if (!result.isPersistent) {
            notify(
              'warning',
              'Storage unavailable',
              "Session data won't be saved in private browsing mode.",
            )
          }
        } else {
          notify(
            'info',
            'Session discarded',
            'A session needs 5+ seconds with a visible face to be saved.',
          )
        }
        return result
      } catch (error) {
        console.error('[VISION AI] stopping session failed', error)
        notify('error', 'Could not save session', 'Your analysis data could not be stored.')
        return null
      } finally {
        isStoppingRef.current = false
      }
    },
    [stopSessionAction],
  )

  const setError = useAppStore((state) => state.setError)

  return { isActive, stopSession, setError }
}
