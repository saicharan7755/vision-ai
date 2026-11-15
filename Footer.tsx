/**
 * Footer — persistent privacy reassurance and version marker.
 */
import { ShieldCheck } from 'lucide-react'
import { APP_RELEASE_DATE, APP_TAGLINE, APP_VERSION } from '@/utils/buildInfo'

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface/60">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-2 px-4 py-3.5 sm:px-6">
        <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <ShieldCheck size={13} className="text-success" />
          100% local inference — camera frames never leave this device
        </p>
        <p className="mono-stat ml-auto text-[11px] text-ink-3">
          VISION AI · v{APP_VERSION} · {APP_RELEASE_DATE} · {APP_TAGLINE}
        </p>
      </div>
    </footer>
  )
}
