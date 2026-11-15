/**
 * debugLog.ts — throttled diagnostic logging.
 *
 * The diagnostics directive requires raw model outputs in the console, but
 * the emotion engine classifies at up to ~15 Hz; an unthrottled log would
 * flood DevTools and itself become a performance factor. Loggers created
 * here emit at most once per interval.
 */
export type ThrottledLogger = (emit: () => void) => void

/**
 * Create a logger that emits at most once per `intervalMs`.
 * Not a React concern — plain module-level state.
 */
export function createThrottledLogger(intervalMs: number): ThrottledLogger {
  let lastEmitAt = 0
  return (emit: () => void) => {
    const now = performance.now()
    if (now - lastEmitAt < intervalMs) return
    lastEmitAt = now
    emit()
  }
}
