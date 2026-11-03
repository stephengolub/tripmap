// Node-only: the real Services, backed by Nominatim, Overpass, OSRM, BRouter and
// Natural Earth. Port of OSM, Stations, Geo, drivable, road_km and rail in
// src/tripmap/__init__.py. The cache layout matches the Python version exactly, so the
// two share ~/.cache/tripmap.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { km } from '../geo.ts'
import { stationsFrom, type Services } from '../services.ts'
import type { Log } from '../stops.ts'
import type { LatLon } from '../types.ts'
import { Geo, NE_COUNTRIES, NE_LAND, loadGeo, readFeatures } from './geodata.ts'
import { Net, pyRound } from './net.ts'

export const DEFAULT_USER_AGENT = 'tripmap/1.0 (personal photo-album route maps)'

// Python's CACHE = Path.home() / ".cache" / "tripmap". Computed per call, not at import,
// so a changed HOME (tests, sandboxes) is honoured.
export function defaultCacheDir(): string {
  return join(homedir(), '.cache', 'tripmap')
}

export type CachePaths = {
  root: string
  geocode: string // Nominatim answers, one JSON object
  osrm: string // route and nearest answers, one file each
  rail: string // BRouter answers, including cached "no track" results
  ne: string // Natural Earth GeoJSON downloads
}

export function cachePaths(root: string): CachePaths {
  return {
    root,
    geocode: join(root, 'geocode.json'),
    osrm: join(root, 'osrm'),
    rail: join(root, 'rail'),
    ne: join(root, 'ne'),
  }
}

export type ServicesOptions = {
  cacheDir?: string
  userAgent?: string
  log?: Log
  geo?: Geo // a prebuilt Geo (tests); otherwise built from the cache's ne/ files
  net?: Partial<Pick<ConstructorParameters<typeof Net>[0], 'sleep' | 'now'>> // tests skip the pauses
}

// The Services plus the settings it resolved, so callers and tests can see them.
// loadGeodata downloads any missing Natural Earth file; the sync geodata calls need the
// files on disk, so call it once before a draft on a fresh cache.
export type NodeServices = Services & {
  readonly paths: CachePaths
  readonly userAgent: string
  readonly net: Net
  loadGeodata(): Promise<Geo>
}

// Python's (round(lat, 3), round(lon, 3)): the straight-line fallback osrm() returns.
const r3 = ([a, b]: LatLon): LatLon => [pyRound(a, 3), pyRound(b, 3)]
const pathKm = (pts: LatLon[]) => pts.slice(1).reduce((s, q, i) => s + km(pts[i], q), 0)

export function createServices(opts: ServicesOptions = {}): NodeServices {
  const paths = cachePaths(opts.cacheDir ?? defaultCacheDir())
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT
  const log = opts.log ?? (() => {})
  const net = new Net({ paths, userAgent, log, ...opts.net })
  let geo: Geo | null = opts.geo ?? null

  // The geodata calls are synchronous, so they can only read files already on disk.
  const g = (): Geo => {
    if (geo) return geo
    const land = NE_LAND.map((n) => join(paths.ne, `${n}.geojson`))
    const missing = land.filter((p) => !existsSync(p))
    if (missing.length) {
      throw new Error('createServices: Natural Earth land is not in the cache yet; await loadGeodata() first')
    }
    const countries = join(paths.ne, `${NE_COUNTRIES}.geojson`)
    geo = new Geo(land.flatMap(readFeatures), () => readFeatures(countries))
    return geo
  }

  return {
    paths,
    userAgent,
    net,
    async loadGeodata() {
      geo ??= await loadGeo(paths.ne, { userAgent, log })
      return geo
    },

    // OSM.town_centre: search the NAME, keep hits within 20 km of `near`, prefer a
    // city/town/village, then the closest. No usable hit: `near` rounded to 3 decimals.
    async townCentre(name, cc, near) {
      const hits = (await net.searchTown(name, cc))
        .map((h) => ({ ll: [Number(h.lat), Number(h.lon)] as LatLon, place: ['city', 'town', 'village'].includes(h.addresstype ?? '') }))
        .filter((h) => km(h.ll, near) < 20)
      if (!hits.length) return r3(near)
      let best = hits[0]
      let bestKey: [number, number] = [Number(!best.place), km(best.ll, near)]
      for (const h of hits.slice(1)) {
        const key: [number, number] = [Number(!h.place), km(h.ll, near)]
        if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
          best = h
          bestKey = key
        }
      }
      return [pyRound(best.ll[0], 4), pyRound(best.ll[1], 4)]
    },

    landmarks: (spots) => net.landmarks(spots),
    stations: async (spots, radiusKm) => stationsFrom(await net.stationPoints(spots, radiusKm), km),

    classify: (lat, lon) => g().classify(lat, lon),
    classifyStrict: (lat, lon) => g().classifyStrict(lat, lon),
    nearestLandmass: (lat, lon) => g().nearest(lat, lon),
    coastKm: (lat, lon) => g().coastKm(lat, lon),

    // drivable: false when routing failed (the straight-line fallback), when the road is a
    // huge detour, or when it is mostly ferry.
    async drivable(a, b) {
      const pieces = await net.route([a, b])
      if (pieces.length === 1) {
        const pts = pieces[0][1]
        const [ra, rb] = [r3(a), r3(b)]
        if (pts.length === 2 && pts[0][0] === ra[0] && pts[0][1] === ra[1] && pts[1][0] === rb[0] && pts[1][1] === rb[1]) {
          return false
        }
      }
      const total = pieces.reduce((s, [, p]) => s + pathKm(p), 0)
      const ferry = pieces.reduce((s, [m, p]) => s + (m === 'ferry' ? pathKm(p) : 0), 0)
      return total < 2.5 * km(a, b) + 20 && ferry < 0.4 * total
    },

    roadKm: (lat, lon) => net.nearest(lat, lon),
    // Python rail(): BRouter through the points as given. Callers snap named stops to a
    // station first (see trainRoute in @tripmap/core and by_train).
    rail: (points) => net.rail(points),
  }
}
