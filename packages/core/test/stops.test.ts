import { describe, expect, it } from 'vitest'
import type { PlaceInfo } from '../src/places.ts'
import type { LatLon } from '../src/types.ts'
import {
  buildClusters, classifyPoints, markCoastalSea, mergeBases, nameBases, nightsFromPhotos, quickStops,
  type DraftStop, type PhotoPoint,
} from '../src/stops.ts'
import { FakeServices } from '../src/testing.ts'
import { buildStops } from '../src/draft-stops.ts'
import { km } from '../src/geo.ts'

// Invented coordinates, dates and names; nothing here comes from a real trip.
// Local time equals UTC throughout, so `local` is just the ISO form of `t`.

function shoot(at: LatLon, start: string, count: number, everyMin: number, place: PlaceInfo): PhotoPoint[] {
  const t0 = Date.parse(`${start}Z`) / 1000
  return Array.from({ length: count }, (_, i) => {
    const t = t0 + i * everyMin * 60
    return {
      t, local: new Date(t * 1000).toISOString().slice(0, 19),
      lat: at[0] + i * 1e-5, lon: at[1], place,
    }
  })
}

const ALPHA: LatLon = [40.0, 10.0]   // town A
const HOTEL: LatLon = [40.0, 10.13]  // lodging ~11 km east of A, still "in" A
const BETA: LatLon = [40.5, 10.8]    // town B
const LAKE: LatLon = [40.25, 10.3]
const CASTLE: LatLon = [40.2, 10.4]
const BRIEF: LatLon = [40.35, 10.6]
const AIRPORT: LatLon = [40.6, 10.9]

const inAlpha: PlaceInfo = { towns: { Alphaville: 5e7 }, localities: { Alphaville: 5e7 }, cc: 'XA' }
const inBeta: PlaceInfo = { towns: { Betaburg: 4e7 }, localities: { Betaburg: 4e7 }, cc: 'XA' }

// Three nights in two towns: two in Alphaville (one at the outlying hotel), one in Betaburg.
const PHOTOS: PhotoPoint[] = [
  ...shoot(ALPHA, '2030-06-01T10:00:00', 8, 10, inAlpha),
  ...shoot(HOTEL, '2030-06-01T20:00:00', 4, 20, inAlpha),
  ...shoot(HOTEL, '2030-06-02T08:00:00', 2, 10, inAlpha),
  ...shoot(LAKE, '2030-06-02T11:00:00', 10, 6, { poi: 'Lake Delta', localities: { Lakeside: 1e7 } }),
  ...shoot(ALPHA, '2030-06-02T19:00:00', 5, 10, inAlpha),
  ...shoot(ALPHA, '2030-06-03T09:30:00', 2, 10, inAlpha),
  ...shoot(CASTLE, '2030-06-03T11:00:00', 8, 4, { poi: 'Castle Gamma' }),
  ...shoot(BRIEF, '2030-06-03T13:00:00', 3, 5, { localities: { Zeta: 1e6, Bigshire: 1e9 } }),
  ...shoot(BETA, '2030-06-03T17:00:00', 6, 48, inBeta),
  ...shoot(BETA, '2030-06-04T08:00:00', 2, 10, inBeta),
  ...shoot(AIRPORT, '2030-06-04T10:00:00', 6, 8, { poi: 'Betaburg Airport' }),
]

const CENTRES: Record<string, LatLon> = { Alphaville: ALPHA, Betaburg: BETA }

async function pipeline(photos: PhotoPoint[]) {
  const looked: LatLon[][] = []
  const services = FakeServices({
    townCentre: async (name, _cc, near) => CENTRES[name] ?? near,
    landmarks: async (spots) => { looked.push(spots); return spots.map(() => null) },
  })
  const P = classifyPoints(photos, services)
  const clusters = buildClusters(P)
  await markCoastalSea(P, services)
  const n = nightsFromPhotos(P)
  const bases = await nameBases(n.bases, n.nights, P, services)
  const stops = await quickStops(clusters, bases, services)
  return { P, clusters, bases, nights: n.nights, stops, looked }
}

