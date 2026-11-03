import { describe, expect, it } from 'vitest'
import { buildStops } from '../src/draft-stops.ts'
import {
  buildLegs, daySequence, hideLayoverStops, markLayovers, mergeHops, spreadTrains, tidySequence, type DraftLeg,
} from '../src/legs.ts'
import type { PlaceInfo } from '../src/places.ts'
import type { PhotoPoint, Point } from '../src/stops.ts'
import { FakeServices, NO_STATIONS } from '../src/testing.ts'
import { routeNode, type HopContext } from '../src/trains.ts'
import type { LatLon, Mode } from '../src/types.ts'

// Invented coordinates, dates and names; nothing here comes from a real trip.
// Local time equals UTC, so `local` is the ISO form of `t`. 0.01 deg of latitude ~1.1 km.

function shoot(at: LatLon, start: string, count: number, everyMin: number, place: PlaceInfo): PhotoPoint[] {
  const t0 = Date.parse(`${start}Z`) / 1000
  return Array.from({ length: count }, (_, i) => {
    const t = t0 + i * everyMin * 60
    return { t, local: new Date(t * 1000).toISOString().slice(0, 19), lat: at[0] + i * 1e-5, lon: at[1], place }
  })
}

const OMEGA: LatLon = [39.45, 10.0]  // ~61 km south of A: where the trip starts
const ALPHA: LatLon = [40.0, 10.0]   // the overnight town
const WAY_OUT: LatLon = [40.135, 10.0]  // ~15 km out, a photo from the car
const LAKE: LatLon = [40.27, 10.0]   // ~30 km out
const WAY_BACK: LatLon = [40.135, 10.06]
const BETA: LatLon = [40.9, 10.0]    // ~100 km north: where the trip ends

const inAlpha: PlaceInfo = { towns: { Alphaville: 5e7 }, localities: { Alphaville: 5e7 }, cc: 'XA' }

// Day 1 drives in to Alphaville; day 2 is a loop to a lake and back; day 3 drives on.
const PHOTOS: PhotoPoint[] = [
  ...shoot(OMEGA, '2030-06-01T10:00:00', 6, 5, { poi: 'Omega Fort' }),
  ...shoot(ALPHA, '2030-06-01T18:00:00', 5, 20, inAlpha),
  ...shoot(ALPHA, '2030-06-02T08:00:00', 2, 10, inAlpha),
  ...shoot(WAY_OUT, '2030-06-02T10:00:00', 1, 1, {}),
  ...shoot(LAKE, '2030-06-02T11:00:00', 10, 6, { poi: 'Lake Delta' }),
  ...shoot(WAY_BACK, '2030-06-02T15:00:00', 1, 1, {}),
  ...shoot(ALPHA, '2030-06-02T19:00:00', 5, 10, inAlpha),
  ...shoot(ALPHA, '2030-06-03T08:00:00', 2, 10, inAlpha),
  ...shoot(BETA, '2030-06-03T13:00:00', 6, 5, { poi: 'Beta Square' }),
]

function ctx(): HopContext {
  return { services: FakeServices(), stations: NO_STATIONS, airports: [] }
}

async function draftLegs(photos: PhotoPoint[]) {
  const services = FakeServices({ townCentre: async (name, _cc, near) => (name === 'Alphaville' ? ALPHA : near) })
  const s = await buildStops(photos, services)
  return { s, legs: await buildLegs(s, ctx()) }
}

const names = (via: { ref: { name?: string } | null; kind: string }[]) => via.map((n) => n.ref?.name ?? n.kind)

describe('buildLegs on a synthetic three-day trip', () => {
  it('makes one leg per day, flags the loop day as a day trip, and merges its drive hops', async () => {
    const { s, legs } = await draftLegs(PHOTOS)
    expect(s.bases.map((b) => [b.name, b.nights])).toEqual([['Alphaville', 2]])
    expect(legs.map((l) => [l.date, l.mode, l.day_trip])).toEqual([
      ['2030-06-01', 'drive', false],
      ['2030-06-02', 'drive', true],
      ['2030-06-03', 'drive', false],
    ])
    // Alphaville -> way -> Lake Delta -> way -> Alphaville: four drive hops, one leg.
    expect(names(legs[1].via)).toEqual(['Alphaville', 'way', 'Lake Delta', 'way', 'Alphaville'])
    expect(names(legs[0].via)).toEqual(['Omega Fort', 'Alphaville'])
    expect(names(legs[2].via)).toEqual(['Alphaville', 'Beta Square'])
  })

  it('is not a day trip when the loop stays within 15 km of the base', async () => {
    const near: LatLon = [40.1, 10.0] // ~11 km out
    const loop = [WAY_OUT, LAKE, WAY_BACK]
    const photos = PHOTOS.filter((p) => !loop.some((at) => p.lon === at[1] && Math.abs(p.lat - at[0]) < 0.01))
      .concat(shoot(near, '2030-06-02T11:00:00', 10, 6, { poi: 'Pond Epsilon' }))
      .sort((a, b) => a.t - b.t)
    const { legs } = await draftLegs(photos)
    const day2 = legs.filter((l) => l.date === '2030-06-02')
    expect(day2.map((l) => l.mode)).toEqual(['drive'])
    expect(day2[0].day_trip).toBe(false)
  })
})

