import { resolveVia } from '../trip/geo'
import type { TripAction } from '../trip/reducer'
import type { ValidationError } from '../trip/validate'
import type { LatLon, Trip } from '../types/trip'
import LegCard, { type SuggestFn } from './LegCard'
import './LegList.css'

type Props = {
  trip: Pick<Trip, 'stops' | 'legs'>
  onAction: (action: TripAction) => void
  errors?: readonly ValidationError[]
  onPickOnMap?: (legIndex: number, viaIndex: number) => void
  suggest?: SuggestFn
}

function lastPoint(trip: Pick<Trip, 'stops'>, via: Trip['legs'][number]['via']): LatLon | null {
  for (let i = via.length - 1; i >= 0; i--) {
    const p = resolveVia(trip, via[i])
    if (p) return p
  }
  return null
}

// One card per leg, in trip order, plus a button to append a leg.
export default function LegList({ trip, onAction, errors = [], onPickOnMap, suggest }: Props) {
  return (
    <section className="leg-list" aria-label="Legs">
      <ol>
        {trip.legs.map((leg, legIndex) => (
          <LegCard
            key={legIndex}
            leg={leg}
            legIndex={legIndex}
            stops={trip.stops}
            onAction={onAction}
            errors={errors.filter((e) => e.legIndex === legIndex)}
            start={legIndex > 0 ? lastPoint(trip, trip.legs[legIndex - 1].via) : null}
            onPickOnMap={onPickOnMap}
            suggest={suggest}
          />
        ))}
      </ol>
      {trip.legs.length === 0 && <p className="leg-list-empty">No legs yet.</p>}
      <button type="button" onClick={() => onAction({ type: 'addLeg' })}>
        Add leg
      </button>
    </section>
  )
}
