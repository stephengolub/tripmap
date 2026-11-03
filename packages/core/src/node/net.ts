// Node-only HTTP clients for Nominatim, Overpass, OSRM and BRouter. Ports of OSM._fetch,
// OSM._overpass, OSM.landmarks, OSM.stations, osrm, road_km and rail in
// src/tripmap/__init__.py, with the same endpoints, rounding, cache files and failure
// rules. Cache keys and file names are byte-identical to the Python ones, so the two
// versions share ~/.cache/tripmap.
//
// Logs say what failed and the status, never coordinates.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { km } from '../geo.ts'
import type { Log } from '../stops.ts'
import type { LatLon } from '../types.ts'
import { addOsrmPieces, type OsrmRouteResponse } from '../render/routes.ts'
import type { CachePaths } from './services.ts'

// ---------------------------------------------------------------- Python formatting

// Python's round(x, n): correctly rounded, exact ties to even. toFixed works on the exact
// binary value too, but sends ties away from zero, so fix those.
// The tie test reads the exact decimal expansion, because x * 10**n is itself inexact.
export function pyRound(x: number, n: number): number {
  const exact = Math.abs(x).toFixed(100)
  const dot = exact.indexOf('.')
  if (/^50*$/.test(exact.slice(dot + 1 + n))) {
    const kept = exact.slice(0, dot + 1 + n)
    if (Number(kept.replace('.', '').at(-1)) % 2 === 0) return Math.sign(x) * Number(kept)
  }
  return Number(x.toFixed(n))
}

// Python's str(float) for the magnitudes used here: shortest round-trip digits, like JS,
// but whole numbers keep ".0" and negative zero is "-0.0".
export function pyRepr(x: number): string {
  if (Object.is(x, -0)) return '-0.0'
  if (Number.isInteger(x)) return x.toFixed(1)
  return String(x)
}

// urllib.parse.quote: everything but letters, digits, "_.-~" and `safe` is %-encoded.
export function pyQuote(s: string, safe = '/'): string {
  const keep = /[A-Za-z0-9_.\-~]/
  let out = ''
  for (const byte of new TextEncoder().encode(s)) {
    const ch = String.fromCharCode(byte)
    out += byte < 128 && (keep.test(ch) || safe.includes(ch)) ? ch : '%' + byte.toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}

// urllib.parse.urlencode (quote_plus): spaces become "+".
export function pyUrlencode(params: [string, string | number][]): string {
  const q = (v: string) => pyQuote(v, ' ').replace(/ /g, '+')
  return params.map(([k, v]) => `${q(k)}=${q(String(v))}`).join('&')
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex')

// ---------------------------------------------------------------- HTTP

// A non-2xx answer, as urllib raises HTTPError for one. `body` is the response text.
export class HttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`HTTP ${status}`)
  }
}

const describe = (e: unknown) => (e instanceof HttpError ? e.message : e instanceof Error ? e.name : 'error')

export type NetOptions = {
  paths: CachePaths
  userAgent: string
  log?: Log
  sleep?: (ms: number) => Promise<void> // injectable so tests skip the polite pauses
  now?: () => number // ms clock for the Nominatim rate limit
}

export type Piece = ['drive' | 'ferry', LatLon[]]

