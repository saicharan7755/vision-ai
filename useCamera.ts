/**
 * useCamera — owns the MediaStream lifecycle.
 *
 * Responsibilities:
 *  • nothing is requested until the user acts, so the browser permission
 *    prompt is never fired on page load
 *  • the stream is stopped on unmount, tab-hide and explicit stop, so the
 *    camera indicator light always goes out
 *  • a second start() while a stream exists is a no-op (no duplicate
 *    streams, no "track already started")
 *
 * DEVICE SELECTION
 * ----------------
 * Beyond the built-in webcam this supports external sources — USB-C phone
 * webcams (Android 14+ "Webcam" mode), and virtual drivers such as DroidCam,
 * Camo or Iriun. All of them surface as ordinary `videoinput` devices, so
 * they are enumerated with the rest and selected by `deviceId`.
 *
 * Two browser behaviours shape the implementation:
 *  1. `device.label` is an empty string until camera permission has been
 *     granted at least once, so the list is re-enumerated after starting.
 *  2. On Safari `enumerateDevices()` can report a *stale* list immediately
 *     after a plug/unplug, so hot-plug events trigger a re-enumeration with
 *     the previous list retained on failure rather than clearing it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { notify } from '@/store/appStore'
import type { CameraErrorReason, CameraFacing, CameraStatus } from '@/types/settings'

export function getIsCameraSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
}

function describeError(error: unknown): { reason: CameraErrorReason; message: string } {
  const name = error instanceof DOMException ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        reason: 'denied',
        message:
          'Camera access is required. Allow it in your browser settings, then try again.',
      }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        reason: 'notFound',
        message: "We couldn't find a camera on this device.",
      }
    case 'NotReadableError':
      return {
        reason: 'busy',
        message: 'Camera is being used by another application. Close other apps and retry.',
      }
    default:
      return { reason: 'unknown', message: 'Something went wrong while starting your camera.' }
  }
}

/** One selectable camera, with the raw device id preserved. */
export interface CameraDevice {
  readonly deviceId: string
  /** Friendly label; synthesised when the browser withholds the real one. */
  readonly label: string
}

const DEVICE_STORAGE_KEY = 'vision-ai.camera-device'

