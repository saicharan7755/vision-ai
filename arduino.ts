/**
 * arduino.ts — shared types for the hardware bridge.
 *
 * The Web Serial API surface itself is declared locally inside
 * services/arduinoSerial.ts (it is not part of TypeScript's DOM lib and is
 * an implementation detail of that service). Only the types other layers
 * consume live here, per the "types are shared and imported" rule.
 */

/** Lifecycle of the browser ↔ Arduino serial link. */
export type ArduinoConnectionStatus =
  | 'unsupported' // Browser has no Web Serial (Firefox / Safari)
  | 'disconnected'
  | 'connecting'
  | 'connected'

/** Aggregate state exposed to the UI. */
export interface ArduinoState {
  readonly status: ArduinoConnectionStatus
  /** Human-readable detail for the most recent failure, if any. */
  readonly lastError: string | null
}

/** One command as it appears on the wire: `"<LABEL>:<CONFIDENCE>\n"`. */
export interface ArduinoEmotionCommand {
  /** Uppercase protocol token, e.g. `HAPPY`. */
  readonly label: string
  /** 0–100 integer confidence. */
  readonly confidence: number
}
