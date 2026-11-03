import { describe, expect, it } from 'vitest'
import { pickBasemap } from '../src/basemap.ts'
import { Geo, type Feature } from '../src/geodata.ts'
import type { LatLon } from '../src/types.ts'

// Invented geometry only. Squares in [lon, lat].
const square = (x0: number, y0: number, s: number) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]]
const poly = (x0: number, y0: number, s: number): Feature => ({ geometry: { type: 'Polygon', coordinates: [square(x0, y0, s)] } })

describe('pickBasemap', () => {
  it('auto picks island for a small single landmass, keeping only land inside its box', () => {
    // A 3-degree island, an islet just off it, and a far-away continent.
    const geo = new Geo([poly(10, 10, 3), poly(13.02, 10.5, 0.05), poly(40, 0, 30)])
    const trip: LatLon[] = [[11, 11], [12, 12.5]]
    const r = pickBasemap(geo, 'auto', trip)
    expect(r.mode).toBe('island')
    expect(r.land).toHaveLength(2) // the island and the islet; the continent is outside
    expect(r.bbox[0]).toBeCloseTo(10 - 3 * 0.03, 9) // grown 3% around the island the trip touches
    expect(r.bbox[2]).toBeGreaterThan(13.07)
  })

  it('auto falls back to region when the countries dwarf the trip', () => {
    // One 50-degree landmass, which is also one huge country; the trip spans half a degree.
    const big = poly(0, 0, 50)
    const geo = new Geo([big], () => [big])
    const trip: LatLon[] = [[20, 20], [20.5, 20.5]]
    const r = pickBasemap(geo, 'auto', trip, 1.5)
    expect(r.mode).toBe('region')
    // The crop is centred on the trip with the requested aspect (after the cos(lat) squeeze).
    const [x0, y0, x1, y1] = r.bbox
    expect((x0 + x1) / 2).toBeCloseTo(20.25, 9)
    expect((y0 + y1) / 2).toBeCloseTo(20.25, 9)
    expect(((x1 - x0) * Math.cos((20.25 * Math.PI) / 180)) / (y1 - y0)).toBeCloseTo(1.5, 9)
    // The country is clipped to the crop.
    expect(r.land).toHaveLength(1)
    const g = r.land[0]
    if (g.type !== 'MultiPolygon') throw new Error('expected a MultiPolygon')
    for (const [x, y] of g.coordinates[0][0]) {
      expect(x).toBeGreaterThanOrEqual(x0 - 1e-9)
      expect(x).toBeLessThanOrEqual(x1 + 1e-9)
      expect(y).toBeGreaterThanOrEqual(y0 - 1e-9)
      expect(y).toBeLessThanOrEqual(y1 + 1e-9)
    }
  })

  it('auto keeps country when the country is close to the trip size', () => {
    const land = poly(0, 0, 50) // too big to be an island
    const countryA = poly(10, 10, 3), countryB = poly(13, 10, 3)
    const geo = new Geo([land], () => [countryA, countryB])
    const r = pickBasemap(geo, 'auto', [[11, 11], [11.5, 14]])
    expect(r.mode).toBe('country')
    expect(r.land).toHaveLength(2)
    expect(r.bbox).toEqual([10, 10, 16, 13])
  })

  it('region keeps no land when nothing overlaps the crop', () => {
    const geo = new Geo([poly(0, 0, 1)], () => [poly(0, 0, 1)])
    const r = pickBasemap(geo, 'region', [[40, 40], [41, 41]])
    expect(r.mode).toBe('region')
    expect(r.land).toEqual([])
  })
})
