/**
 * useMediaQuery — subscribe to a CSS media query from React.
 *
 * Layout is handled in CSS wherever possible; this hook exists only for
 * the cases where a JavaScript value is genuinely required — chart library
 * props (Recharts cannot read CSS) and conditional rendering of whole
 * subtrees. It listens to MediaQueryList rather than window resize, so it
 * fires once per breakpoint crossing instead of on every resize pixel.
 */
import { useSyncExternalStore } from 'react'

const BREAKPOINTS = {
  xs: '(min-width: 375px)',
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
  xl: '(min-width: 1280px)',
} as const

export type BreakpointKey = keyof typeof BREAKPOINTS

/** Cached MediaQueryList per query — creating one per render would leak. */
const queryCache = new Map<string, MediaQueryList>()

function getQueryList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || !window.matchMedia) return null
  let list = queryCache.get(query)
  if (!list) {
    list = window.matchMedia(query)
    queryCache.set(query, list)
  }
  return list
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = getQueryList(query)
      if (!list) return () => undefined
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => getQueryList(query)?.matches ?? false,
    // Server/prerender fallback: assume desktop.
    () => true,
  )
}

/** True at or above the named breakpoint. */
export function useBreakpoint(key: BreakpointKey): boolean {
  return useMediaQuery(BREAKPOINTS[key])
}

/** True below `md` — the phone layout. */
export function useIsMobile(): boolean {
  return !useBreakpoint('md')
}
