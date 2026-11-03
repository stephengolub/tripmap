import { useState } from 'react'
import { suggestMode } from '../api/client'
import { resolveVia } from '../trip/geo'
import type { TripAction } from '../trip/reducer'
import type { ValidationError } from '../trip/validate'
import type { LatLon, Leg, Mode, Stop } from '../types/trip'
import StopCombobox from './StopCombobox'

export const MODES: Mode[] = ['drive', 'train', 'boat', 'flight']

export type SuggestFn = (from: LatLon, to: LatLon) => Promise<{ mode: Mode; reason: string }>

type Props = {
  leg: Leg
  legIndex: number
  stops: readonly Stop[]
  onAction: (action: TripAction) => void
  // Validation errors for this leg only; matched to entries by viaIndex.
  errors?: readonly ValidationError[]
  // Where the trip stood before this leg (the previous leg's last point), so
  // the first via dropdown is still sorted nearest-first.
  start?: LatLon | null
  // "Route point on map" on entry viaIndex: the caller enters point mode.
  onPickOnMap?: (legIndex: number, viaIndex: number) => void
  suggest?: SuggestFn
}

type Suggestion = { text: string; failed: boolean } | null

// One leg: mode, flags, the ordered via list, and a mode suggestion from the
// server. The suggestion is shown, never applied; the user picks it.
export default function LegCard({
  leg,
  legIndex,
  stops,
  onAction,
  errors = [],
  start = null,
  onPickOnMap,
  suggest = suggestMode,
}: Props) {
  const [suggestion, setSuggestion] = useState<Suggestion>(null)
  const [suggesting, setSuggesting] = useState(false)
  const n = legIndex + 1
  const points = leg.via.map((v) => resolveVia({ stops: [...stops] }, v))
  const resolved = points.filter((p): p is LatLon => p !== null)

  async function onSuggest() {
    if (resolved.length < 2) return
    setSuggesting(true)
    try {
      const { mode, reason } = await suggest(resolved[0], resolved[resolved.length - 1])
      setSuggestion({ text: `Suggested: ${mode}. ${reason}`, failed: false })
    } catch (e) {
      setSuggestion({ text: e instanceof Error ? e.message : String(e), failed: true })
    } finally {
      setSuggesting(false)
    }
  }

  // A new entry is a blank name, which validation flags until a stop is picked.
  const insertAt = (viaIndex: number) => onAction({ type: 'insertVia', legIndex, viaIndex, value: '' })

  return (
    <li className={`leg-card${leg.enabled ? '' : ' leg-card-disabled'}`} aria-label={`Leg ${n}`}>
      <div className="leg-card-head">
        <span className="leg-card-date">{leg.date || 'No date'}</span>
        <select
          aria-label={`Leg ${n} mode`}
          value={leg.mode}
          onChange={(e) => onAction({ type: 'setLegMode', legIndex, mode: e.target.value as Mode })}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button type="button" className="leg-card-small" onClick={onSuggest} disabled={suggesting || resolved.length < 2}>
          {suggesting ? 'Suggesting…' : 'Suggest mode'}
        </button>
        <button
          type="button"
          className="leg-card-small leg-card-danger"
          aria-label={`Remove leg ${n}`}
          onClick={() => onAction({ type: 'removeLeg', legIndex })}
        >
          Remove leg
        </button>
      </div>
      {suggestion && (
        <p className={suggestion.failed ? 'leg-card-suggest-error' : 'leg-card-suggest'} role="status">
          {suggestion.text}
        </p>
      )}
      <div className="leg-card-flags">
        <label>
          <input
            type="checkbox"
            checked={leg.enabled}
            onChange={(e) => onAction({ type: 'setLegEnabled', legIndex, enabled: e.target.checked })}
          />
          Enabled
        </label>
        <label>
          <input
            type="checkbox"
            checked={leg.day_trip ?? false}
            onChange={(e) => onAction({ type: 'setLegDayTrip', legIndex, dayTrip: e.target.checked })}
          />
          Day trip
        </label>
      </div>
      <ol className="leg-card-via">
        {leg.via.map((value, viaIndex) => {
          const error = errors.find((e) => e.viaIndex === viaIndex)
          const message = error && (value === '' ? 'Pick a stop' : error.message)
          // Nearest-first from the last entry before this one that resolves.
          const previous = points.slice(0, viaIndex).reverse().find((p) => p !== null) ?? start
          const label = `Leg ${n} stop ${viaIndex + 1}`
          return (
            <li key={viaIndex} className="leg-card-via-row">
              <StopCombobox
                value={value}
                stops={stops}
                previous={previous}
                label={label}
                error={message}
                onChange={(v) => onAction({ type: 'setVia', legIndex, viaIndex, value: v })}
                onPickOnMap={onPickOnMap ? () => onPickOnMap(legIndex, viaIndex) : undefined}
              />
              <div className="leg-card-via-buttons">
                <button
                  type="button"
                  className="leg-card-icon"
                  aria-label={`Move ${label} up`}
                  disabled={viaIndex === 0}
                  onClick={() => onAction({ type: 'moveVia', legIndex, from: viaIndex, to: viaIndex - 1 })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="leg-card-icon"
                  aria-label={`Move ${label} down`}
                  disabled={viaIndex === leg.via.length - 1}
                  onClick={() => onAction({ type: 'moveVia', legIndex, from: viaIndex, to: viaIndex + 1 })}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="leg-card-icon"
                  aria-label={`Insert after ${label}`}
                  onClick={() => insertAt(viaIndex + 1)}
                >
                  +
                </button>
                <button
                  type="button"
                  className="leg-card-icon leg-card-danger"
                  aria-label={`Remove ${label}`}
                  onClick={() => onAction({ type: 'removeVia', legIndex, viaIndex })}
                >
                  ×
                </button>
              </div>
            </li>
          )
        })}
      </ol>
      <button type="button" className="leg-card-small" onClick={() => insertAt(leg.via.length)}>
        Add stop to leg
      </button>
    </li>
  )
}
