/**
 * CropDebugger — live preview of the EXACT input the emotion model receives.
 *
 * Registers itself with facePreprocessor on mount; from then on every crop
 * prepared for the primary face (slot 0 — the largest) is copied onto this
 * canvas AFTER padding, eye-level rotation and contrast equalization. What
 * you see here is byte-for-byte what the classifier sees.
 *
 * Diagnostic reading:
 *  • Clear, upright, centred face → crop pipeline is correct.
 *  • Upside-down face              → eye-tilt normalization regressed.
 *  • Squashed / stretched face     → square-sampling regressed.
 *  • Background or an ear          → coordinate mapping regressed.
 *  • Very dark / blown-out image   → CLAHE disabled (Low preset) or absent.
 *
 * The preview is deliberately NOT mirrored even when the video preview is:
 * the classifier reads the raw camera frame, and this canvas exists to show
 * the model's actual input.
 */
import { useEffect, useRef } from 'react'
import { setCropInspector } from '@/services/facePreprocessor'

export function CropDebugger() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    setCropInspector(canvas)
    return () => setCropInspector(null)
  }, [])

  return (
    <canvas
      id="debug-crop-canvas"
      ref={canvasRef}
      width={224}
      height={224}
      className="fixed bottom-4 left-4 z-50 h-28 w-28 rounded-lg border-2 border-red-500 bg-black shadow-2xl"
      role="img"
      aria-label="Emotion model input preview — shows the exact face crop sent to the classifier"
    />
  )
}
