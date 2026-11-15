/**
 * CameraControls — transport bar beneath the live feed.
 */
import { Clock, Crosshair, Play, SwitchCamera, Square, Users } from 'lucide-react'
import { Badge } from '@/components/shared/Badge'
import { Button, IconButton } from '@/components/shared/Button'
import { CameraSelector } from './CameraSelector'
import type { CameraDevice } from '@/hooks/useCamera'
import { formatClock } from '@/utils/formatters'
import type { DetectionQuality } from '@/types/settings'

export function CameraControls({
  isOn,
  isStarting,
  faceCount,
  durationSec,
  quality,
  hasMultipleCameras,
  availableCameras,
  activeDeviceId,
  onStart,
  onStop,
  onFlipCamera,
  onSwitchCamera,
  onRequestWebcamHelp,
  onRecalibrate,
}: {
  isOn: boolean
  isStarting: boolean
  faceCount: number
  durationSec: number
  quality: DetectionQuality
  hasMultipleCameras: boolean
  availableCameras: readonly CameraDevice[]
  activeDeviceId: string | null
  onStart: () => void
  onStop: () => void
  onFlipCamera: () => void
  onSwitchCamera: (deviceId: string) => void
  onRequestWebcamHelp: () => void
  onRecalibrate: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-t border-line px-4 py-3">
      {isOn ? (
        <Button variant="dangerSoft" onClick={onStop} icon={<Square size={13} />}>
          Stop Session
        </Button>
      ) : (
        <Button onClick={onStart} disabled={isStarting} icon={<Play size={14} />}>
          {isStarting ? 'Starting…' : 'Start Camera'}
        </Button>
      )}

      {/*
        * Device selector — shown whenever at least one device has been
        * enumerated. The legacy facingMode flip button is kept as a
        * fallback for the case where enumeration returns nothing (some
        * browsers hide the list until permission is granted), so the user
        * is never left with no way to change camera.
        */}
      {isOn && availableCameras.length > 0 && (
        <CameraSelector
          cameras={availableCameras}
          activeDeviceId={activeDeviceId}
          onSelect={onSwitchCamera}
          onRequestHelp={onRequestWebcamHelp}
        />
      )}

      {isOn && availableCameras.length === 0 && hasMultipleCameras && (
        <IconButton
          label="Switch camera"
          icon={<SwitchCamera size={16} />}
          className="border border-line"
          onClick={onFlipCamera}
        />
      )}

      {isOn && (
        <IconButton
          label="Recalibrate resting face"
          icon={<Crosshair size={16} />}
          className="border border-line"
          onClick={onRecalibrate}
        />
      )}

      <Badge icon={<Users size={12} />}>
        <span className="mono-stat">
          {faceCount} {faceCount === 1 ? 'face' : 'faces'}
        </span>
      </Badge>
      <Badge icon={<Clock size={12} />}>
        <span className="mono-stat">{formatClock(durationSec)}</span>
      </Badge>

      <span className="mono-stat ml-auto hidden text-[11px] text-ink-3 sm:block">
        on-device · {quality} profile
      </span>
    </div>
  )
}
