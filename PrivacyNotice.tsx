/**
 * PrivacyNotice — first-launch disclosure, shown once per device.
 */
import { motion } from 'framer-motion'
import { Cpu, Database, Info, ScanFace, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/shared/Button'

export function PrivacyNotice({ onAccept }: { onAccept: () => void }) {
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onAccept()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onAccept])

  return (
    <motion.div
      className="fixed inset-0 z-[70] grid place-items-center bg-ink/25 p-4 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="presentation"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-notice-title"
        className="card w-full max-w-md p-6 shadow-pop"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
      >
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary-light text-primary">
          <ShieldCheck size={22} />
        </div>

        <h2 id="privacy-notice-title" className="mt-4 font-display text-lg font-bold text-ink">
          Your data stays on your device
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          VISION AI processes everything locally and never uploads your camera feed. Frames are
          analyzed in your browser and discarded instantly — saved sessions live only in this
          device&apos;s on-device database.
        </p>

        {isExpanded && (
          <ul className="mt-4 space-y-2.5 border-t border-line pt-4">
            <li className="flex gap-2.5 text-[13px] leading-snug text-ink-2">
              <Cpu size={15} className="mt-0.5 shrink-0 text-primary" />
              Inference runs in TensorFlow.js (WebGL) entirely inside this tab.
            </li>
            <li className="flex gap-2.5 text-[13px] leading-snug text-ink-2">
              <Database size={15} className="mt-0.5 shrink-0 text-primary" />
              Sessions are stored in IndexedDB. Wipe them anytime from Settings.
            </li>
            <li className="flex gap-2.5 text-[13px] leading-snug text-ink-2">
              <ScanFace size={15} className="mt-0.5 shrink-0 text-primary" />
              The camera only starts when you press Start, and stops the moment you leave.
            </li>
            <li className="flex gap-2.5 text-[13px] leading-snug text-ink-2">
              <Info size={15} className="mt-0.5 shrink-0 text-primary" />
              Age &amp; gender are AI estimates (age ±5–10 years, binary model) and accuracy varies
              across ethnicities and age groups.
            </li>
          </ul>
        )}

        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            className="text-sm font-medium text-primary transition-colors hover:text-primary-deep"
            onClick={() => setIsExpanded((value) => !value)}
          >
            {isExpanded ? 'Show less' : 'Learn more'}
          </button>
          <Button className="px-7" onClick={onAccept} autoFocus>
            Got it
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
