/**
 * UploadPage — still-image analysis flow.
 * Renders the useImageAnalysis hook's state; contains no pipeline logic.
 */
import { Download, ImagePlus } from 'lucide-react'
import {
  ImageCanvas,
  ImageResults,
  ResultsLegend,
  ScanningPanel,
} from '@/components/upload/ImageResults'
import { ImageUploader } from '@/components/upload/ImageUploader'
import { Button } from '@/components/shared/Button'
import { useImageAnalysis } from '@/hooks/useImageAnalysis'
import { useSettingsStore } from '@/store/settingsStore'
import { cn } from '@/utils/cn'

export function UploadPage() {
  const shouldShowAgeGender = useSettingsStore((state) => state.shouldShowAgeGender)
  const { phase, image, faces, selectFile, reset, exportAnnotated } = useImageAnalysis()

  if (phase === 'idle' || !image) {
    return (
      <div className="mx-auto max-w-3xl pb-10">
        <ImageUploader onFileSelected={(file) => void selectFile(file)} />
      </div>
    )
  }

  const hasResults = phase === 'done' && faces.length > 0

  return (
    <div className="pb-10">
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {image.name}
          <span className="mono-stat ml-2 text-[11px] font-normal text-ink-3">
            {image.width}×{image.height}
          </span>
        </p>
        {hasResults && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void exportAnnotated()}
            icon={<Download size={14} />}
          >
            Download annotated image
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="border border-line"
          onClick={reset}
          icon={<ImagePlus size={14} />}
        >
          Analyze another
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div
          className={cn(
            'card flex items-center justify-center bg-surface-alt/60 p-4',
            hasResults ? 'lg:col-span-7' : 'lg:col-span-12',
          )}
        >
          <ImageCanvas
            image={image}
            faces={faces}
            isScanning={phase === 'analyzing'}
            shouldShowAgeGender={shouldShowAgeGender}
          />
        </div>

        {phase === 'analyzing' && <ScanningPanel className="lg:col-span-5" />}

        {phase === 'done' && faces.length === 0 && (
          <div className="card p-6 text-center lg:col-span-12">
            <p className="text-sm font-medium text-ink-2">No faces detected in this image</p>
            <p className="mt-1 text-xs text-ink-3">
              Try a higher-resolution photo with clearly visible faces.
            </p>
          </div>
        )}

        {hasResults && (
          <div className="lg:col-span-5">
            <ImageResults faces={faces} shouldShowAgeGender={shouldShowAgeGender} />
          </div>
        )}
      </div>

      {hasResults && <ResultsLegend />}
    </div>
  )
}