describe('stops pipeline on a synthetic three-night trip', () => {
  it('finds two overnight bases with the right nights', async () => {
    const { bases, nights } = await pipeline(PHOTOS)
    expect(bases.map((b) => [b.name, b.nights])).toEqual([['Alphaville', 2], ['Betaburg', 1]])
    expect(bases.map((b) => b.at)).toEqual([ALPHA, BETA])
    expect([...nights].map(([d, b]) => [d, b.name])).toEqual([
      ['2030-06-01', 'Alphaville'], ['2030-06-02', 'Alphaville'], ['2030-06-03', 'Betaburg'],
    ])
  })

  it('names quick stops and hides the airport and the brief stop', async () => {
    const { stops, looked } = await pipeline(PHOTOS)
    expect(stops.map((s) => [s.name, s.kind, s.note, s.photos, s.when])).toEqual([
      ['Lake Delta', 'minor', undefined, 10, 'Jun 2'],
      ['Castle Gamma', 'minor', undefined, 8, 'Jun 3'],
      ['Zeta', 'hidden', 'brief stop', 3, 'Jun 3'],
      ['Betaburg Airport', 'hidden', 'airport', 6, 'Jun 4'],
    ])
    // Only the stop with no Apple POI needs a landmark lookup.
    expect(looked.map((s) => s.length)).toEqual([1])
  })

  it('points every stop cluster at a stop or base', async () => {
    const { clusters } = await pipeline(PHOTOS)
    for (const c of clusters.filter((c) => c.stop)) expect(c.ref).toBeTruthy()
  })
})

describe('buildStops end to end', () => {
  it('finds one overnight stop per distinct overnight location', async () => {
    const services = FakeServices({ townCentre: async (name, _cc, near) => CENTRES[name] ?? near })
    const logs: string[] = []
    const r = await buildStops(PHOTOS, services, { log: (m) => logs.push(m) })
    // Distinct overnight towns in the fixture: the hotel spot counts as Alphaville.
    const spots = [ALPHA, BETA]
    expect(r.bases).toHaveLength(spots.length)
    for (const s of spots) expect(r.bases.filter((b) => km(b.at, s) < 1)).toHaveLength(1)
    expect(r.bases.reduce((n, b) => n + (b.nights ?? 0), 0)).toBe(3)
    expect(new Set(r.nights.values()).size).toBe(spots.length)
    expect(r.stops.map((s) => s.name)).toEqual(['Lake Delta', 'Castle Gamma', 'Zeta', 'Betaburg Airport'])
    expect(r.points).toHaveLength(PHOTOS.length)
    expect(r.dates).toEqual(['2030-06-01', '2030-06-02', '2030-06-03', '2030-06-04'])
    for (const c of r.clusters.filter((c) => c.stop)) expect(c.ref).toBeTruthy()
    // Logs carry counts only.
    for (const m of logs) expect(m).not.toMatch(/\d+\.\d{2,}/)
  })
})

describe('buildClusters', () => {
  const services = FakeServices()
  it('flags 8 minutes with 2 photos, or 5 photos, as a stop', () => {
    const P = classifyPoints([
      ...shoot([1, 1], '2030-01-01T10:00:00', 2, 8, {}),
      ...shoot([2, 2], '2030-01-01T12:00:00', 2, 7, {}),
      ...shoot([3, 3], '2030-01-01T14:00:00', 5, 0, {}),
    ], services)
    expect(buildClusters(P).map((c) => c.stop)).toEqual([true, false, true])
  })

  it('merges stops under 90 minutes and 2.5 km apart into the earlier one', () => {
    const P = classifyPoints([
      ...shoot([1, 1], '2030-01-01T10:00:00', 5, 1, {}),
      ...shoot([1.015, 1], '2030-01-01T11:00:00', 5, 1, {}), // ~1.7 km away
      ...shoot([1.1, 1], '2030-01-01T12:00:00', 5, 1, {}),   // ~11 km away
    ], services)
    const clusters = buildClusters(P)
    expect(clusters.map((c) => c.stop)).toEqual([true, false, true])
    expect(clusters[1].parent).toBe(clusters[0])
    expect(clusters[0].pts).toHaveLength(10)
    expect(P[7].cluster).toBe(clusters[0])
  })
})

