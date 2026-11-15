/**
 * arduinoSerial.ts — Web Serial bridge to the VISION AI hardware rig.
 *
 * Owns the entire browser-side serial lifecycle: port selection, opening at
 * the sketch's 115200 baud, writing emotion commands, and teardown. No
 * React here — the React wrapper is hooks/useArduino.ts.
 *
 * Web Serial is only available in Chromium 89+ on a secure context
 * (https:// or localhost), and requestPort() must be called from a user
 * gesture. Every other browser simply reports "unsupported", and the app
 * works exactly as before — this layer is strictly additive.
 *
 * Types are declared locally because the Web Serial API is not part of
 * TypeScript's standard DOM lib. Defining them explicitly (rather than
 * reaching for `any`) keeps the boundary compile-checked.
 */
import { Emotion } from '@/types/emotion'

/** Command wire format expected by the sketch: "EMOTION:SCORE\n". */
const BAUD_RATE = 115200

/** Milliseconds to wait for the port to settle after a failed write. */
const RECONNECT_COOLDOWN_MS = 1000

// ── Web Serial API surface (subset we consume) ─────────────────────────

interface SerialPortRequestOptions {
  readonly filters?: ReadonlyArray<{
    readonly usbVendorId?: number
    readonly usbProductId?: number
  }>
}

interface SerialPortInfo {
  readonly usbVendorId?: number
  readonly usbProductId?: number
}

interface SerialOptions {
  readonly baudRate: number
  readonly dataBits?: number
  readonly stopBits?: number
  readonly parity?: 'none' | 'even' | 'odd'
  readonly bufferSize?: number
  readonly flowControl?: 'none' | 'hardware'
}

interface SerialPortLike {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(options: SerialOptions): Promise<void>
  close(): Promise<void>
  getInfo(): SerialPortInfo
}

interface SerialLike {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPortLike>
  getPorts(): Promise<SerialPortLike[]>
  addEventListener(type: 'connect' | 'disconnect', listener: () => void): void
  removeEventListener(type: 'connect' | 'disconnect', listener: () => void): void
}

interface NavigatorWithSerial extends Navigator {
  readonly serial?: SerialLike
}

function getSerialApi(): SerialLike | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as NavigatorWithSerial).serial ?? null
}

// ── Connection state ───────────────────────────────────────────────────

export type ArduinoConnectionStatus =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'connected'

interface ArduinoState {
  status: ArduinoConnectionStatus
  /** Human-readable detail for the most recent failure, if any. */
  lastError: string | null
}

let state: ArduinoState = { status: 'disconnected', lastError: null }

const listeners = new Set<() => void>()

