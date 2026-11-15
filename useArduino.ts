/**
 * useArduino — React wrapper over the Web Serial bridge.
 *
 * Exposes connection status plus gesture-driven connect/disconnect handlers
 * for the navbar toggle, and a throttled `sendEmotion` for the live loop.
 *
 * The hook is deliberately free of serial logic: services/arduinoSerial.ts
 * owns the port, and this file only binds it to React. Status is read via
 * useSyncExternalStore so only components that actually render the status
 * re-render on change.
 */
import { useCallback, useSyncExternalStore } from 'react'
import {
  connectArduino,
  disconnectArduino,
  getArduinoStatus,
  isArduinoSupported,
  sendEmotionReading,
  subscribeToArduinoStatus,
  type ArduinoConnectionStatus,
} from '@/services/arduinoSerial'
import type { Emotion } from '@/types/emotion'

export interface UseArduinoResult {
  status: ArduinoConnectionStatus
  isConnected: boolean
  /** False on Firefox/Safari — the UI hides or disables the control. */
  isSupported: boolean
  /** Detail for the most recent failure, surfaced as a tooltip. */
  lastError: string | null
  handleConnect: () => void
  handleDisconnect: () => void
  handleToggle: () => void
  /**
   * Fire-and-forget transmit. Internally throttled, and a no-op when the
   * link is down — safe to call from the detection loop every frame.
   */
  sendEmotion: (emotion: Emotion, confidence: number) => void
}

export function useArduino(): UseArduinoResult {
  const { status, lastError } = useSyncExternalStore(
    subscribeToArduinoStatus,
    getArduinoStatus,
    getArduinoStatus,
  )

  const isSupported = isArduinoSupported()

  const handleConnect = useCallback(() => {
    // Must be called directly from the click handler: Web Serial requires
    // a user gesture for requestPort(), and awaiting anything first
    // (including isSupported) would consume it.
    void connectArduino()
  }, [])

  const handleDisconnect = useCallback(() => {
    void disconnectArduino()
  }, [])

  const handleToggle = useCallback(() => {
    if (status === 'connected') void disconnectArduino()
    else void connectArduino()
  }, [status])

  const sendEmotion = useCallback(
    (emotion: Emotion, confidence: number) => {
      // The service owns the throttle and the connection check, so this is
      // safe to call from any render or effect.
      sendEmotionReading(emotion, confidence)
    },
    [],
  )

  return {
    status,
    isConnected: status === 'connected',
    isSupported,
    lastError,
    handleConnect,
    handleDisconnect,
    handleToggle,
    sendEmotion,
  }
}
