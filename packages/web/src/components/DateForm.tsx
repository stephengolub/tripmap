import { useEffect, useState, type FormEvent } from 'react'

// Matches the server's limit in tripmap_api.models: end - start may be at most 60 days.
export const MAX_SPAN_DAYS = 60

export type RangeErrors = { start: string | null; end: string | null }

const DAY_MS = 24 * 60 * 60 * 1000

function parseDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  return Number.isNaN(ms) ? null : ms
}

// One message per field, or null when that field is fine.
export function validateRange(start: string, end: string): RangeErrors {
  const errors: RangeErrors = { start: null, end: null }
  const from = parseDay(start)
  const to = parseDay(end)
  if (!start) errors.start = 'Pick a start date.'
  else if (from === null) errors.start = 'That is not a valid date.'
  if (!end) errors.end = 'Pick an end date.'
  else if (to === null) errors.end = 'That is not a valid date.'
  if (from !== null && to !== null) {
    const days = Math.round((to - from) / DAY_MS)
    if (days < 0) errors.end = 'The end date is before the start date.'
    else if (days > MAX_SPAN_DAYS) errors.end = `Pick a range of ${MAX_SPAN_DAYS} days or less.`
  }
  return errors
}

type Props = {
  // Runs the draft. A rejection's message is shown to the user, so throw readable text.
  onSubmit: (start: string, end: string) => Promise<void>
  submitLabel?: string
}

export default function DateForm({ onSubmit, submitLabel = 'Detect route' }: Props) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const errors = validateRange(start, end)
  const valid = !errors.start && !errors.end

  useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const began = Date.now()
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - began) / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [busy])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(start, end)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong while detecting the route. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  // Only nag about a field once something has been typed, so the empty form starts clean.
  const shown = (field: 'start' | 'end') => ((start || end) ? errors[field] : null)

  return (
    <form className="date-form" onSubmit={handleSubmit} noValidate>
      <fieldset disabled={busy}>
        <div className="field">
          <label htmlFor="trip-start">From</label>
          <input
            id="trip-start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            aria-invalid={Boolean(shown('start'))}
            aria-describedby="trip-start-error"
            required
          />
          <span id="trip-start-error" className="field-error">
            {shown('start')}
          </span>
        </div>
        <div className="field">
          <label htmlFor="trip-end">To</label>
          <input
            id="trip-end"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            aria-invalid={Boolean(shown('end'))}
            aria-describedby="trip-end-error"
            required
          />
          <span id="trip-end-error" className="field-error">
            {shown('end')}
          </span>
        </div>
        <button type="submit" disabled={!valid || busy}>
          {submitLabel}
        </button>
      </fieldset>
      {busy && (
        <div className="draft-progress" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>Detecting the route can take a minute.</span>
          <span className="elapsed">{elapsed}s</span>
        </div>
      )}
      {error && (
        <p className="draft-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
