/**
 * PhoneWebcamHelp — the "(?)" helper modal next to the camera selector.
 *
 * Setup steps differ by platform, so they are grouped by device rather than
 * by app: a user with an Android 14 phone needs one tap, while an iPhone
 * user needs to know Continuity Camera is Mac-only and Camo is the Windows
 * path. Instructions are short on purpose — this is a hint card, not docs.
 */
import { Smartphone } from 'lucide-react'
import { Modal } from '@/components/shared/Modal'

export function PhoneWebcamHelp({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  return (
    <Modal isOpen={isOpen} title="Use your phone as a webcam" onClose={onClose}>
      <p className="text-[13px] leading-relaxed text-ink-2">
        A phone connection gives VISION AI a far better sensor than most laptop webcams. Pick the
        option matching your device, then choose it from the camera dropdown.
      </p>

      <div className="mt-4 space-y-3">
        <HelpRow title="Android 14+ (no app needed)">
          Plug in the USB-C cable, then swipe the USB notification and select{' '}
          <strong className="font-semibold text-ink">Webcam</strong>. The phone appears as a camera
          immediately.
        </HelpRow>

        <HelpRow title="Android / Windows (app)">
          Install <strong className="font-semibold text-ink">DroidCam</strong>,{' '}
          <strong className="font-semibold text-ink">Camo</strong> or{' '}
          <strong className="font-semibold text-ink">Iriun</strong> on the phone and, where
          prompted, its client on the computer. Connect by USB and start the app&apos;s USB mode.
        </HelpRow>

        <HelpRow title="iPhone">
          On a Mac, simply plug in the cable —{' '}
          <strong className="font-semibold text-ink">Continuity Camera</strong> works
          automatically. On Windows, use <strong className="font-semibold text-ink">Camo</strong>.
        </HelpRow>
      </div>

      <div className="mt-4 rounded-lg border border-line bg-surface-alt/60 p-3">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-2">
          <Smartphone size={14} className="mt-0.5 shrink-0 text-primary" />
          If the new camera does not appear in the dropdown, unplug and reconnect it — the list
          refreshes automatically. Keep the phone unlocked and the webcam app in the foreground,
          since Android and iOS both suspend background camera capture.
        </p>
      </div>
    </Modal>
  )
}

function HelpRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{children}</p>
    </div>
  )
}
