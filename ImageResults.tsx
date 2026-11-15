/**
 * ImageResults — annotated preview and per-face breakdown for an upload.
 */
import { FaceMarker } from '@/components/camera/FaceOverlay'
import { EmotionBars } from '@/components/detection/EmotionBars'
import { EstimateInfo } from '@/components/detection/EmotionHero'
import { PersonBadge, SectionTitle } from '@/components/shared/Badge'
import { EMOTION_META } from '@/utils/constants'
import { formatAge, formatGender, formatPercent } from '@/utils/formatters'
import { boxToPercent } from '@/utils/geometry'
import type { AnalyzedFace } from '@/types/face'
import type { LoadedImage } from '@/services/imageProcessor'
import { cn } from '@/utils/cn'

export function ImageCanvas({
  image,
  faces,
  isScanning,
  shouldShowAgeGender,
}: {
  image: LoadedImage
  faces: readonly AnalyzedFace[]
  isScanning: boolean
  shouldShowAgeGender: boolean
}) {
  return (
    <div className="relative inline-block overflow-hidden rounded-lg shadow-sm">
      <img
        src={image.url}
        alt="Uploaded analysis subject"
        className="block max-h-[540px] w-auto max-w-full"
        draggable={false}
      />

      {isScanning && (
        <div className="pointer-events-none absolute inset-0">
          <div className="scan-sweep absolute inset-x-0" style={{ top: 0 }}>
            <div className="h-16 w-full bg-gradient-to-b from-transparent to-primary/15" />
            <div className="h-0.5 w-full bg-primary shadow-[0_0_8px_rgba(14,165,233,0.8)]" />
          </div>
        </div>
      )}

      {!isScanning &&
        faces.map((face) => (
          <FaceMarker
            key={face.id}
            face={{
              id: face.id,
              dominant: face.dominant,
              confidence: face.confidence,
              age: typeof face.age === 'number' ? face.age : null,
              gender: face.gender ?? null,
              status: 'active',
              bornAt: 0,
            }}
            shouldAnimate={false}
            style={boxToPercent(face.box, image.width, image.height)}
            shouldShowAgeGender={shouldShowAgeGender}
            isLabelBelow={face.box.y / image.height < 0.16}
          />
        ))}
    </div>
  )
}

export function ImageResults({
  faces,
  shouldShowAgeGender,
}: {
  faces: readonly AnalyzedFace[]
  shouldShowAgeGender: boolean
}) {
  return (
    <div className="space-y-3">
      {faces.map((face) => {
        const gender = formatGender(face.gender ?? null)
        const age = formatAge(typeof face.age === 'number' ? face.age : null)
        const hasDemographics = shouldShowAgeGender && (gender !== null || age !== null)
        return (
          <div key={face.id} className="card p-4">
            <div className="mb-3 flex items-center gap-3">
              {face.thumbnailUrl && (
                <img
                  src={face.thumbnailUrl}
                  alt={`Detected face ${face.id}`}
                  className="h-11 w-11 rounded-lg border border-line object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <PersonBadge id={face.id} />
                  Person {face.id}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: EMOTION_META[face.dominant].color }}
                  />
                  {EMOTION_META[face.dominant].label}
                  <span className="mono-stat text-ink-3">{formatPercent(face.confidence)}</span>
                </p>
                {hasDemographics && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-2">
                    {gender}
                    {gender && age && <span className="text-ink-3">·</span>}
                    {age && <span className="mono-stat">{age}</span>}
                    <EstimateInfo />
                  </p>
                )}
              </div>
            </div>
            <EmotionBars scores={face.expressions ?? null} dominant={face.dominant} />
          </div>
        )
      })}
    </div>
  )
}

export function ScanningPanel({ className }: { className?: string }) {
  return (
    <div className={cn('card flex flex-col items-center justify-center gap-3 p-8', className)}>
      <span className="spin-slow h-6 w-6 rounded-full border-2 border-primary/25 border-t-primary" />
      <p className="text-sm font-medium text-ink">Analyzing image…</p>
      <p className="text-xs text-ink-3">Detecting faces and classifying expressions</p>
    </div>
  )
}

export function ResultsLegend() {
  return (
    <div className="card mt-4 p-4">
      <SectionTitle>How to read this</SectionTitle>
      <p className="text-xs leading-relaxed text-ink-2">
        Each face box is drawn in the color of its dominant emotion. The pill shows the top
        classification and its confidence; bars show the full distribution across every
        emotion. Download the annotated image to bake every overlay into a PNG.
      </p>
    </div>
  )
}
