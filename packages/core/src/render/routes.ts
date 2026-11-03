// Leg geometry for the renderer: roads, rail lines and sea crossings, in [lat, lon].
// Ports of the routing half of build_svg, plus land_cut and sea_route, in
// src/tripmap/__init__.py. Routing needs the network (OSRM, BRouter, Overpass), so it is
// done here, ahead of time, and buildSvg stays pure and synchronous.

import { boxOf, inPolygon, type Box, type PolygonCoords } from '../geodata.ts'
import { trainRoute, type Services } from '../services.ts'
import type { LatLon, Leg, Trip } from '../types.ts'

export type RoadPiece = ['drive' | 'ferry', LatLon[]]

export type LegRoute =
  | { mode: 'drive'; pieces: RoadPiece[] }
  | { mode: 'train'; path: LatLon[]; onRails: boolean }
  | { mode: 'boat'; path: LatLon[] }
  | { mode: 'flight' }

// What routing needs: road geometry (osrm), rail geometry and station lookups.
export type RouteServices = Pick<Services, 'rail' | 'stations'> & {
  road(coords: LatLon[]): Promise<RoadPiece[]>
}

// Anything with land polygons: a Geo, or pre-simplified geodata in the browser.
export type LandGeo = { readonly landPolygons: readonly PolygonCoords[] }

export class TripRenderError extends Error {}

// Port of resolve() in build_svg: a stop name to its coordinates, a hint as itself.
export function resolver(trip: Trip): (v: Leg['via'][number]) => LatLon {
  const stops = new Map(trip.stops.map((s) => [s.name, s]))
  return (v) => {
    if (typeof v === 'string') {
      const s = stops.get(v)
      if (!s) throw new TripRenderError(`leg via '${v}' is not a stop name. Stops: ${[...stops.keys()].join(', ')}`)
      return [s.at[0], s.at[1]]
    }
    return [Number(v[0]), Number(v[1])]
  }
}

// The legs a render draws: enabled ones, and day trips only when asked. Keeps each leg's
// index in trip.legs so routes can be looked up by it.
export function drawnLegs(trip: Trip, withDayTrips: boolean): { leg: Leg; index: number }[] {
  return trip.legs
    .map((leg, index) => ({ leg, index }))
    .filter(({ leg }) => leg.enabled !== false && (withDayTrips || !leg.day_trip))
}

const boxCache = new WeakMap<PolygonCoords, Box>()
const polyBox = (p: PolygonCoords) => {
  let b = boxCache.get(p)
  if (!b) boxCache.set(p, (b = boxOf([p[0]])))
  return b
}

// Parameters t in (0, 1) where segment p->q crosses an edge of the ring.
function crossings(ring: number[][], p: number[], q: number[]): number[] {
  const out: number[] = []
  const rx = q[0] - p[0], ry = q[1] - p[1]
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i], b = ring[i + 1]
    const sx = b[0] - a[0], sy = b[1] - a[1]
    const den = rx * sy - ry * sx
    if (!den) continue
    const t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den
    const u = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den
    if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t)
  }
  return out
}

// Port of land_cut: km of the straight a->b line that crosses land, ignoring 1.5 km
// (0.02 degrees) around each end.
export function landCut(geo: LandGeo, a: LatLon, b: LatLon): number {
  const p = [a[1], a[0]], q = [b[1], b[0]]
  const len = Math.hypot(q[0] - p[0], q[1] - p[1])
  if (!len) return 0
  const e = 0.02 / len
  if (e >= 0.5) return 0
  const seg: Box = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]
  let inside = 0
  for (const poly of geo.landPolygons) {
    const pb = polyBox(poly)
    if (pb[0] > seg[2] || pb[2] < seg[0] || pb[1] > seg[3] || pb[3] < seg[1]) continue
    const ts = [e, 1 - e, ...poly.flatMap((r) => crossings(r, p, q)).filter((t) => t > e && t < 1 - e)].sort((x, y) => x - y)
    for (let i = 0; i + 1 < ts.length; i++) {
      const m = (ts[i] + ts[i + 1]) / 2
      if (ts[i + 1] > ts[i] && inPolygon(poly, p[0] + m * (q[0] - p[0]), p[1] + m * (q[1] - p[1]))) inside += ts[i + 1] - ts[i]
    }
  }
  return inside * len * 111 * Math.cos((a[0] * Math.PI) / 180)
}

// Port of sea_route: bend a boat segment out to sea until it stops cutting across land.
export function seaRoute(geo: LandGeo, a: LatLon, b: LatLon, depth = 0): LatLon[] {
  if (depth >= 4 || landCut(geo, a, b) < 0.3) return [a, b]
  const mid: LatLon = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const kx = Math.cos((mid[0] * Math.PI) / 180)
  const dx = (b[1] - a[1]) * kx, dy = b[0] - a[0]
  let best: [number, LatLon] | null = null
  for (const f of [0.12, -0.12, 0.25, -0.25, 0.4, -0.4]) {
    const m: LatLon = [mid[0] + dx * f, mid[1] - (dy * f) / kx]
    const c = landCut(geo, a, m) + landCut(geo, m, b)
    if (best === null || c < best[0]) best = [c, m]
    if (c < 0.3) break
  }
  const m = best![1]
  return [...seaRoute(geo, a, m, depth + 1).slice(0, -1), ...seaRoute(geo, m, b, depth + 1)]
}

// A boat leg's path: each hop bent out to sea.
export function boatPath(geo: LandGeo, ll: LatLon[]): LatLon[] {
  const path = [ll[0]]
  for (let i = 0; i + 1 < ll.length; i++) path.push(...seaRoute(geo, ll[i], ll[i + 1]).slice(1))
  return path
}

// Route every drawn leg. Returns an array indexed like trip.legs (undrawn legs are left
// empty), ready for buildSvg. Unknown modes are refused here, as build_svg does.
export async function routeLegs(
  trip: Trip, withDayTrips: boolean, services: RouteServices, geo: LandGeo, log: (msg: string) => void = () => {},
): Promise<(LegRoute | undefined)[]> {
  const resolve = resolver(trip)
  const legs = drawnLegs(trip, withDayTrips)
  const trainVia = legs.filter(({ leg }) => leg.mode === 'train').flatMap(({ leg }) => leg.via.filter((v) => typeof v === 'string'))
  const stations = trainVia.length ? await services.stations(trainVia.map(resolve), 5) : null
  const out: (LegRoute | undefined)[] = new Array(trip.legs.length)
  for (const { leg, index } of legs) {
    const ll = leg.via.map(resolve)
    switch (leg.mode) {
      case 'drive':
        out[index] = { mode: 'drive', pieces: await services.road(ll) }
        break
      case 'boat':
        out[index] = { mode: 'boat', path: boatPath(geo, ll) }
        break
      case 'train': {
        const named = leg.via.map((v) => typeof v === 'string')
        out[index] = { mode: 'train', ...(await trainRoute(services, ll, named, stations!, log)) }
        break
      }
      case 'flight':
        out[index] = { mode: 'flight' }
        break
      default:
        throw new TripRenderError(`unknown leg mode '${String(leg.mode)}' (use drive, train, boat or flight)`)
    }
  }
  return out
}