// Points straight from the land/sea pass, for daySequence.
function pt(at: LatLon, t: number, sea = false): Point {
  return { t, local: '2030-06-01T12:00:00', lat: at[0], lon: at[1], place: {}, land: sea ? null : 0, sea, shore: false, cluster: null }
}

describe('daySequence', () => {
  it('keeps way hints only every WAYPOINT_KM and merges sea photos within 1.5 km', () => {
    const day = [
      pt([40.0, 10.0], 1), pt([40.05, 10.0], 2), // ~5.5 km apart: the second is dropped
      pt([40.2, 10.0], 3),                       // ~22 km on, and next to the water: a shore hint
      pt([40.3, 10.0], 4, true), pt([40.305, 10.0], 5, true), // sea, ~0.55 km apart: merged
    ]
    expect(daySequence(day, null, null, null).map((n) => n.kind)).toEqual(['way', 'shore', 'sea'])
  })

  it('starts from where the previous day ended when there was no base that night', () => {
    const carry = routeNode('sea', 41, 11, { t: 9, sea: true })
    const seq = daySequence([pt([41.5, 11], 10)], null, null, carry)
    expect(seq[0]).toMatchObject({ kind: 'sea', lat: 41, lon: 11, t: 9, t0: 9, sea: true, raw: null })
  })
})

describe('tidySequence', () => {
  const way = (lat: number) => routeNode('way', lat, 10)
  const stop = (lat: number) => routeNode('stop', lat, 10, { ref: { name: `S${lat}`, at: [lat, 10] } })

  it('drops dangling way hints at the first and last day, and way hints hugging the next node', () => {
    const seq = [way(39), stop(40), way(40.5), way(40.98), stop(41), way(42)]
    expect(tidySequence(seq, true, true).map((n) => `${n.kind}${n.lat}`)).toEqual(['stop40', 'way40.5', 'stop41'])
    expect(tidySequence(seq, false, false).map((n) => n.kind)).toEqual(['way', 'stop', 'way', 'stop', 'way'])
  })
})

describe('spreadTrains and mergeHops', () => {
  const seq = ['stop', 'way', 'way', 'stop', 'stop'].map((k, i) => routeNode(k as 'stop' | 'way', 40 + i, 10))

  it('turns drive hops beside a train across way hints into train, then merges them', () => {
    const modes = spreadTrains(seq, ['drive', 'train', 'drive', 'drive'] as Mode[])
    // hop 3 stays a drive: the node before it is a stop, not a way hint
    expect(modes).toEqual(['train', 'train', 'train', 'drive'])
    const legs = mergeHops('2030-06-01', seq, modes)
    expect(legs.map((l) => [l.mode, l.via.length])).toEqual([['train', 4], ['drive', 2]])
  })

  it('leaves a drive beside a boat alone', () => {
    expect(spreadTrains(seq, ['drive', 'boat', 'drive', 'drive'] as Mode[])).toEqual(['drive', 'boat', 'drive', 'drive'])
  })
})

describe('flights at the ends', () => {
  it('switches off a flight on day one and hides the airport stop only it uses', async () => {
    const ZETA: LatLon = [31.0, 10.0] // ~1000 km south of Alphaville: a flight by distance
    const photos = PHOTOS.filter((p) => Math.abs(p.lat - OMEGA[0]) > 0.01)
      .concat(shoot(ZETA, '2030-06-01T08:00:00', 6, 5, { poi: 'Zeta Airport' }))
      .sort((a, b) => a.t - b.t)
    const { s, legs } = await draftLegs(photos)
    expect(legs.map((l) => [l.date, l.mode])).toEqual([
      ['2030-06-01', 'flight'], ['2030-06-02', 'drive'], ['2030-06-03', 'drive'],
    ])
    markLayovers(legs)
    expect(legs.map((l) => l.enabled)).toEqual([false, true, true])
    const used = hideLayoverStops(legs)
    const zeta = s.stops.find((x) => x.name === 'Zeta Airport')!
    expect(used.has(zeta)).toBe(true)
    expect(zeta).toMatchObject({ kind: 'hidden', note: 'layover' })
    // Alphaville is on the flight too, but also on enabled legs, so it stays a base.
    expect(s.bases[0].kind).toBe('major')
    expect(s.bases[0].note).toBeUndefined()
  })

  const legsOf = (modes: Mode[]): DraftLeg[] =>
    modes.map((mode, i) => ({ date: '2030-06-01', mode, via: [routeNode('way', 40 + i, 10), routeNode('way', 41 + i, 10)], day_trip: false, enabled: true }))
  const off = (modes: Mode[]) => markLayovers(legsOf(modes)).map((l) => l.enabled)

  it('takes the short drives beside the end flights with them', () => {
    expect(off(['drive', 'flight', 'drive', 'drive', 'flight', 'drive'])).toEqual([false, false, true, true, false, false])
  })

  it('leaves flights alone when they are not at the ends', () => {
    expect(off(['drive', 'drive', 'flight', 'drive', 'drive', 'drive'])).toEqual([true, true, true, true, true, true])
    expect(off(['boat', 'flight', 'boat', 'drive'])).toEqual([true, true, true, true])
    // two drives after the last flight still count as getting home from the airport
    expect(off(['boat', 'flight', 'drive', 'drive'])).toEqual([true, false, false, false])
  })

  it('does not switch off the whole trip when it is one flight', () => {
    expect(off(['flight'])).toEqual([false])
    expect(off(['flight', 'drive', 'flight'])).toEqual([false, true, false])
  })
})
