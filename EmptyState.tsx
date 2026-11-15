/**
 * EmptyState — consistent zero-data presentation.
 */
import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl border border-dashed border-line bg-surface-alt text-ink-3">
        {icon}
      </div>
      <p className="mt-4 max-w-sm text-sm font-medium text-ink-3">{title}</p>
      {description && (
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-3">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
