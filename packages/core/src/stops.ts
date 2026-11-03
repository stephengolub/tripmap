// Clusters, quick stops and overnight bases. A port of build_trip in
// src/tripmap/__init__.py, from the land/sea pass up to (not including) the per-day node
// sequences and leg modes. Every outside lookup goes through Services. Browser-safe.

import { BASE_MERGE_KM, NEAR_BASE_KM, STATION_NAME, STOP_MIN_PHOTOS, STOP_MIN_SECONDS, STOP_RADIUS_KM } from './constants.ts'
import { km } from './geo.ts'
import type { PlaceInfo } from './places.ts'
import type { Services } from './services.ts'
import type { LatLon, Stop } from './types.ts'
import { townVote, vote } from './voting.ts'

/** One geotagged photo: UTC epoch seconds, the photo's local wall-clock time as a naive
 *  ISO string (YYYY-MM-DDTHH:MM:SS), its position and decoded Apple place names. */
export interface PhotoPoint {
  t: number
  local: string
  lat: number
  lon: number
  place: PlaceInfo
}

/** A photo after the land/sea pass, tied to the cluster it belongs to. */
export interface Point extends PhotoPoint {
  land: number | null
  sea: boolean
  shore: boolean
  cluster: Cluster | null
}

export interface Cluster {
  pts: Point[]
  t0: number
  t1: number
  lat: number
  lon: number
  sea: boolean
  stop: boolean
  parent?: Cluster
  landmark?: string | null
  // The stop or base this cluster stands for; null when it is a stop with no base near.
  ref?: DraftStop | null
}

/** A stop while drafting: the trip Stop plus, for bases, the raw overnight photo spot. */
export interface DraftStop extends Stop {
  raw?: LatLon
}

export type Log = (msg: string) => void
const quiet: Log = () => {}

const ll = (p: { lat: number; lon: number }): LatLon => [p.lat, p.lon]
const dateOf = (p: PhotoPoint) => p.local.slice(0, 10)
const hourOf = (p: PhotoPoint) => Number(p.local.slice(11, 13))
// Python's round(x, 4) for display coordinates.
const round4 = (x: number) => Math.round(x * 1e4) / 1e4

const AIRPORT_NAME = /\bairport\b|\bterminal\b|\baeroport|\baeropuerto|\bflughafen/iu
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Land, sea and shore for each photo. Apple's water/on-land flags beat the coastline,
 *  and a shore photo between two sea photos was taken from the water. */
export function classifyPoints(photos: readonly PhotoPoint[], services: Services): Point[] {
  const P: Point[] = photos.map((ph) => {
    const { landmass, atSea } = services.classify(ph.lat, ph.lon)
    const p: Point = {
      ...ph, land: landmass, sea: atSea,
      shore: !atSea && services.classifyStrict(ph.lat, ph.lon) === null, cluster: null,
    }
    if (p.place.water) {
      p.sea = true
      p.land = null
      p.shore = false
    } else if (p.place.onland) {
      if (p.sea) p.land = services.nearestLandmass(p.lat, p.lon)
      p.sea = false
      p.shore = false
    }
    return p
  })
  P.forEach((p, i) => {
    if (!p.shore) return
    let prev: Point | undefined
    for (let j = i - 1; j >= 0; j--) if (!P[j].shore) { prev = P[j]; break }
    const next = P.slice(i + 1).find((q) => !q.shore)
    if (prev && next && prev.sea && next.sea) {
      p.sea = true
      p.land = null
    }
  })
  return P
}

/** Runs of consecutive photos within STOP_RADIUS_KM of the running centre and 2 hours of
 *  each other, flagged as stops (8 minutes with 2 photos, or 5 photos), with stops less
 *  than 90 minutes and 2.5 km apart merged into the earlier one. */
