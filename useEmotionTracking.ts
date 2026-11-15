/**
 * useEmotionTracking — read-only selectors over the session store.
 * Components use this instead of reaching into the store directly, which
 * keeps their re-render surface as small as possible.
 */
import { useMemo } from 'react'
import { useSessionStore } from '@/store/sessionStore'
import type { TrackedFace } from '@/types/face'

/** The face the detail panels describe: pinned if set, else the largest. */
export function selectPrimaryFace(
  faces: readonly TrackedFace[],
  pinnedPersonId: number | null,
): TrackedFace | null {
  const usable = faces.filter((face) => face.status !== 'expiring')
  if (usable.length === 0) return null
  if (pinnedPersonId !== null) {
    const pinned = usable.find((face) => face.id === pinnedPersonId)
    if (pinned) return pinned
  }
  return usable.reduce((largest, candidate) =>
    largest.box.width * largest.box.height > candidate.box.width * candidate.box.height
      ? largest
      : candidate,
  )
}

export function useEmotionTracking() {
  const faces = useSessionStore((state) => state.faces)
  const pinnedPersonId = useSessionStore((state) => state.pinnedPersonId)
  const stats = useSessionStore((state) => state.stats)
  const timeline = useSessionStore((state) => state.timeline)
  const transitions = useSessionStore((state) => state.transitions)
  const comparison = useSessionStore((state) => state.comparison)
  const setPinnedPersonId = useSessionStore((state) => state.setPinnedPersonId)

  const activeFaces = useMemo(
    () => faces.filter((face) => face.status === 'active'),
    [faces],
  )
  const primaryFace = useMemo(
    () => selectPrimaryFace(faces, pinnedPersonId),
    [faces, pinnedPersonId],
  )
  const isComparing = comparison.isActive && comparison.people.length === 2

  return {
    faces,
    activeFaces,
    primaryFace,
    pinnedPersonId,
    setPinnedPersonId,
    stats,
    timeline,
    transitions,
    comparison,
    isComparing,
    hasAnyTrack: faces.some((face) => face.status !== 'expiring'),
  }
}
