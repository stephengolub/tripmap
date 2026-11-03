// Distance and lookup helpers for the editor: resolving `via` entries to
// points, and ordering stop options nearest-first in the stop dropdown.

import type { LatLon, Trip } from '../types/trip'
import type { ViaEntry } from './reducer'

const EARTH_RADIUS_KM = 6371.0088

// Great-circle distance between two [lat, lon] points, in kilometres.
export function haversineKm(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const dLat = (b[0] - a[0]) * rad
  const dLon = (b[1] - a[1]) * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

// A stop name resolves to that stop's position, a point to itself, and a
// name that matches no stop to null.
export function resolveVia(trip: Pick<Trip, 'stops'>, via: ViaEntry): LatLon | null {
  if (typeof via !== 'string') return via
  const stop = trip.stops.find((s) => s.name === via)
  return stop ? stop.at : null
}

// Nearest first from `from`. Ties, and every option when `from` is null,
// keep their original order. Returns a new array.
export function sortByDistance<T extends { at: LatLon }>(options: readonly T[], from: LatLon | null): T[] {
  if (!from) return [...options]
  return options
    .map((option, index) => ({ option, index, km: haversineKm(from, option.at) }))
    .sort((x, y) => x.km - y.km || x.index - y.index)
    .map((x) => x.option)
}

// The points the map should frame: visible stops (hidden ones have no marker), or every stop
// when none is visible. Empty when there are no stops.
export function framingPoints(stops: readonly { kind: string; at: LatLon }[]): LatLon[] {
  const visible = stops.filter((s) => s.kind !== 'hidden')
  return (visible.length ? visible : stops).map((s) => s.at)
}
