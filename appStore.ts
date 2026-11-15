/**
 * appStore — global UI state: active tab, model status, FPS and toasts.
 */
import { create } from 'zustand'
import type { ModelStatus } from '@/types/settings'
import { createId } from '@/utils/formatters'

export type TabKey = 'live' | 'upload' | 'video' | 'history'
export type ToastKind = 'success' | 'warning' | 'error' | 'info'

export interface Toast {
  id: string
  kind: ToastKind
  title: string
  description?: string
}

const MAX_VISIBLE_TOASTS = 3
const TOAST_TTL_MS = 5000

interface AppState {
  currentTab: TabKey
  isLoading: boolean
  error: string | null
  fps: number
  /** EMA of end-to-end inference duration, quantized to 5 ms steps. */
  inferenceLatencyMs: number
  modelStatus: ModelStatus
  /** False when getUserMedia is missing — the Live tab is disabled. */
  isCameraSupported: boolean
  toasts: Toast[]

  setCurrentTab: (tab: TabKey) => void
  setIsLoading: (isLoading: boolean) => void
  setError: (error: string | null) => void
  setFps: (fps: number) => void
  setInferenceLatency: (ms: number) => void
  setModelStatus: (status: ModelStatus) => void
  setIsCameraSupported: (isSupported: boolean) => void
  pushToast: (kind: ToastKind, title: string, description?: string) => void
  dismissToast: (id: string) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  currentTab: 'live',
  isLoading: false,
  error: null,
  fps: 0,
  inferenceLatencyMs: 0,
  modelStatus: { phase: 'idle' },
  isCameraSupported: true,
  toasts: [],

  setCurrentTab: (currentTab) => set({ currentTab }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setFps: (fps) => {
    // Skip no-op writes so the whole tree doesn't re-render every second.
    if (get().fps !== fps) set({ fps })
  },
  setInferenceLatency: (ms) => {
    // The caller quantizes; identical values are skipped so telemetry never
    // re-renders the tree at inference rate.
    if (get().inferenceLatencyMs !== ms) set({ inferenceLatencyMs: ms })
  },
  setModelStatus: (modelStatus) => set({ modelStatus }),
  setIsCameraSupported: (isCameraSupported) => set({ isCameraSupported }),

  pushToast: (kind, title, description) => {
    const id = createId()
    set((state) => ({
      toasts: [...state.toasts, { id, kind, title, description }].slice(-MAX_VISIBLE_TOASTS),
    }))
    window.setTimeout(() => get().dismissToast(id), TOAST_TTL_MS)
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))

/** Imperative toast helper for use outside React components. */
export function notify(kind: ToastKind, title: string, description?: string): void {
  useAppStore.getState().pushToast(kind, title, description)
}