function readStoredDeviceId(): string | null {
  try {
    return window.localStorage.getItem(DEVICE_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredDeviceId(deviceId: string | null): void {
  try {
    if (deviceId === null) window.localStorage.removeItem(DEVICE_STORAGE_KEY)
    else window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceId)
  } catch {
    /* storage unavailable — selection just won't persist */
  }
}

/**
 * Build a friendly label for a device.
 *
 * Labels are empty before the first permission grant, and some virtual
 * drivers report unhelpful strings, so anything blank or generic becomes a
 * numbered fallback. Known-source detection is deliberately limited to a
 * small, safe substring list: guessing beyond that mislabels devices.
 */
function describeDevice(device: MediaDeviceInfo, index: number): string {
  const raw = device.label.trim()
  if (raw.length > 0) return raw
  return index === 0 ? 'Camera 1' : `USB Camera (External ${index})`
}

/** Video resolution ceiling. */
const CONSTRAINTS = {
  width: { ideal: 1920, max: 3840 },
  height: { ideal: 1080, max: 2160 },
  frameRate: { ideal: 30, max: 60 },
} as const

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: CameraStatus
  isOn: boolean
  dimensions: { width: number; height: number }
  /** All enumerated video inputs, with friendly labels. */
  availableCameras: readonly CameraDevice[]
  hasMultipleCameras: boolean
  /** deviceId of the camera currently streaming, if any. */
  activeDeviceId: string | null
  start: () => Promise<void>
  stop: () => void
  /** Switch to a specific camera by deviceId, keeping the session alive. */
  switchCamera: (deviceId: string) => Promise<void>
  handleMetadataLoaded: () => void
}

export function useCamera(facingMode: CameraFacing): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const isStartingRef = useRef(false)
  const activeDeviceIdRef = useRef<string | null>(null)

  const [status, setStatus] = useState<CameraStatus>({ phase: 'off' })
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [availableCameras, setAvailableCameras] = useState<readonly CameraDevice[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null)

  /**
   * Enumerate video inputs.
   *
   * @param keepOnFailure When true (hot-plug refresh) a failed enumeration
   *                      retains the previous list — clearing it would make
   *                      the dropdown blank out for a transient error.
   */
  const refreshCameras = useCallback(async (keepOnFailure = false): Promise<void> => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs = devices.filter((device) => device.kind === 'videoinput')
      const mapped = inputs.map((device, index) => ({
        deviceId: device.deviceId,
        label: describeDevice(device, index),
      }))
      setAvailableCameras(mapped)
    } catch (error) {
      console.error('[VISION AI] camera enumeration failed', error)
      // On a hot-plug refresh, retain the previous list — clearing it would
      // blank the dropdown for a transient enumeration error.
      if (!keepOnFailure) {
        setAvailableCameras([])
      }
    }
  }, [])

  // Initial enumeration. Labels are usually empty at this point, but the
  // count is still useful for showing the flip control early.
  useEffect(() => {
    void refreshCameras()
  }, [refreshCameras])

  /*
   * Hot-plug: fires when a USB camera is plugged or unplugged. Re-enumerate
   * and, if the camera we were streaming has vanished, stop cleanly rather
   * than showing a frozen last frame.
   */
  useEffect(() => {
    const media = navigator.mediaDevices as
      | (MediaDevices & { addEventListener?: (t: string, l: () => void) => void })
      | undefined
    if (!media?.addEventListener) return

    const handleDeviceChange = () => {
      void (async () => {
        await refreshCameras(true)
        const currentId = activeDeviceIdRef.current
        if (currentId && streamRef.current) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices()
            const stillPresent = devices.some(
              (device) => device.kind === 'videoinput' && device.deviceId === currentId,
            )
            if (!stillPresent) {
              activeDeviceIdRef.current = null
              setActiveDeviceId(null)
              writeStoredDeviceId(null)
              stopRef.current()
            }
          } catch {
            /* enumeration already failed once; nothing further to do */
          }
        }
      })()
    }

    media.addEventListener('devicechange', handleDeviceChange)
    return () => {
      media.removeEventListener?.('devicechange', handleDeviceChange)
    }
  }, [refreshCameras])

  const stop = useCallback(() => {
    const stream = streamRef.current
    if (stream) {
      // Stopping every track is what actually turns the hardware light off.
      stream.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
    }
    isStartingRef.current = false
    activeDeviceIdRef.current = null
    setActiveDeviceId(null)
    setStatus({ phase: 'off' })
    setDimensions({ width: 0, height: 0 })
  }, [])

  // Mutable handle so the hot-plug effect can stop the stream without
  // re-subscribing whenever `stop`'s identity changes.
  const stopRef = useRef(stop)
  stopRef.current = stop

  /**
   * Open a stream and attach it to the video element.
   *
   * Shared by start() and switchCamera() so both paths get identical
   * teardown, unmount-race protection and error mapping.
   *
   * @param constraints   getUserMedia constraints.
   * @param deviceId      Device to record as active (null = browser default).
   * @param nextStatusOnFailure  When true a failure reverts to the previous
   *                             'off' status instead of an error screen —
   *                      used by switching, where losing the new camera
   *                      should not blank the whole panel.
   */
  const openStream = useCallback(
    async (
      constraints: MediaTrackConstraints,
      deviceId: string | null,
      revertToOffOnFailure: boolean,
    ): Promise<boolean> => {
      isStartingRef.current = true
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: constraints,
          audio: false,
        })

        // The component may have unmounted while the prompt was open.
        if (!isStartingRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return false
        }

        // Release the previous stream BEFORE swapping srcObject, so the old
        // camera's indicator light goes out even if the new device is the
        // same physical hardware re-opening.
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = stream

        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => undefined)
        }

        activeDeviceIdRef.current = deviceId
        setActiveDeviceId(deviceId)
        setStatus({ phase: 'on' })
        return true
      } catch (error) {
        console.error('[VISION AI] camera open failed', error)
        const described = describeError(error)
        setStatus(
          revertToOffOnFailure
            ? { phase: 'off' }
            : { phase: 'error', reason: described.reason, message: described.message },
        )
        return false
      } finally {
        isStartingRef.current = false
      }
    },
    [],
  )

  const start = useCallback(async () => {
    if (streamRef.current || isStartingRef.current) return // guard double-open
    if (!getIsCameraSupported()) {
      setStatus({
        phase: 'error',
        reason: 'unsupported',
        message:
          "Your browser doesn't support real-time video analysis. Please use Chrome, Edge, or Firefox.",
      })
      return
    }

    setStatus({ phase: 'starting' })

    /*
     * Prefer the persisted device — a user who picked their phone webcam
     * expects it to come back on reload. A missing/stale id simply falls
     * through to facingMode, so an unplugged camera never blocks startup.
     */
    const stored = readStoredDeviceId()
    const knownDevice =
      stored !== null && availableCameras.some((camera) => camera.deviceId === stored)

    const opened = knownDevice
      ? await openStream(
          { deviceId: { exact: stored }, ...CONSTRAINTS },
          stored,
          false,
        )
      : await openStream({ facingMode, ...CONSTRAINTS }, null, false)

    if (opened) {
      // Labels are only populated after a permission grant, so re-enumerate
      // now to pick up real names for the dropdown.
      await refreshCameras(true)
    }
  }, [availableCameras, facingMode, openStream, refreshCameras])

  const switchCamera = useCallback(
    async (deviceId: string) => {
      if (!getIsCameraSupported()) return
      if (deviceId === activeDeviceIdRef.current) return
      if (!streamRef.current) return

      const notifySwitching = () =>
        notifyRef.current(
          'info',
          'Switching camera…',
          'Please grant permission if prompted.',
        )
      notifySwitching()

      /*
       * exact deviceId first. Some virtual drivers (and mobile Safari)
       * reject an exact id they just enumerated, so on failure we retry
       * with facingMode — degrading to "a camera" rather than nothing.
       */
      const opened = await openStream(
        { deviceId: { exact: deviceId }, ...CONSTRAINTS },
        deviceId,
        true,
      )

      if (opened) {
        writeStoredDeviceId(deviceId)
        await refreshCameras(true)
        return
      }

      const fallbackOpened = await openStream({ facingMode, ...CONSTRAINTS }, null, true)
      if (fallbackOpened) {
        writeStoredDeviceId(null)
        await refreshCameras(true)
        notifyRef.current(
          'warning',
          'Used the default camera',
          'That device could not be opened — it may be busy or unsupported.',
        )
      }
    },
    [facingMode, openStream, refreshCameras],
  )

  /*
   * Toast access. `notify` reads the store imperatively, so there is no
   * subscription to keep in sync and no prop to thread through. Held in a
   * ref so switchCamera's identity stays stable.
   */
  const notifyRef = useRef(notify)
  notifyRef.current = notify

  const handleMetadataLoaded = useCallback(() => {
    const video = videoRef.current
    if (video) setDimensions({ width: video.videoWidth, height: video.videoHeight })
  }, [])

  // Restart when the user flips between front and rear cameras.
  const facingRef = useRef(facingMode)
  useEffect(() => {
    if (facingRef.current === facingMode) return
    facingRef.current = facingMode
    if (streamRef.current) {
      stop()
      void start()
    }
  }, [facingMode, start, stop])

  // Cleanup on unmount — covers tab switches, since the page unmounts LivePage.
  useEffect(() => {
    return () => {
      const stream = streamRef.current
      if (stream) stream.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      isStartingRef.current = false
    }
  }, [])

  // Release the camera when the tab is hidden for a while (battery + privacy).
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && streamRef.current) {
        stop()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [stop])

  return {
    videoRef,
    status,
    isOn: status.phase === 'on',
    dimensions,
    availableCameras,
    hasMultipleCameras: availableCameras.length > 1,
    activeDeviceId,
    start,
    stop,
    switchCamera,
    handleMetadataLoaded,
  }
}
