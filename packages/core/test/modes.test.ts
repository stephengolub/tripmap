import { describe, expect, it } from 'vitest'
import { classifyHop } from '../src/modes.ts'
import { routeNode, type HopContext } from '../src/trains.ts'
import { FakeServices, NO_STATIONS } from '../src/testing.ts'
import type { Services } from '../src/services.ts'

// Invented coordinates on the equator, where 1 degree of longitude is ~111.2 km.
const land = (lon: number, t?: number) => routeNode('stop', 0, lon, { t })
const sea = (lon: number) => routeNode('sea', 0, lon, { sea: true })

function ctx(overrides: Partial<Services> = {}): HopContext {
  return { services: FakeServices(overrides), stations: NO_STATIONS, airports: [] }
}

describe('classifyHop', () => {
  it('calls a hop over 900 km a flight', async () => {
    expect(await classifyHop(land(0), land(9), ctx())).toBe('flight') // ~1000 km
  })

  it('calls a fast hop over 200 km a flight', async () => {
    // ~334 km in one hour
    expect(await classifyHop(land(0, 1000), land(3, 4600), ctx())).toBe('flight')
  })

  it('calls a drivable 60 km land hop a drive', async () => {
    expect(await classifyHop(land(0), land(0.54), ctx({ drivable: async () => true }))).toBe('drive')
  })

  it('calls two sea nodes a boat', async () => {
    expect(await classifyHop(sea(0), sea(0.5), ctx())).toBe('boat')
  })

  it('calls a sea-to-land hop a boat only when both ends are coastal', async () => {
    expect(await classifyHop(sea(0), land(0.5), ctx({ coastKm: () => 1 }))).toBe('boat')
    expect(await classifyHop(sea(0), land(0.5), ctx({ coastKm: () => 50 }))).toBe('drive')
  })

  it('applies the not-drivable rule', async () => {
    const noRoad = { drivable: async () => false }
    expect(await classifyHop(land(0), land(1), ctx({ ...noRoad, coastKm: () => 1 }))).toBe('boat')
    expect(await classifyHop(land(0), land(4), ctx(noRoad))).toBe('flight') // ~445 km
    expect(await classifyHop(land(0), land(1), ctx(noRoad))).toBe('drive') // ~111 km, inland
  })

  it('calls a hop across two landmasses under 80 km a boat, and over 80 km a flight', async () => {
    const islands = { classifyStrict: (_lat: number, lon: number) => (lon < 0.2 ? 1 : 2) }
    expect(await classifyHop(land(0), land(0.5), ctx(islands))).toBe('boat') // ~56 km
    expect(await classifyHop(land(0), land(1), ctx(islands))).toBe('flight') // ~111 km
  })

  it('checks trains first', async () => {
    const c = ctx({ rail: async (pts) => pts })
    // ~222 km in one hour on land with a straight rail line: a train, not a flight
    expect(await classifyHop(land(0, 1000), land(2, 4600), c)).toBe('train')
  })
})
