/**
 * Display formatting helpers. Pure and side-effect free.
 */

/** `mm:ss` clock. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

/** Human duration: `45s`, `4m 12s`, `1h 6m`. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${total % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** `Jun 14, 2025 · 3:42 PM`. */
export function formatDateTime(epochMs: number): string {
  const date = new Date(epochMs)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  const day = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}

/** 0..1 → `87%`. */
export function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

/** Age is an estimate, so it always carries a tilde. */
export function formatAge(age: number | null): string | null {
  return age === null ? null : `~${Math.round(age)}`
}

export function formatGender(gender: string | null): string | null {
  if (!gender) return null
  return gender.charAt(0).toUpperCase() + gender.slice(1)
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** RFC4122 v4 id with a fallback for insecure contexts. */
export function createId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
}
