/**
 * Toaster — renders the global toast queue (top-right, max 3 visible).
 */
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, Info, X, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAppStore, type ToastKind } from '@/store/appStore'

const KIND_STYLES: Record<ToastKind, { className: string; icon: ReactNode }> = {
  success: { className: 'bg-success/10 text-success', icon: <Check size={15} /> },
  warning: { className: 'bg-warning/10 text-warning', icon: <AlertTriangle size={15} /> },
  error: { className: 'bg-danger/10 text-danger', icon: <XCircle size={15} /> },
  // Info uses the brand orange per the design system.
  info: { className: 'bg-primary/10 text-primary', icon: <Info size={15} /> },
}

export function Toaster() {
  const toasts = useAppStore((state) => state.toasts)
  const dismissToast = useAppStore((state) => state.dismissToast)

  return (
    <div
      className="pointer-events-none fixed top-16 right-4 z-[90] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const style = KIND_STYLES[toast.kind]
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, x: 24, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 16, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className="card pointer-events-auto flex items-start gap-2.5 p-3 shadow-pop"
              role="alert"
            >
              <span
                className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${style.className}`}
              >
                {style.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug font-medium text-ink">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-xs leading-snug text-ink-2">{toast.description}</p>
                )}
              </div>
              <button
                type="button"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-alt hover:text-ink"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
              >
                <X size={13} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