function setState(next: Partial<ArduinoState>): void {
  const changedStatus = next.status !== undefined && next.status !== state.status
  const changedError = next.lastError !== undefined && next.lastError !== state.lastError
  if (!changedStatus && !changedError) return
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

/** Subscribe to connection-state changes (for useSyncExternalStore). */
export function subscribeToArduinoStatus(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** Current snapshot (for useSyncExternalStore). */
export function getArduinoStatus(): ArduinoState {
  return state
}

/** True when this browser can talk to serial hardware at all. */
export function isArduinoSupported(): boolean {
  return getSerialApi() !== null
}

// ── Port lifecycle ─────────────────────────────────────────────────────

let port: SerialPortLike | null = null
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null
let connectPromise: Promise<boolean> | null = null
/** Guards a reconnect attempt while the port is settling. */
let lastFailureMs = 0

/** Detected an unplug via the browser's disconnect event. */
function handleUnpluggedPort(): void {
  if (!port) return
  // The stream is already gone; skip close() and just drop our references.
  port = null
  void releaseWriter()
  setState({ status: 'disconnected', lastError: 'Device was unplugged.' })
}

async function releaseWriter(): Promise<void> {
  if (!writer) return
  const active = writer
  writer = null
  try {
    active.releaseLock()
  } catch {
    // The stream may already be errored by an unplug; nothing to release.
  }
}

/**
 * Open the port picker and connect. MUST be invoked from a user gesture
 * (a click) — the browser enforces this for requestPort().
 *
 * @returns true when the connection is live.
 */
export async function connectArduino(): Promise<boolean> {
  const api = getSerialApi()
  if (!api) {
    setState({ status: 'unsupported', lastError: null })
    return false
  }
  // A second click while connecting should join the in-flight attempt,
  // not start a competing one.
  if (connectPromise) return connectPromise
  if (state.status === 'connected') return true

  connectPromise = (async (): Promise<boolean> => {
    // After an unplug the port needs a moment to disappear from the OS;
    // retrying immediately can re-open a half-dead handle.
    if (performance.now() - lastFailureMs < RECONNECT_COOLDOWN_MS) return false

    setState({ status: 'connecting', lastError: null })
    try {
      // Listening here rather than at module scope keeps the listener's
      // lifetime tied to ever having used the feature.
      api.removeEventListener('disconnect', handleUnpluggedPort)
      api.addEventListener('disconnect', handleUnpluggedPort)

      const selected = await api.requestPort()
      await selected.open({ baudRate: BAUD_RATE })

      if (!selected.writable) {
        // A port that opened without a writable stream cannot receive
        // commands — close it again rather than reporting success.
        await selected.close().catch(() => undefined)
        setState({ status: 'disconnected', lastError: 'Port has no writable stream.' })
        return false
      }

      port = selected
      writer = selected.writable.getWriter()
      setState({ status: 'connected', lastError: null })
      return true
    } catch (error) {
      lastFailureMs = performance.now()
      port = null
      await releaseWriter()

      // The user pressing "Cancel" in the port picker is not an error worth
      // surfacing — it is the normal way to abandon the dialog.
      const isCancel = error instanceof DOMException && error.name === 'NotFoundError'
      if (isCancel) {
        setState({ status: 'disconnected', lastError: null })
      } else {
        const message = error instanceof Error ? error.message : 'Could not open the port.'
        console.error('[VISION AI] Arduino connect failed', error)
        setState({ status: 'disconnected', lastError: message })
      }
      return false
    } finally {
      connectPromise = null
    }
  })()

  return connectPromise
}

/**
 * Close the port and drop all references. Safe to call when already
 * disconnected — the UI uses it as a toggle.
 */
export async function disconnectArduino(): Promise<void> {
  api_removeListener()
  const activePort = port
  port = null
  await releaseWriter()

  if (activePort) {
    try {
      await activePort.close()
    } catch (error) {
      // Closing an already-gone port throws; that is the expected path
      // after an unplug.
      console.error('[VISION AI] Arduino close error', error)
    }
  }
  setState({ status: isArduinoSupported() ? 'disconnected' : 'unsupported', lastError: null })
}

function api_removeListener(): void {
  const api = getSerialApi()
  if (api) api.removeEventListener('disconnect', handleUnpluggedPort)
}

// ── Writing ────────────────────────────────────────────────────────────

/** Wire token for each emotion, matching the sketch's lookup table. */
const EMOTION_PROTOCOL_LABEL: Record<Emotion, string> = {
  [Emotion.Happy]: 'HAPPY',
  [Emotion.Sad]: 'SAD',
  [Emotion.Angry]: 'ANGRY',
  [Emotion.Surprised]: 'SURPRISE',
  [Emotion.Fearful]: 'FEAR',
  [Emotion.Disgusted]: 'DISGUST',
  [Emotion.Contempt]: 'CONTEMPT',
  [Emotion.Neutral]: 'NEUTRAL',
}

/**
 * Minimum spacing between serial writes. The Arduino parses a full line per
 * loop iteration; faster updates buy nothing visually and can overflow the
 * 64-byte RX buffer on a board that is busy easing the servo.
 */
const SEND_THROTTLE_MS = 150
let lastSendAtMs = 0

/**
 * Send the live emotion reading, throttled to one command per 150 ms.
 *
 * This is the entry point the detection loop calls every frame: it is a
 * no-op unless the link is up, so callers never need to branch on
 * connection state.
 *
 * @returns true when a command was actually written.
 */
export function sendEmotionReading(emotion: Emotion, confidence: number): boolean {
  if (state.status !== 'connected') return false
  const now = performance.now()
  if (now - lastSendAtMs < SEND_THROTTLE_MS) return false

  const label = EMOTION_PROTOCOL_LABEL[emotion]
  if (!label) return false

  lastSendAtMs = now
  return sendEmotionCommand(label, confidence)
}

/**
 * Send one emotion reading. A no-op when not connected, so callers never
 * need to check state — the live loop can call this unconditionally.
 *
 * @param emotion    Protocol label, e.g. 'HAPPY'.
 * @param confidence 0–100 integer, as displayed in the UI.
 * @returns true when a command was actually written.
 */
export function sendEmotionCommand(emotion: string, confidence: number): boolean {
  if (state.status !== 'connected' || !writer) return false

  const clamped = Math.max(0, Math.min(100, Math.round(confidence)))
  const payload = `${emotion.toUpperCase()}:${clamped}\n`
  const encoded = new TextEncoder().encode(payload)

  // void-returned on purpose: writes must never block the inference loop,
  // and a failure here is handled by disconnecting rather than throwing.
  void writer.write(encoded).catch((error: unknown) => {
    console.error('[VISION AI] Arduino write failed', error)
    // A failed write means the link is gone (unplug, board reset). Tear
    // down so the UI reflects reality and the next click reconnects.
    void disconnectArduino()
  })
  return true
}