export function buildClusters(P: Point[]): Cluster[] {
  const clusters: Cluster[] = []
  let cur: Cluster | null = null
  for (const p of P) {
    if (cur && !p.sea && !cur.sea && km(ll(cur), ll(p)) < STOP_RADIUS_KM && p.t - cur.t1 < 7200) {
      cur.pts.push(p)
      cur.t1 = p.t
      const n = cur.pts.length
      cur.lat += (p.lat - cur.lat) / n
      cur.lon += (p.lon - cur.lon) / n
    } else {
      cur = { pts: [p], t0: p.t, t1: p.t, lat: p.lat, lon: p.lon, sea: p.sea, stop: false }
      clusters.push(cur)
    }
    p.cluster = cur
  }
  for (const c of clusters) {
    c.stop = !c.sea && ((c.t1 - c.t0 >= STOP_MIN_SECONDS && c.pts.length >= 2) || c.pts.length >= STOP_MIN_PHOTOS)
  }
  let prev: Cluster | null = null
  for (const c of clusters) {
    if (!c.stop) continue
    if (prev && c.t0 - prev.t1 < 5400 && km(ll(prev), ll(c)) < 2.5) {
      c.stop = false
      c.parent = prev
      prev.t1 = c.t1
      prev.pts.push(...c.pts)
      for (const p of c.pts) p.cluster = prev
      continue
    }
    prev = c
  }
  return clusters
}

/** Coastal photos outside stops that sit more than 2 km from any road were taken from
 *  the water; so were the photos within 1.5 km and 30 minutes of one. */
export async function markCoastalSea(P: Point[], services: Services, log: Log = quiet): Promise<void> {
  const checks = P.filter((p) => !p.sea && !p.cluster!.stop && !p.place.water && services.coastKm(p.lat, p.lon) < 8)
  const sample: Point[] = []
  for (const p of checks) {
    if (!sample.length || km(ll(sample[sample.length - 1]), ll(p)) > 3) sample.push(p)
  }
  if (sample.length) log(`checking ${sample.length} coastal spots for roads...`)
  const offroad: Point[] = []
  for (const p of sample) {
    const r = await services.roadKm(p.lat, p.lon)
    if (r !== null && r > 2) offroad.push(p)
  }
  for (const p of checks) {
    if (offroad.some((o) => km(ll(o), ll(p)) < 1.5 && Math.abs(o.t - p.t) < 1800)) {
      p.sea = true
      p.land = null
    }
  }
}

export interface Nights {
  /** Local dates with photos, sorted. */
  dates: string[]
  byDay: Map<string, Point[]>
  /** Unnamed bases, one per overnight spot. */
  bases: DraftStop[]
  /** Local date to the base slept at the night after it. */
  nights: Map<string, DraftStop>
}

/** Where each night was spent, from the last photo of one day and the first of the next.
 *  Evening (or both photos within BASE_MERGE_KM) wins at 18:00 or later; otherwise a
 *  morning photo before 09:00; otherwise evening from 16:00, else morning. A night at sea
 *  or with more than 150 km between the two photos (a ship, a sleeper, a red-eye) is
 *  skipped. Spots within BASE_MERGE_KM of a base count as that base. */
export function nightsFromPhotos(P: readonly Point[]): Nights {
  const byDay = new Map<string, Point[]>()
  for (const p of P) {
    const d = dateOf(p)
    let day = byDay.get(d)
    if (!day) byDay.set(d, (day = []))
    day.push(p)
  }
  const dates = [...byDay.keys()].sort()
  const bases: DraftStop[] = []
  const nights = new Map<string, DraftStop>()
  for (let i = 0; i + 1 < dates.length; i++) {
    const d = dates[i]
    const evDay = byDay.get(d)!
    const ev = evDay[evDay.length - 1], mo = byDay.get(dates[i + 1])![0]
    const apart = km(ll(ev), ll(mo))
    let loc: Point
    if (apart < BASE_MERGE_KM || hourOf(ev) >= 18) loc = ev
    else if (hourOf(mo) < 9) loc = mo
    else loc = hourOf(ev) >= 16 ? ev : mo
    if (loc.sea || apart > 150) continue // slept aboard a ship/train, or travelled overnight
    let base = bases.find((b) => km(b.raw!, ll(loc)) < BASE_MERGE_KM)
    if (!base) {
      base = { name: '', kind: 'major', at: ll(loc), raw: ll(loc), nights: 0 }
      bases.push(base)
    }
    base.nights! += 1
    nights.set(d, base)
  }
  return { dates, byDay, bases, nights }
}

