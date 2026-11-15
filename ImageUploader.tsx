/**
 * ImageUploader — drop zone for still images.
 */
import { ScanFace, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { ACCEPTED_IMAGE_TYPES } from '@/utils/constants'
import { cn } from '@/utils/cn'

export function ImageUploader({ onFileSelected }: { onFileSelected: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFileSelected(file)
          event.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragOver(false)
          const file = event.dataTransfer.files?.[0]
          if (file) onFileSelected(file)
        }}
        aria-label="Upload an image for emotion analysis"
        className={cn(
          'flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-20 text-center transition-all duration-200',
          isDragOver
            ? 'border-solid border-primary bg-primary-100'
            : 'border-[#CBD5E1] bg-canvas hover:border-primary hover:bg-primary-50',
        )}
      >
        <span
          className={cn(
            'grid h-14 w-14 place-items-center rounded-full transition-colors duration-200',
            isDragOver ? 'bg-white text-primary' : 'bg-white text-ink-3 shadow-sm',
          )}
        >
          <Upload size={24} strokeWidth={1.8} />
        </span>
        <p className="mt-4 text-sm font-medium text-ink-2">
          Drop an image here or click to browse
        </p>
        <p className="mt-1 text-xs text-ink-3">JPG, PNG, WEBP · Max 10MB</p>
        <p className="mono-stat mt-6 flex items-center gap-1.5 text-[11px] text-ink-3">
          <ScanFace size={13} className="text-primary" />
          On-device inference — your photos never leave this browser
        </p>
      </button>
    </>
  )
}
