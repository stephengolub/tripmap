import { describe, expect, it } from 'vitest'
import { countriesAlong, densify, pickBasemap } from '../src/basemap.ts'
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

describe('connecting countries and the route frame', () => {
  // Invented boxes in [lon, lat]. The route runs along lat 11 from lon 10 to lon 20.
  const route: LatLon[] = [[11, 10], [11, 20]]
  // Bottom edge 0.6 deg (~67 km) north of the route: inside the 100 km corridor.
  const offshore = poly(14, 11.6, 1)
  const far = poly(14, 30, 1) // more than 1000 km away

  it('counts a country the route passes near, even with no trip point inside it', () => {
    const geo = new Geo([poly(0, 0, 90)], () => [offshore, far])
    expect(countriesAlong(geo.countryPolygons, densify(route))).toEqual([0])
  })

  it('draws the corridor country in the country basemap, next to the visited one', () => {
    // Country A holds the trip point; country B is only beside the route (no trip point in it).
    const a = poly(10, 9, 2)
    const b = poly(14, 11.6, 1) // beside the route, no trip point inside
    const far2 = poly(60, 60, 1)
    const geo = new Geo([poly(0, 0, 90)], () => [a, b, far2])
    const r = pickBasemap(geo, 'country', [[10.5, 10.5], [13.5, 11.5]], 1.0, { routes: [route] })
    expect(r.mode).toBe('country')
    expect(r.land).toHaveLength(2) // A and B; the far country is not drawn
  })

  it('the route frame is tight: about 1.2 times the route span, in region mode, whatever was asked', () => {
    const geo = new Geo([poly(0, 0, 90)], () => [poly(0, 0, 90)])
    const trip: LatLon[] = [[10, 10], [11, 12]]
    for (const requested of ['island', 'country', 'auto'] as const) {
      const r = pickBasemap(geo, requested, trip, 1.0, { frame: 'route' })
      expect(r.mode).toBe('region')
      expect(r.bbox[2] - r.bbox[0]).toBeCloseTo(2 * 1.2, 1) // route span is 2 deg of longitude
    }
  })

  it('the default frame is unchanged for region', () => {
    const geo = new Geo([poly(0, 0, 90)], () => [poly(0, 0, 90)])
    const r = pickBasemap(geo, 'region', [[10, 10], [11, 12]], 1.0)
    expect(r.bbox[2] - r.bbox[0]).toBeCloseTo(2 * 1.7, 1) // 0.85 half-size, so 1.7 times the span
  })

  it('densify keeps the endpoints and never leaves a gap longer than the step', () => {
    const line: LatLon[] = [[0, 0], [0, 5]] // about 555 km along the equator
    const pts = densify(line, 20)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[pts.length - 1]).toEqual([0, 5])
    for (let i = 1; i < pts.length; i++) {
      const dLon = Math.abs(pts[i][1] - pts[i - 1][1])
      expect(dLon * 111.19).toBeLessThanOrEqual(20.5)
    }
  })
})