describe('classifyPoints', () => {
  it('a shore photo between two sea photos is at sea; Apple water and on-land flags win', () => {
    const services = FakeServices({
      classify: (lat) => (lat === 0 ? { landmass: null, atSea: true } : { landmass: 1, atSea: false }),
      classifyStrict: (lat) => (lat === 2 ? 1 : null),
      nearestLandmass: () => 7,
    })
    const pt = (lat: number, place: PlaceInfo = {}): PhotoPoint => ({ t: lat, local: '2030-01-01T10:00:00', lat, lon: 0, place })
    const P = classifyPoints([pt(0), pt(1), pt(0), pt(2, { water: true }), pt(0, { onland: true })], services)
    expect(P.map((p) => [p.sea, p.land])).toEqual([[true, null], [true, null], [true, null], [true, null], [false, 7]])
  })
})

describe('markCoastalSea', () => {
  it('turns coastal photos far from a road into sea, with their neighbours', async () => {
    const services = FakeServices({ coastKm: () => 1, roadKm: async (lat) => (lat > 5 ? 4 : 0.1) })
    const P = classifyPoints([
      ...shoot([1, 1], '2030-01-01T10:00:00', 1, 0, {}),
      ...shoot([6, 1], '2030-01-01T11:00:00', 1, 0, {}),
      ...shoot([6.005, 1], '2030-01-01T11:05:00', 1, 0, {}),
    ], services)
    buildClusters(P)
    await markCoastalSea(P, services)
    expect(P.map((p) => p.sea)).toEqual([false, true, true])
  })
})

describe('nightsFromPhotos', () => {
  const services = FakeServices()
  const night = (ev: [LatLon, string], mo: [LatLon, string], sea = false) => {
    const P = classifyPoints([...shoot(ev[0], ev[1], 1, 0, {}), ...shoot(mo[0], mo[1], 1, 0, {})], services)
    if (sea) P[0].sea = P[1].sea = true
    return nightsFromPhotos(P)
  }
  const A: LatLon = [10, 10], B: LatLon = [10, 10.5] // ~55 km apart

  it('evening wins at 18:00', () => {
    expect(night([A, '2030-01-01T18:00:00'], [B, '2030-01-02T08:00:00']).bases[0].raw).toEqual(A)
  })
  it('a morning photo before 09:00 wins over an afternoon one', () => {
    expect(night([A, '2030-01-01T17:00:00'], [B, '2030-01-02T08:59:00']).bases[0].raw).toEqual(B)
  })
  it('then evening from 16:00, else morning', () => {
    expect(night([A, '2030-01-01T16:00:00'], [B, '2030-01-02T10:00:00']).bases[0].raw).toEqual(A)
    expect(night([A, '2030-01-01T15:00:00'], [B, '2030-01-02T10:00:00']).bases[0].raw).toEqual(B)
  })
  it('skips a night more than 150 km apart, or at sea', () => {
    expect(night([A, '2030-01-01T20:00:00'], [[12, 10], '2030-01-02T08:00:00']).bases).toEqual([])
    expect(night([A, '2030-01-01T20:00:00'], [A, '2030-01-02T08:00:00'], true).bases).toEqual([])
  })
})

describe('mergeBases', () => {
  it('folds a same-name base within 25 km and repoints its nights', () => {
    const a: DraftStop = { name: 'Town', kind: 'major', at: [0, 0], nights: 1 }
    const b: DraftStop = { name: 'Town', kind: 'major', at: [0, 0.1], nights: 2 }
    const c: DraftStop = { name: 'Town', kind: 'major', at: [0, 1], nights: 1 }
    const nights = new Map([['d1', a], ['d2', b], ['d3', c]])
    const merged = mergeBases([a, b, c], nights)
    expect(merged).toEqual([a, c])
    expect(a.nights).toBe(3)
    expect(nights.get('d2')).toBe(a)
  })
})
