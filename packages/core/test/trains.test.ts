import { describe, expect, it } from 'vitest'
import { byTrain, routeNode, type HopContext } from '../src/trains.ts'
import { FakeServices, NO_STATIONS } from '../src/testing.ts'
import { stationsFrom, type Services, type Stations } from '../src/services.ts'
import { km } from '../src/geo.ts'
import type { LatLon } from '../src/types.ts'

// Invented coordinates on the equator, where 1 degree of longitude is ~111.2 km.
const land = (lon: number, t?: number) => routeNode('stop', 0, lon, { t, raw: [0, lon] })
const straightRail = { rail: async (pts: LatLon[]) => pts }

function ctx(overrides: Partial<Services> = {}, stations: Stations = NO_STATIONS, airports: LatLon[] = []): HopContext {
  return { services: FakeServices(overrides), stations, airports }
}

describe('byTrain', () => {
  it('detects a train by photo-to-photo speed on a rail route', async () => {
    // ~222 km in one hour: 222 km/h, inside the 140-330 window
    expect(await byTrain(land(0, 1000), land(2, 4600), ctx(straightRail))).toBe(true)
  })

  it('needs a rail route even when the speed fits', async () => {
    expect(await byTrain(land(0, 1000), land(2, 4600), ctx())).toBe(false) // rail: null
  })

  it('rejects speeds outside the train window without station evidence', async () => {
    // ~222 km in four hours: 55 km/h, a car manages that
    expect(await byTrain(land(0, 1000), land(2, 1000 + 4 * 3600), ctx(straightRail))).toBe(false)
  })

  it('detects a train from departure and arrival photos at stations', async () => {
    // No timestamps at all, so only the stations can make it a train.
    const stations = stationsFrom([[0, 0.001, false], [0, 2.001, false]], km) // ~110 m from each photo
    expect(await byTrain(land(0), land(2), ctx(straightRail, stations))).toBe(true)
    // One station too far (~1.1 km) is not enough.
    const far = stationsFrom([[0, 0.001, false], [0, 2.01, false]], km)
    expect(await byTrain(land(0), land(2), ctx(straightRail, far))).toBe(false)
  })

  it('excludes a hop near an airport', async () => {
    const airports: LatLon[] = [[0, 2.02]] // ~2 km from the arrival
    expect(await byTrain(land(0, 1000), land(2, 4600), ctx(straightRail, NO_STATIONS, airports))).toBe(false)
    const noted = routeNode('stop', 0, 2, { t: 4600, ref: { note: 'airport', at: [0, 2] } })
    expect(await byTrain(land(0, 1000), noted, ctx(straightRail))).toBe(false)
  })

  it('excludes a rail route longer than 1.6x the straight line plus 20 km', async () => {
    // Straight line ~222 km, so the limit is ~376 km. A detour via 3 degrees north adds ~450 km.
    const detour = { rail: async ([a, b]: LatLon[]) => [a, [3, 1] as LatLon, b] }
    expect(await byTrain(land(0, 1000), land(2, 4600), ctx(detour))).toBe(false)
  })

  it('keeps to 25-700 km, land to land', async () => {
    // ~11 km in a few minutes: too short
    expect(await byTrain(land(0, 1000), land(0.1, 1200), ctx(straightRail))).toBe(false)
    // ~778 km: too long
    expect(await byTrain(land(0, 1000), land(7, 1000 + 3 * 3600), ctx(straightRail))).toBe(false)
    const sea = routeNode('sea', 0, 2, { t: 4600, sea: true })
    expect(await byTrain(land(0, 1000), sea, ctx(straightRail))).toBe(false)
  })
})
