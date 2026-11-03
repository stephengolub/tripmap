import { describe, expect, it } from 'vitest'
import type { LatLon, Stop, Trip } from '../types/trip'
import { framingPoints, haversineKm, resolveVia, sortByDistance } from './geo'

const DUBLIN: LatLon = [53.3498, -6.2603]
const GALWAY: LatLon = [53.2707, -9.0568]

const trip: Pick<Trip, 'stops'> = {
  stops: [
    { name: 'Dublin', kind: 'major', at: DUBLIN },
    { name: 'Galway', kind: 'major', at: GALWAY },
  ],
}

describe('haversineKm', () => {
  it('puts Dublin to Galway at about 190 km', () => {
    const km = haversineKm(DUBLIN, GALWAY)
    expect(km).toBeGreaterThan(180)
    expect(km).toBeLessThan(200)
  })

  it('is symmetric and zero for the same point', () => {
    expect(haversineKm(GALWAY, DUBLIN)).toBeCloseTo(haversineKm(DUBLIN, GALWAY), 9)
    expect(haversineKm(DUBLIN, DUBLIN)).toBe(0)
  })
})

describe('resolveVia', () => {
  it('resolves a stop name to its position', () => {
    expect(resolveVia(trip, 'Galway')).toEqual(GALWAY)
  })

  it('returns a point unchanged', () => {
    expect(resolveVia(trip, [53.4, -7.5])).toEqual([53.4, -7.5])
  })

  it('resolves an unknown name to null', () => {
    expect(resolveVia(trip, 'Atlantis')).toBeNull()
  })
})

describe('sortByDistance', () => {
  const stops: Stop[] = [
    { name: 'Galway', kind: 'major', at: GALWAY },
    { name: 'Cliffs', kind: 'minor', at: [52.9715, -9.4309] },
    { name: 'Kildare', kind: 'minor', at: [53.1589, -6.9096] },
  ]

  it('puts the nearest first', () => {
    expect(sortByDistance(stops, DUBLIN).map((s) => s.name)).toEqual(['Kildare', 'Galway', 'Cliffs'])
  })

  it('keeps the original order without a starting point, and does not mutate', () => {
    const before = stops.map((s) => s.name)
    expect(sortByDistance(stops, null).map((s) => s.name)).toEqual(before)
    sortByDistance(stops, DUBLIN)
    expect(stops.map((s) => s.name)).toEqual(before)
  })
})

describe('framingPoints', () => {
  const dublin = { name: 'Dublin', kind: 'major', at: [53.35, -6.26] as LatLon }
  const galway = { name: 'Galway', kind: 'minor', at: [53.27, -9.06] as LatLon }
  const lhr = { name: 'LHR', kind: 'hidden', at: [51.47, -0.45] as LatLon }

  it('frames the visible stops and ignores hidden ones', () => {
    expect(framingPoints([dublin, lhr, galway])).toEqual([dublin.at, galway.at])
  })

  it('falls back to every stop when all of them are hidden', () => {
    expect(framingPoints([lhr])).toEqual([lhr.at])
  })

  it('returns nothing when there are no stops', () => {
    expect(framingPoints([])).toEqual([])
  })
})
