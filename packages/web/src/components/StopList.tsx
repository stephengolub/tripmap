import { useEffect, useRef, useState } from 'react'
import type { TripAction } from '../trip/reducer'
import type { Stop, StopKind } from '../types/trip'
import './StopList.css'

export const KINDS: StopKind[] = ['major', 'minor', 'hidden']

type Props = {
  stops: readonly Stop[]
  onAction: (action: TripAction) => void
  // The reducer's refusal message (TripState.error). Shown on the row whose
  // Remove was clicked last, and gone once any accepted action clears it.
  error?: string
  // Focus and select this stop's name field, e.g. a stop just added on the map.
  focusName?: string
  // The stop to highlight on the map: the row that has focus.
  selected?: string | null
  onSelect?: (name: string) => void
}

function formatAt([lat, lon]: Stop['at']): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}

type RowProps = {
  stop: Stop
  onAction: (action: TripAction) => void
  onRemove: () => void
  error?: string
  focus: boolean
  selected: boolean
  onSelect?: (name: string) => void
}

function StopRow({ stop, onAction, onRemove, error, focus, selected, onSelect }: RowProps) {
  // The name is edited locally and committed on blur or Enter, so a half-typed
  // name never renames every via reference keystroke by keystroke.
  const [draft, setDraft] = useState(stop.name)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => setDraft(stop.name), [stop.name])
  useEffect(() => {
    if (focus) input.current?.select()
  }, [focus])

  function commit() {
    if (draft !== stop.name) onAction({ type: 'renameStop', from: stop.name, to: draft })
    // A refused rename leaves stop.name as it was; show it again.
    setDraft(stop.name)
  }

  return (
    <li
      className={selected ? 'stop-row stop-row-selected' : 'stop-row'}
      aria-label={stop.name}
      aria-current={selected ? 'true' : undefined}
      onFocus={() => onSelect?.(stop.name)}
    >
      <input
        ref={input}
        className="stop-row-name"
        aria-label={`Name of ${stop.name}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(stop.name)
        }}
      />
      <select
        aria-label={`Kind of ${stop.name}`}
        value={stop.kind}
        onChange={(e) => onAction({ type: 'setStopKind', name: stop.name, kind: e.target.value as StopKind })}
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <span className="stop-row-at">{formatAt(stop.at)}</span>
      {stop.nights ? <span className="stop-row-nights">{stop.nights} nights</span> : null}
      <button type="button" className="stop-row-remove" aria-label={`Remove ${stop.name}`} onClick={onRemove}>
        Remove
      </button>
      {error && (
        <p className="stop-row-error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

// Every stop in the trip, hidden ones included: rename, change kind, remove.
export default function StopList({ stops, onAction, error, focusName, selected = null, onSelect }: Props) {
  const [removing, setRemoving] = useState<string | null>(null)

  return (
    <section className="stop-list" aria-label="Stops">
      <ul>
        {stops.map((stop) => (
          <StopRow
            key={stop.name}
            stop={stop}
            onAction={onAction}
            onRemove={() => {
              setRemoving(stop.name)
              onAction({ type: 'removeStop', name: stop.name })
            }}
            error={removing === stop.name ? error : undefined}
            focus={focusName === stop.name}
            selected={selected === stop.name}
            onSelect={onSelect}
          />
        ))}
      </ul>
      {stops.length === 0 && <p className="stop-list-empty">No stops yet.</p>}
    </section>
  )
}
