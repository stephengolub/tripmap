import { useEffect, useRef, useState } from 'react'
import { renderTrip } from '../api/client'
import { validateTrip } from '../trip/validate'
import type { Trip } from '../types/trip'
import './RenderPanel.css'

// Long side of the preview PNG, in pixels.
export const PREVIEW_SIZE = 1600

type Props = {
  trip: Trip
  // Background photo size, so the PNG is drawn in the photo's shape.
  photoSize?: { width: number; height: number } | null
  // Called with each new PNG, for the photo preview to composite.
  onRendered?: (png: Blob) => void
}

// Renders the trip in this tab (buildSvg + canvas, see api/client) and shows the PNG. The
// image is held as an object URL in this tab only.
export default function RenderPanel({ trip, photoSize, onRendered }: Props) {
  const [withDayTrips, setWithDayTrips] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)

  const invalid = validateTrip(trip).length > 0

  // Revoke the last object URL when the panel goes away.
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  async function handleRender() {
    setBusy(true)
    setError(null)
    try {
      const png = await renderTrip(trip, {
        size: PREVIEW_SIZE,
        with_day_trips: withDayTrips,
        ...(photoSize ? { photo_size: photoSize } : {}),
      })
      const next = URL.createObjectURL(png)
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = next
      setUrl(next)
      onRendered?.(png)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="render-panel" aria-label="Render">
      <div className="render-controls">
        <button type="button" onClick={handleRender} disabled={invalid || busy}>
          {busy ? 'Rendering…' : 'Render'}
        </button>
        <label>
          <input
            type="checkbox"
            checked={withDayTrips}
            onChange={(e) => setWithDayTrips(e.target.checked)}
          />{' '}
          Show day trips
        </label>
        {url && (
          <a href={url} download="trip.png">
            Download PNG
          </a>
        )}
      </div>
      {invalid && <p className="render-hint">Fix the problems above to render.</p>}
      {error && (
        <p className="render-error" role="alert">
          {error}
        </p>
      )}
      {url && <img className="render-image" src={url} alt="Rendered route map" />}
    </section>
  )
}
