// Train detection. Port of by_train in src/tripmap/__init__.py.

import { STATION_KM, TRAIN_KMH } from './constants.ts'
import { km } from './geo.ts'
import type { Services, Stations } from './services.ts'
import type { LatLon } from './types.ts'

// One point of a day's route sequence. Port of `class Node`: a stop, a sea photo, or a
// shore/way route hint. `t0`/`raw0` are the first photo here (arrival), `t`/`raw` the
// latest (departure).
export interface RouteNode {
  kind: 'stop' | 'sea' | 'shore' | 'way'
  lat: number
  lon: number
  t: number | null
  t0: number | null
  raw: LatLon | null
  raw0: LatLon | null
  ref: { name?: string; note?: string; at: LatLon } | null
  sea: boolean
}

export function routeNode(
  kind: RouteNode['kind'], lat: number, lon: number,
  opts: { t?: number | null; ref?: RouteNode['ref']; sea?: boolean; raw?: LatLon | null } = {},
): RouteNode {
  const t = opts.t ?? null, raw = opts.raw ?? null
  return { kind, lat, lon, t, t0: t, raw, raw0: raw, ref: opts.ref ?? null, sea: opts.sea ?? false }
}

export const nodeLL = (n: RouteNode): LatLon => [n.lat, n.lon]

// What hop classification needs besides the two nodes.
export interface HopContext {
  services: Pick<Services, 'coastKm' | 'classifyStrict' | 'drivable' | 'rail'>
  stations: Stations
  airports: LatLon[] // `at` of every stop noted as an airport
}

export function isAirport(n: RouteNode, airports: LatLon[]): boolean {
  return n.ref?.note === 'airport' || airports.some((a) => km(nodeLL(n), a) < 5)
}

// Python truthiness for timestamps: missing or 0 counts as no time.
const hasT = (t: number | null): t is number => !!t

// Is a -> b a train ride? Needs a rail route, plus a speed no car manages or a departure
// and arrival photographed at stations.
export async function byTrain(a: RouteNode, b: RouteNode, ctx: HopContext): Promise<boolean> {
  const { stations, airports } = ctx
  if (a.sea || b.sea || isAirport(a, airports) || isAirport(b, airports)) return false
  const dist = km(nodeLL(a), nodeLL(b))
  if (dist < 25 || dist > 700) return false
  let fast = false
  if (hasT(a.t) && hasT(b.t0) && dist > 40) {
    const kmh = dist / Math.max((b.t0 - a.t) / 3600, 0.1)
    fast = TRAIN_KMH[0] < kmh && kmh < TRAIN_KMH[1]
  }
  // Departure photo at a, arrival photo at b.
  const atStations = !!(a.raw && stations.nearest(a.raw, STATION_KM))
    && !!(b.raw && b.raw0 && stations.nearest(b.raw0, STATION_KM))
  if (!(fast || atStations)) return false
  const ends = [a, b].map((n) => stations.nearest(n.raw ?? nodeLL(n), 3) ?? nodeLL(n))
  const path = await ctx.services.rail(ends)
  if (!path || !path.length) return false
  let length = 0
  for (let i = 1; i < path.length; i++) length += km(path[i - 1], path[i])
  return length < 1.6 * dist + 20
}
