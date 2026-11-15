/**
 * Sidebar — the dashboard's right rail.
 * Collapsible on small screens so the camera feed keeps full width.
 */
import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

export function Sidebar({ children }: { children: ReactNode }) {
  return <div className="space-y-4 md:col-span-5 lg:col-span-4">{children}</div>
}

/**
 * Panel — a titled card that collapses on mobile (<768px) and is always
 * expanded from tablet up.
 */
export function CollapsiblePanel({
  title,
  right,
  defaultOpen = true,
  children,
}: {
  title: string
  right?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        {/* Toggle only exists on mobile; larger screens show a plain heading */}
        <button
          type="button"
          className="-my-2 flex min-h-11 flex-1 items-center gap-1.5 py-2 text-left md:pointer-events-none md:min-h-0 md:flex-none md:py-0"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((value) => !value)}
        >
          <h3 className="panel-title">{title}</h3>
          <ChevronDown
            size={14}
            className={cn(
              'text-ink-3 transition-transform duration-200 md:hidden',
              isOpen && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>
        {right}
      </div>
      <div className={cn(isOpen ? 'block' : 'hidden md:block')}>{children}</div>
    </section>
  )
}
