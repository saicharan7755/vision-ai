/**
 * useLocalStorage — typed, SSR-safe localStorage state with graceful
 * degradation when storage is unavailable (private browsing, quota).
 */
import { useCallback, useState } from 'react'

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === null ? initialValue : (JSON.parse(raw) as T)
    } catch (error) {
      console.error(`[VISION AI] could not read "${key}" from localStorage`, error)
      return initialValue
    }
  })

  const setValue = useCallback(
    (value: T) => {
      setStoredValue(value)
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch (error) {
        // Non-fatal: the value still lives in React state for this session.
        console.error(`[VISION AI] could not persist "${key}"`, error)
      }
    },
    [key],
  )

  return [storedValue, setValue]
}

/** Read a sessionStorage flag without throwing in restricted contexts. */
export function readSessionFlag(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function writeSessionFlag(key: string): void {
  try {
    window.sessionStorage.setItem(key, '1')
  } catch {
    /* storage unavailable — the flag simply won't persist */
  }
}