type Element = { type?: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
const POI = [
  '[tourism~"^(attraction|viewpoint|museum|theme_park|zoo|gallery|aquarium)$"]',
  '[historic][historic!~"^(memorial|wayside_cross|wayside_shrine|boundary_stone|milestone|yes)$"]',
  '[natural~"^(beach|cliff|peak|bay|cave_entrance|waterfall|glacier|arch|volcano)$"]',
  '[leisure~"^(park|garden|nature_reserve)$"]',
  '[boundary=national_park]',
]
const STATION_FILTER = '[railway~"^(station|halt)$"][station!~"^(subway|light_rail|monorail|funicular|miniature)$"]'

export class Net {
  private readonly paths: CachePaths
  private readonly ua: string
  private readonly log: Log
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private cache: Record<string, unknown> | null = null // geocode.json, loaded on first use
  private last = 0

  constructor(o: NetOptions) {
    this.paths = o.paths
    this.ua = o.userAgent
    this.log = o.log ?? (() => {})
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.now = o.now ?? Date.now
  }

  private async get(url: string, timeoutS: number, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': this.ua, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(timeoutS * 1000),
    })
    if (!res.ok) throw new HttpError(res.status, (await res.text()).slice(0, 200))
    return res.json()
  }

  private geocache(): Record<string, unknown> {
    if (this.cache === null) {
      const p = this.paths.geocode
      this.cache = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>) : {}
    }
    return this.cache
  }

  private saveGeocache(): void {
    mkdirSync(dirname(this.paths.geocode), { recursive: true })
    writeFileSync(this.paths.geocode, JSON.stringify(this.geocache()))
  }

  // OSM._fetch: cached in geocode.json under url+data, >= 1.1 s between calls, three tries.
  // null on failure, and a failure is not cached.
  async nominatim(url: string): Promise<unknown> {
    const cache = this.geocache()
    if (url in cache) return cache[url]
    const wait = 1100 - (this.now() - this.last)
    if (wait > 0) await this.sleep(wait)
    let res: unknown
    for (let attempt = 0; ; attempt++) {
      try {
        res = await this.get(url, 60)
        break
      } catch (e) {
        if (attempt === 2) {
          this.log(`  lookup failed (${describe(e)}); continuing without it`)
          return null
        }
        await this.sleep(3000 * (attempt + 1))
      }
    }
    this.last = this.now()
    cache[url] = res
    this.saveGeocache()
    return res
  }

  // Nominatim search by town NAME only; no coordinates are sent.
  async searchTown(name: string, cc: string | null): Promise<{ lat: string; lon: string; addresstype?: string }[]> {
    const q = pyUrlencode([
      ['format', 'jsonv2'], ['q', name], ['countrycodes', (cc ?? '').toLowerCase()], ['limit', 8], ['accept-language', 'en'],
    ])
    const hits = await this.nominatim('https://nominatim.openstreetmap.org/search?' + q)
    return Array.isArray(hits) ? hits : []
  }

  // OSM._overpass: elements for a union body, cached under "overpass:<sha1>". Tries each
  // mirror in turn. An HTTP 200 carrying a `remark` and no elements (a server-side
  // timeout) is a failure, not an answer. Best effort: [] if every mirror fails.
  async overpass(body: string, what: string): Promise<Element[]> {
    const query = `[out:json][timeout:90];(${body});out tags center;`
    const key = 'overpass:' + sha1(query)
    const cache = this.geocache()
    let res = cache[key] as { elements?: Element[]; remark?: string } | undefined
    if (res) return res.elements ?? []
    for (const url of OVERPASS) {
      try {
        res = (await this.get(url, 100, {
          method: 'POST',
          body: 'data=' + pyQuote(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })) as { elements?: Element[]; remark?: string }
        if (res.remark && !res.elements?.length) throw new Error('remark')
        cache[key] = res
        this.saveGeocache()
        return res.elements ?? []
      } catch (e) {
        res = undefined
        this.log(`  ${what} lookup via ${new URL(url).host} failed: ${describe(e)}`)
      }
    }
    return []
  }

  // OSM.landmarks: one batched query (spots rounded to ~100 m, around:500), then the
  // best-scoring named element within 500 m of each spot. Nones if Overpass is down.
  async landmarks(spots: LatLon[]): Promise<(string | null)[]> {
    if (!spots.length) return []
    const r = spots.map(([a, b]): LatLon => [pyRound(a, 3), pyRound(b, 3)])
    const body = r.flatMap(([a, b]) => POI.map((f) => `nwr(around:500,${pyRepr(a)},${pyRepr(b)})[name]${f};`)).join('')
    const els = await this.overpass(body, 'landmark')
    return r.map((ll) => {
      let best: string | null = null
      let bestScore = 1e9
      for (const e of els) {
        const c = e.center ?? e
        if (c.lat === undefined || c.lon === undefined) continue
        const t = e.tags ?? {}
        const d = km(ll, [c.lat, c.lon])
        if (d > 0.5) continue
        const score = d - 0.4 * Number('wikidata' in t || 'wikipedia' in t) - 0.15 * Number(e.type !== 'node')
        if (score < bestScore) {
          best = t['name:en'] || t.name
          bestScore = score
        }
      }
      return best
    })
  }

  // OSM.stations: railway stations or halts within radiusKm of any spot (deduplicated,
  // sorted, rounded to ~100 m), as [lat, lon, isHalt]. Empty if Overpass is down.
  async stationPoints(spots: LatLon[], radiusKm = 3): Promise<[number, number, boolean][]> {
    const uniq = new Map<string, LatLon>()
    for (const [a, b] of spots) {
      const p: LatLon = [pyRound(a, 3), pyRound(b, 3)]
      uniq.set(`${p[0]},${p[1]}`, p)
    }
    const r = [...uniq.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1])
    if (!r.length) return []
    const radius = (radiusKm * 1000).toFixed(0)
    const body = r.map(([a, b]) => `node(around:${radius},${pyRepr(a)},${pyRepr(b)})${STATION_FILTER};`).join('')
    const els = await this.overpass(body, 'station')
    return els
      .filter((e) => e.lat !== undefined && e.lon !== undefined)
      .map((e) => [e.lat as number, e.lon as number, e.tags?.railway === 'halt'])
  }

  // osrm: [(mode, points)] along roads, 25 points per request. Only "Ok" answers are
  // cached (osrm/<sha1>.json). A failed stretch comes back as a straight "drive" piece.
  async route(coords: LatLon[]): Promise<Piece[]> {
    const r = coords.map(([a, b]): LatLon => [pyRound(a, 3), pyRound(b, 3)])
    const pieces: Piece[] = []
    for (let i = 0; i < r.length - 1; i += 24) {
      const chunk = r.slice(i, i + 25)
      const cs = chunk.map(([lat, lon]) => `${pyRepr(lon)},${pyRepr(lat)}`).join(';')
      const path = join(this.paths.osrm, sha1(cs) + '.json')
      let data: OsrmRouteResponse
      if (existsSync(path)) {
        data = JSON.parse(readFileSync(path, 'utf8'))
      } else {
        const url = `https://router.project-osrm.org/route/v1/driving/${cs}` +
          '?overview=false&steps=true&geometries=geojson&continue_straight=false'
        try {
          data = (await this.get(url, 90)) as typeof data
        } catch (e) {
          this.log(`  routing failed (${describe(e)}); drawing a straight line for that stretch`)
          data = { code: 'Error' }
        }
        if (data.code === 'Ok') write(path, data)
        await this.sleep(1000)
      }
      addOsrmPieces(pieces, chunk, data)
    }
    return pieces
  }

  // road_km: distance to the nearest road in km (OSRM nearest), or null if the lookup
  // fails. Cached as osrm/nearest_<lat>_<lon>.json, Ok answers only.
  async nearest(lat: number, lon: number): Promise<number | null> {
    const la = pyRound(lat, 3), lo = pyRound(lon, 3)
    const path = join(this.paths.osrm, `nearest_${pyRepr(la)}_${pyRepr(lo)}.json`)
    let data: { code?: string; waypoints?: { distance: number }[] }
    if (existsSync(path)) {
      data = JSON.parse(readFileSync(path, 'utf8'))
    } else {
      const url = `https://router.project-osrm.org/nearest/v1/driving/${pyRepr(lo)},${pyRepr(la)}?number=1`
      try {
        data = (await this.get(url, 30)) as typeof data
      } catch {
        return null
      }
      await this.sleep(1000)
      if (data.code === 'Ok') write(path, data)
    }
    if (data.code !== 'Ok' || !data.waypoints?.length) return null
    return data.waypoints[0].distance / 1000
  }

  // rail: path along railway lines through the points (BRouter, profile=rail), or null.
  // BRouter answers "no track found" as an HTTP error; that answer is cached like a
  // route. Any other error is not cached.
  async rail(coords: LatLon[]): Promise<LatLon[] | null> {
    const cs = coords.map(([lat, lon]) => `${lon.toFixed(4)},${lat.toFixed(4)}`).join('|')
    const path = join(this.paths.rail, sha1(cs) + '.json')
    let data: { features?: { geometry: { coordinates: number[][] } }[]; error?: string }
    if (existsSync(path)) {
      data = JSON.parse(readFileSync(path, 'utf8'))
    } else {
      const url = 'https://brouter.de/brouter?' +
        pyUrlencode([['lonlats', cs], ['profile', 'rail'], ['alternativeidx', 0], ['format', 'geojson']])
      try {
        data = (await this.get(url, 90)) as typeof data
      } catch (e) {
        if (!(e instanceof HttpError)) {
          this.log(`  rail routing failed (${describe(e)})`)
          return null
        }
        if (!e.body.includes('no track')) {
          this.log(`  rail routing failed (${e.status})`)
          return null
        }
        data = { error: e.body }
      }
      write(path, data)
      await this.sleep(1000)
    }
    const c = data.features?.[0]?.geometry?.coordinates
    return Array.isArray(c) ? c.map(([lo, la]): LatLon => [la, lo]) : null
  }
}

function write(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data))
}
