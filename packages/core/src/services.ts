// Every outside lookup the draft pipeline needs, behind one interface so detection runs
// offline in tests (see testing.ts) and the network code stays in src/node/.
// Mirrors OSM, Stations, Geo, drivable, road_km and rail in src/tripmap/__init__.py.
//
// Network-backed calls return Promises: Node's fetch has no synchronous form. The
// geodata calls (classify, classifyStrict, nearestLandmass, coastKm) are local polygon
// lookups and stay synchronous.

import type { LatLon } from './types.ts'

// Railway stations found near a set of spots. Port of `class Stations`.
export interface Stations {
  // Closest station to ll within maxKm (a minor halt counts as 800 m further), or null.
  nearest(ll: LatLon, maxKm: number): LatLon | null
}

export interface Services {
  // Town-centre coordinates found by searching the town NAME (no coordinates are sent).
  // Falls back to `near` rounded to 3 decimals when nothing within 20 km matches.
  townCentre(name: string, cc: string | null, near: LatLon): Promise<LatLon>
  // One batched landmark lookup: a name (or null) per spot, in order. Best effort.
  landmarks(spots: LatLon[]): Promise<(string | null)[]>
  // Railway stations within radiusKm of any spot. Best effort: empty on failure.
  stations(spots: LatLon[], radiusKm: number): Promise<Stations>
  // Landmass index (or null) and whether the point is out on the water.
  classify(lat: number, lon: number): { landmass: number | null; atSea: boolean }
  // Landmass index only when the point is inside a land polygon (Geo.classify_strict).
  classifyStrict(lat: number, lon: number): number | null
  // Index of the nearest landmass, wherever the point is (Geo.nearest).
  nearestLandmass(lat: number, lon: number): number
  // Distance to the nearest coastline in km.
  coastKm(lat: number, lon: number): number
  // Is there a sensible road between a and b (no huge detour, not mostly ferry)?
  drivable(a: LatLon, b: LatLon): Promise<boolean>
  // Distance to the nearest road in km, or null if the lookup fails.
  roadKm(lat: number, lon: number): Promise<number | null>
  // Path along railway lines through the points, or null if there is no track.
  rail(points: LatLon[]): Promise<LatLon[] | null>
}

// A Stations over a fixed list of [lat, lon, isHalt]; the Node service builds one of these.
export function stationsFrom(pts: [number, number, boolean][], km: (a: LatLon, b: LatLon) => number): Stations {
  return {
    nearest(ll, maxKm) {
      let best: LatLon | null = null
      let bestScore = Infinity
      for (const [a, b, halt] of pts) {
        const d = km(ll, [a, b])
        if (d >= maxKm) continue
        const score = d + 0.8 * (halt ? 1 : 0)
        if (score < bestScore) {
          best = [a, b]
          bestScore = score
        }
      }
      return best
    },
  }
}

// Port of train_route: rail path for a train leg. Named stops snap to their nearest station
// (within 5 km) because BRouter needs points within about a kilometre of a track; [lat, lon]
// hints (photos from the train) are routed as they are, and dropped if they will not route.
// Falls back to the via points themselves, with onRails false. Unlike the Python, the log
// line carries no coordinates.
export async function trainRoute(
  services: Pick<Services, 'rail'>, ll: LatLon[], named: boolean[], stations: Stations, log: (msg: string) => void = () => {},
): Promise<{ path: LatLon[]; onRails: boolean }> {
  const snapped = ll.map((p, i) => (named[i] ? stations.nearest(p, 5) ?? p : p))
  let path = await services.rail(snapped)
  if (path === null && ll.length > 2) {
    const keep = snapped.filter((_, i) => named[i])
    if (!keep.length) keep.push(snapped[0], snapped[snapped.length - 1])
    const same = (p: LatLon, q: LatLon) => p[0] === q[0] && p[1] === q[1]
    if (!same(keep[0], snapped[0])) keep.unshift(snapped[0])
    if (!same(keep[keep.length - 1], snapped[snapped.length - 1])) keep.push(snapped[snapped.length - 1])
    path = keep.length > 1 ? await services.rail(keep) : null
  }
  if (path === null) {
    log('  no rail line found for a train leg; drawing it as a smooth line')
    return { path: [...ll], onRails: false }
  }
  return { path: [ll[0], ...path, ll[ll.length - 1]], onRails: true }
}
