// The draft entry point: photos in, trip document and stats out. Port of build_trip in
// src/tripmap/__init__.py from the photo count check to the end (the Photos read lives in
// node/draft-node.ts). Every lookup goes through Services. Browser-safe.

import { buildStops } from './draft-stops.ts'
import { buildLegs, hideLayoverStops, markLayovers } from './legs.ts'
import type { Services } from './services.ts'
import type { DraftStop, Log, PhotoPoint } from './stops.ts'
import type { HopContext } from './trains.ts'
import type { LatLon, Leg, Mode, Stats, Stop, Trip } from './types.ts'

/** A trip cannot be built or drawn; the message is meant for the user. */
export class TripError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TripError'
  }
}

export interface DraftOptions {
  from: string // YYYY-MM-DD, local
  to: string
  title?: string
  /** Progress messages: counts and status only, never coordinates or paths. */
  log?: Log
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// Python's f"{d:%b %-d}".
const monthDay = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`

/** Python's default title, "Trip May 2 – May 8, 2024". */
export function defaultTitle(from: string, to: string): string {
  return `Trip ${monthDay(from)} – ${monthDay(to)}, ${to.slice(0, 4)}`
}

// The trip Stop for a drafting stop: the YAML's fields in its order, no `raw`.
function tripStop(s: DraftStop): Stop {
  const x: Stop = { name: s.name, kind: s.kind, at: [s.at[0], s.at[1]], label: 'auto' }
  for (const k of ['note', 'nights', 'photos', 'when'] as const) {
    if (s[k] != null) (x as Record<string, unknown>)[k] = s[k]
  }
  return x
}

/** Detect the route of the trip between two dates from photos already read (and already
 *  limited to those dates by local date). Throws TripError with fewer than two photos. */
export async function draft(
  opts: DraftOptions, services: Services, photos: readonly PhotoPoint[],
): Promise<{ trip: Trip; stats: Stats }> {
  const { from, to, log = () => {} } = opts
  const raw = photos.filter((p) => from <= p.local.slice(0, 10) && p.local.slice(0, 10) <= to)
  if (raw.length < 2) throw new TripError(`Only ${raw.length} geotagged photos between ${from} and ${to}.`)
  log(`${raw.length} geotagged photos, ${from} → ${to}`)

  const s = await buildStops(raw, services, { log })

  // railway stations near stops and overnight spots, for spotting train legs
  log('looking up railway stations...')
  const spots: LatLon[] = [
    ...s.clusters.filter((c) => c.stop).map((c): LatLon => [c.lat, c.lon]),
    ...s.bases.flatMap((b) => (b.raw ? [b.raw] : [])),
  ]
  const stations = await services.stations(spots, 3)
  const airports = s.stops.filter((x) => x.note === 'airport').map((x) => x.at)
  const ctx: HopContext = { services, stations, airports }

  const legs = markLayovers(await buildLegs(s, ctx))
  const used = hideLayoverStops(legs)

  const stops = [...s.bases, ...s.stops.filter((x) => used.has(x))].map(tripStop)
  const tripLegs: Leg[] = legs.map((l) => ({
    date: l.date, mode: l.mode, day_trip: l.day_trip,
    via: l.via.map((n) => (n.ref?.name !== undefined ? n.ref.name : [n.lat, n.lon] as LatLon)),
    enabled: l.enabled,
  }))
  const trip: Trip = { title: opts.title || defaultTitle(from, to), basemap: 'auto', stops, legs: tripLegs }

  const counts: Partial<Record<Mode, number>> = {}
  for (const l of legs) if (l.enabled) counts[l.mode] = (counts[l.mode] ?? 0) + 1
  const stats: Stats = {
    photo_count: raw.length,
    overnight_names: s.bases.map((b) => b.name),
    quick_names: stops.filter((x) => x.kind === 'minor').map((x) => x.name),
    hidden_names: stops.filter((x) => x.kind === 'hidden').map((x) => x.name),
    leg_counts: counts,
  }
  return { trip, stats }
}
