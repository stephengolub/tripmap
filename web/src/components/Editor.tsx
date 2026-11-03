import { useCallback, useMemo, useReducer, useState } from 'react'
import { tripOf, tripReducer, type TripState } from '../trip/reducer'
import { validateTrip } from '../trip/validate'
import type { LatLon, Trip } from '../types/trip'
import LegList from './LegList'
import RenderPanel from './RenderPanel'
import StopList from './StopList'
import TripMap from './TripMap'

type Props = {
  // The drafted trip. Mount a fresh Editor (new `key`) for each draft.
  initial: Trip
}

// Where the next map click goes: a new stop, or a route point for one via entry.
type MapMode = { kind: 'idle' } | { kind: 'addStop' } | { kind: 'point'; legIndex: number; viaIndex: number }

// The map editor. Every edit goes through tripReducer; the trip stays in
// browser memory.
export default function Editor({ initial }: Props) {
  const [state, dispatch] = useReducer(tripReducer, initial as TripState)
  const [mode, setMode] = useState<MapMode>({ kind: 'idle' })
  // Position of the stop just placed on the map, to select its name field.
  const [addedAt, setAddedAt] = useState<LatLon | null>(null)

  const errors = useMemo(() => validateTrip(state), [state])
  const trip = useMemo(() => tripOf(state), [state])
  const focusName = addedAt
    ? state.stops.find((s) => s.at[0] === addedAt[0] && s.at[1] === addedAt[1])?.name
    : undefined

  const onStopAdded = useCallback((at: LatLon) => {
    setAddedAt(at)
    setMode({ kind: 'idle' })
  }, [])

  const onMapClick = useCallback(
    (at: LatLon) => {
      if (mode.kind !== 'point') return
      dispatch({ type: 'setVia', legIndex: mode.legIndex, viaIndex: mode.viaIndex, value: at })
      setMode({ kind: 'idle' })
    },
    [mode],
  )

  return (
    <section className="editor" aria-label="Editor">
      <div className="editor-toolbar" role="toolbar" aria-label="Map tools">
        <button
          type="button"
          aria-pressed={mode.kind === 'addStop'}
          onClick={() => setMode(mode.kind === 'addStop' ? { kind: 'idle' } : { kind: 'addStop' })}
        >
          {mode.kind === 'addStop' ? 'Cancel add stop' : 'Add stop'}
        </button>
        {mode.kind === 'point' && (
          <>
            <span className="editor-hint">
              Click the map to set leg {mode.legIndex + 1}, stop {mode.viaIndex + 1}.
            </span>
            <button type="button" onClick={() => setMode({ kind: 'idle' })}>
              Cancel
            </button>
          </>
        )}
      </div>

      <div className="editor-main">
        <TripMap
          trip={state}
          onAction={dispatch}
          addMode={mode.kind === 'addStop'}
          onStopAdded={onStopAdded}
          onMapClick={onMapClick}
        />
        <LegList
          trip={state}
          onAction={dispatch}
          errors={errors}
          onPickOnMap={(legIndex, viaIndex) => setMode({ kind: 'point', legIndex, viaIndex })}
        />
      </div>

      <ValidationSummary errors={errors} trip={state} />

      <RenderPanel trip={trip} />

      <StopList stops={state.stops} onAction={dispatch} error={state.error} focusName={focusName} />
    </section>
  )
}

type SummaryProps = { errors: ReturnType<typeof validateTrip>; trip: Trip }

function ValidationSummary({ errors, trip }: SummaryProps) {
  if (errors.length === 0) {
    return (
      <p className="validation-summary validation-ok" data-testid="validation-summary">
        Ready to render.
      </p>
    )
  }
  return (
    <div className="validation-summary validation-errors" data-testid="validation-summary" role="alert">
      <p>
        Fix {errors.length} {errors.length === 1 ? 'problem' : 'problems'} before rendering:
      </p>
      <ul>
        {errors.map((e) => (
          <li key={`${e.legIndex}-${e.viaIndex}`}>
            Leg {e.legIndex + 1}, stop {e.viaIndex + 1}:{' '}
            {trip.legs[e.legIndex].via[e.viaIndex] === '' ? 'Pick a stop' : e.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
