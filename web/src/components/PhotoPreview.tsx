import { useEffect, useRef, useState } from 'react'
import './PhotoPreview.css'

export type PhotoSize = { width: number; height: number }

// Output size of the composite: the photo's shape, long side at most `maxSide`.
// Small photos are not enlarged, matching the CLI's `-resize 1600x1600>`.
export function compositeSize(photoW: number, photoH: number, maxSide: number): PhotoSize {
  const scale = Math.min(1, maxSide / Math.max(photoW, photoH))
  return { width: Math.round(photoW * scale), height: Math.round(photoH * scale) }
}

// Long side of the preview JPEG, in pixels.
export const PREVIEW_MAX_SIDE = 1600

type Props = {
  // The latest rendered PNG, or null before the first render.
  png: Blob | null
  // Called with the photo's pixel size, so the render can match its shape.
  onPhotoSize?: (size: PhotoSize | null) => void
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read that image.'))
    img.src = src
  })
}

// Draws the rendered PNG over a background photo on a canvas. The photo is
// read with an object URL and never leaves the browser.
export default function PhotoPreview({ png, onPhotoSize }: Props) {
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null)
  const [jpeg, setJpeg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const photoUrl = useRef<string | null>(null)

  useEffect(() => () => {
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current)
  }, [])

  async function handleFile(file: File | undefined) {
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current)
    photoUrl.current = null
    setError(null)
    setJpeg(null)
    if (!file) {
      setPhoto(null)
      onPhotoSize?.(null)
      return
    }
    const url = URL.createObjectURL(file)
    photoUrl.current = url
    try {
      const img = await loadImage(url)
      setPhoto(img)
      onPhotoSize?.({ width: img.naturalWidth, height: img.naturalHeight })
    } catch (e) {
      setPhoto(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!photo || !png || !canvas) return
    let cancelled = false
    const pngUrl = URL.createObjectURL(png)
    loadImage(pngUrl)
      .then((map) => {
        if (cancelled) return
        const { width, height } = compositeSize(photo.naturalWidth, photo.naturalHeight, PREVIEW_MAX_SIDE)
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(photo, 0, 0, width, height)
        // Fit the map inside the photo, centred. When the render was made at
        // the photo's shape this fills it exactly.
        const s = Math.min(width / map.naturalWidth, height / map.naturalHeight)
        const w = map.naturalWidth * s
        const h = map.naturalHeight * s
        ctx.drawImage(map, (width - w) / 2, (height - h) / 2, w, h)
        setJpeg(canvas.toDataURL('image/jpeg', 0.88))
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => URL.revokeObjectURL(pngUrl))
    return () => {
      cancelled = true
    }
  }, [photo, png])

  return (
    <section className="photo-preview" aria-label="Photo preview">
      <label>
        Background photo (stays in this browser):{' '}
        <input type="file" accept="image/*" onChange={(e) => handleFile(e.target.files?.[0])} />
      </label>
      {error && (
        <p className="photo-preview-error" role="alert">
          {error}
        </p>
      )}
      {photo && !png && <p className="photo-preview-hint">Render to see the map on this photo.</p>}
      <canvas ref={canvasRef} className="photo-preview-canvas" hidden={!photo || !png} />
      {jpeg && (
        <a href={jpeg} download="trip-preview.jpg">
          Download preview
        </a>
      )}
    </section>
  )
}