/** Name each base from Apple's town names (towns, then localities, then city) and pin it
 *  at the town centre; then fold bases with the same name within 25 km together. Returns
 *  the merged bases and repoints `nights` at the survivors. */
export async function nameBases(
  bases: DraftStop[], nights: Map<string, DraftStop>, P: readonly Point[], services: Services, log: Log = quiet,
): Promise<DraftStop[]> {
  log(`naming ${bases.length} overnight stops...`)
  for (const [i, b] of bases.entries()) {
    const near = P.filter((p) => km(b.raw!, ll(p)) < 3)
    b.name = townVote(near, false, 'towns') || townVote(near) || vote(near, 'city') || `Stop ${i + 1}`
    b.at = await services.townCentre(b.name, vote(near, 'cc'), b.raw!)
  }
  return mergeBases(bases, nights)
}

/** Two night spots in the same town (same name, centres within 25 km) become one base. */
export function mergeBases(bases: DraftStop[], nights: Map<string, DraftStop>): DraftStop[] {
  const merged: DraftStop[] = []
  for (const b of bases) {
    const same = merged.find((m) => m.name === b.name && km(m.at, b.at) < 25)
    if (same) {
      same.nights = (same.nights ?? 0) + (b.nights ?? 0)
      for (const [d, x] of nights) if (x === b) nights.set(d, same)
    } else {
      merged.push(b)
    }
  }
  return merged
}

/** The base within NEAR_BASE_KM of ll (by town centre or raw spot), if any. */
export function nearBase(bases: readonly DraftStop[], at: LatLon): DraftStop | null {
  return bases.find((b) => km(b.at, at) < NEAR_BASE_KM || (b.raw !== undefined && km(b.raw, at) < NEAR_BASE_KM)) ?? null
}

/** "May 5": month and day of the photo's own local date. */
function when(p: PhotoPoint): string {
  return `${MONTHS[Number(p.local.slice(5, 7)) - 1]} ${Number(p.local.slice(8, 10))}`
}

/** Quick stops: stop clusters not in a base's town, named by Apple POI vote, then a
 *  landmark lookup (only for clusters with no POI), then the smallest locality, then raw
 *  coordinates. A name repeated within 8 km folds into the earlier stop or base. Airport,
 *  station and brief stops (under 8 photos and 20 minutes) are hidden. Sets `ref` on
 *  every stop cluster. */
export async function quickStops(
  clusters: Cluster[], bases: readonly DraftStop[], services: Services, log: Log = quiet,
): Promise<DraftStop[]> {
  const stops: DraftStop[] = []
  const names = new Set(bases.map((b) => b.name))
  const todo = clusters.filter((c) => c.stop && !nearBase(bases, ll(c)))
  const need = todo.filter((c) => !vote(c.pts, 'poi'))
  if (need.length) {
    log(`looking up landmarks for ${need.length} of ${todo.length} quick stops...`)
    const found = await services.landmarks(need.map(ll))
    need.forEach((c, i) => { c.landmark = found[i] ?? null })
  }
  for (const c of todo) {
    const name = vote(c.pts, 'poi') || c.landmark || townVote(c.pts, true) || `${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}`
    const same = [...stops, ...bases].find((x) => x.name === name && km(x.at, ll(c)) < 8)
    if (same) {
      c.ref = same
      same.photos = (same.photos ?? 0) + c.pts.length
      continue
    }
    let unique = name
    for (let i = 2; names.has(unique); i++) unique = `${name} (${i})`
    names.add(unique)
    const airport = AIRPORT_NAME.test(name)
    const station = STATION_NAME.test(name)
    const brief = c.pts.length < 8 && c.t1 - c.t0 < 1200
    const x: DraftStop = {
      name: unique, kind: airport || station || brief ? 'hidden' : 'minor', at: [round4(c.lat), round4(c.lon)],
      photos: c.pts.length, when: when(c.pts[0]),
    }
    const note = airport ? 'airport' : station ? 'station' : brief ? 'brief stop' : undefined
    if (note) x.note = note
    stops.push(x)
    c.ref = x
  }
  for (const c of clusters) {
    if (c.stop && c.ref === undefined) c.ref = nearBase(bases, ll(c))
  }
  return stops
}
