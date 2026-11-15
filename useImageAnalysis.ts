/**
 * useImageAnalysis — the Upload tab's pipeline as a hook.
 *
 * Owns file validation, decoding, inference (via the imageProcessor
 * service), annotated export, and — critically — object URL lifetime:
 * every URL is revoked either on reset, on replacement, or on unmount, so
 * repeated uploads can never balloon memory.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  analyzeImage,
  exportAnnotatedImage,
  loadImageFile,
  releaseImage,
  validateImageFile,
  type LoadedImage,
} from '@/services/imageProcessor'
import { notify } from '@/store/appStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { AnalyzedFace } from '@/types/face'

export type ImageAnalysisPhase = 'idle' | 'analyzing' | 'done'

/** Keep the scanner animation on screen for its full sweep. */
const MIN_SCAN_MS = 1280

export interface UseImageAnalysisResult {
  phase: ImageAnalysisPhase
  image: LoadedImage | null
  faces: AnalyzedFace[]
  selectFile: (file: File) => Promise<void>
  reset: () => void
  exportAnnotated: () => Promise<void>
}

export function useImageAnalysis(): UseImageAnalysisResult {
  const shouldShowAgeGender = useSettingsStore((state) => state.shouldShowAgeGender)
  const [phase, setPhase] = useState<ImageAnalysisPhase>('idle')
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [faces, setFaces] = useState<AnalyzedFace[]>([])

  // ALWAYS track the current URL in a ref so unmount cannot leak it.
  const imageRef = useRef<LoadedImage | null>(null)
  imageRef.current = image
  useEffect(() => {
    return () => releaseImage(imageRef.current)
  }, [])

  const reset = useCallback(() => {
    releaseImage(imageRef.current)
    setImage(null)
    setFaces([])
    setPhase('idle')
  }, [])

  const selectFile = useCallback(async (file: File) => {
    const validation = validateImageFile(file)
    if (!validation.isValid) {
      notify('warning', 'Cannot analyze that file', validation.message)
      return
    }

    let loaded: LoadedImage
    try {
      loaded = await loadImageFile(file)
    } catch (error) {
      console.error('[VISION AI] image load failed', error)
      notify('error', "Couldn't read that image", 'The file may be corrupted. Try another one.')
      return
    }

    releaseImage(imageRef.current)
    imageRef.current = loaded
    setImage(loaded)
    setFaces([])
    setPhase('analyzing')

    const startedAt = performance.now()
    try {
      const analyzed = await analyzeImage(loaded)
      const remaining = MIN_SCAN_MS - (performance.now() - startedAt)
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
      setFaces(analyzed)
      setPhase('done')
      if (analyzed.length === 0) {
        notify(
          'info',
          'No faces found',
          'Try a sharper, well-lit photo with faces looking at the camera.',
        )
      }
    } catch (error) {
      console.error('[VISION AI] image analysis failed', error)
      releaseImage(loaded)
      setImage(null)
      setPhase('idle')
      notify(
        'error',
        'Analysis failed',
        'The AI model could not be loaded. Check your connection and retry.',
      )
    }
  }, [])

  const exportAnnotated = useCallback(async () => {
    if (!image || faces.length === 0) return
    try {
      await exportAnnotatedImage(image, faces, shouldShowAgeGender)
      notify(
        'success',
        'Annotated image downloaded',
        `${faces.length} face${faces.length === 1 ? '' : 's'} overlaid.`,
      )
    } catch (error) {
      console.error('[VISION AI] export failed', error)
      notify('error', 'Export failed', 'Could not render the annotated image.')
    }
  }, [image, faces, shouldShowAgeGender])

  return { phase, image, faces, selectFile, reset, exportAnnotated }
}
