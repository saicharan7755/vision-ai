/**
 * useModelLoader — the only way components touch the ML engine.
 *
 * Wraps detectionEngine.loadModels with progress reporting, capability
 * state (appStore.modelStatus) and consistent error surfacing, so pages
 * never import the inference service themselves. Store writes (zustand)
 * are safe even after unmount, so no mounted-check is required.
 */
import { useCallback } from 'react'
import { loadModels } from '@/services/detectionEngine'
import { notify, useAppStore } from '@/store/appStore'
import type { ModelStatus } from '@/types/settings'

export interface UseModelLoaderResult {
  modelStatus: ModelStatus
  isReady: boolean
  /**
   * Load the engine if needed. Resolves true when the engine is ready,
   * false when it failed (the feed shows its own retry state in that case).
   */
  ensureReady: () => Promise<boolean>
}

/** Read model status without subscribing (for imperative paths like Video). */
export function getModelStatusSnapshot(): ModelStatus {
  return useAppStore.getState().modelStatus
}

export function useModelLoader(): UseModelLoaderResult {
  const modelStatus = useAppStore((state) => state.modelStatus)
  const setModelStatus = useAppStore((state) => state.setModelStatus)

  const ensureReady = useCallback(async (): Promise<boolean> => {
    if (useAppStore.getState().modelStatus.phase === 'ready') return true

    setModelStatus({ phase: 'loading', progress: 0 })
    try {
      const capabilities = await loadModels((progress) => {
        setModelStatus({ phase: 'loading', progress })
      })
      setModelStatus({
        phase: 'ready',
        hasEmotion: capabilities.hasEmotion,
        hasAgeGender: capabilities.hasAgeGender,
      })
      if (!capabilities.hasEmotion) {
        notify(
          'warning',
          'Emotion model unavailable',
          'Faces will still be detected and tracked, without emotion labels.',
        )
      }
      return true
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'AI model failed to load. Please refresh the page.'
      console.error('[VISION AI] model load failed', error)
      setModelStatus({ phase: 'error', message })
      return false
    }
  }, [setModelStatus])

  return { modelStatus, isReady: modelStatus.phase === 'ready', ensureReady }
}
