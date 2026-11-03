import { XMLValidator } from 'fast-xml-parser'
import { describe, expect, it } from 'vitest'
import { Geo, type Feature } from '../src/geodata.ts'
import { PIN, buildSvg, landCut, routeLegs, seaRoute, type LegRoute } from '../src/render/index.ts'
import { FakeServices } from '../src/testing.ts'
import type { LatLon, Trip } from '../src/types.ts'

// Invented geometry only: a 4-degree square island in [lon, lat].
const square = (x0: number, y0: number, s: number) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]]
const island: Feature = { geometry: { type: 'Polygon', coordinates: [square(10, 10, 4)] } }
const geo = new Geo([island], () => [island])

const trip: Trip = {
  title: 'Synthetic',
  basemap: 'auto',
  stops: [
    { name: 'North', kind: 'major', at: [13.5, 11] },
    { name: 'South', kind: 'major', at: [10.5, 11] },
    { name: 'East', kind: 'major', at: [12, 13.5] },
    { name: 'Look & <See>', kind: 'minor', at: [12, 12], label: 'ne' },
    { name: 'Gone', kind: 'minor', at: [11, 13], label: 'auto' },
    { name: 'Field', kind: 'hidden', at: [9.5, 9.5] },
  ],
  legs: [
    { date: '2001-02-03', mode: 'flight', day_trip: false, via: ['Field', 'South'], enabled: true },
    { date: '2001-02-04', mode: 'drive', day_trip: false, via: ['South', [11.5, 11.2], 'North'], enabled: true },
    { date: '2001-02-05', mode: 'train', day_trip: false, via: ['North', 'East'], enabled: true },
    { date: '2001-02-06', mode: 'boat', day_trip: false, via: ['East', [11, 14.5], 'South'], enabled: true },
    { date: '2001-02-07', mode: 'drive', day_trip: true, via: ['South', 'Look & <See>', 'South'], enabled: true },
    { date: '2001-02-08', mode: 'drive', day_trip: false, via: ['East', 'Gone'], enabled: false },
  ],
}

const W = 800, H = 800
const group = (svg: string, marker: string) => {
  const start = svg.indexOf(marker)
  return svg.slice(start, svg.indexOf('</g>', start))
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

describe('buildSvg', () => {
  const { svg, mode } = buildSvg(trip, W, H, false, geo)

  it('is a well-formed SVG with no script', () => {
    expect(XMLValidator.validate(svg)).toBe(true)
    expect(svg).not.toMatch(/<script/i)
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="800" height="800"/)
    expect(mode).toBe('island')
  })

  it('draws one shadow path and one white path per enabled leg, plus cross-ties for the train', () => {
    // Drawn: flight, drive, train, boat. The day trip and the disabled leg are left out.
    const shadow = group(svg, 'filter="url(#shadow)"')
    const white = group(svg, 'stroke="#FFFFFF" stroke-width="3.0"') // the white route group: u = 0.2, lw = 3.0
    expect(count(shadow, /<path /g)).toBe(4)
    expect(count(white, /<path /g)).toBe(5)
    expect(count(white, /stroke-linecap="butt"/g)).toBe(1) // the ties
    expect(count(white, / Q/g)).toBe(1) // the flight arc
  })

  it('puts land first and labels last, with one red pin per major stop', () => {
    expect(count(svg, new RegExp(`<path d="[^"]*" fill="${PIN}"`, 'g'))).toBe(3)
    const land = svg.indexOf('fill-opacity="0.45"'), shadow = svg.indexOf('url(#shadow)"'), text = svg.indexOf('<text')
    expect(land).toBeGreaterThan(0)
    expect(shadow).toBeGreaterThan(land)
    expect(text).toBeGreaterThan(svg.lastIndexOf('<polygon'))
    expect(svg.slice(svg.lastIndexOf('</text>'))).toBe('</text>\n</g></svg>') // nothing drawn over labels
    // The minor stop only on the day trip is not drawn; the one only on a disabled leg is
    // on no drawn leg at all, so it keeps its star (as in the Python). Hidden stops never show.
    expect(svg).not.toContain('Look &amp;')
    expect(count(svg, /<polygon /g)).toBe(1)
    expect(svg).toContain('>Gone<')
    expect(svg).not.toContain('>FIELD<')
  })

  it('shows the day trip and its star in the with-day-trips version', () => {
    const full = buildSvg(trip, W, H, true, geo).svg
    expect(count(group(full, 'filter="url(#shadow)"'), /<path /g)).toBe(5)
    expect(count(full, /<polygon /g)).toBe(2)
    expect(full).toContain('Look &amp; &lt;See>') // labels escape markup
  })

  it('uses supplied routes: ferry pieces are dotted, rails are straight segments', () => {
    const routes: (LegRoute | undefined)[] = []
    routes[1] = { mode: 'drive', pieces: [['drive', [[10.5, 11], [11.5, 11.2]]], ['ferry', [[11.5, 11.2], [13.5, 11]]]] }
    routes[2] = { mode: 'train', path: [[13.5, 11], [13, 12], [12, 13.5]], onRails: true }
    const out = buildSvg(trip, W, H, false, geo, routes).svg
    const white = group(out, 'stroke="#FFFFFF" stroke-width="3.0"')
    expect(count(white, /stroke-dasharray="0.2 6.8"/g)).toBe(1) // ferry dots
    expect(() => buildSvg(trip, W, H, false, geo, [undefined, { mode: 'boat', path: [] }])).toThrow(/not drive/)
  })

  it('refuses a via that is not a stop name', () => {
    const bad: Trip = { ...trip, legs: [{ ...trip.legs[1], via: ['South', 'Nowhere'] }] }
    expect(() => buildSvg(bad, W, H, false, geo)).toThrow(/'Nowhere' is not a stop name/)
  })
})

describe('sea routes', () => {
  const a: LatLon = [12, 9], b: LatLon = [12, 15] // straight across the island, west to east

  it('landCut measures the land a straight line crosses', () => {
    const cut = landCut(geo, a, b)
    expect(cut).toBeCloseTo(4 * 111 * Math.cos((12 * Math.PI) / 180), 6)
    expect(landCut(geo, [9, 9], [9, 15])).toBe(0) // south of the island
  })

  it('seaRoute bends a crossing around the land', () => {
    const path = seaRoute(geo, a, b)
    expect(path.length).toBeGreaterThan(2)
    let cut = 0
    for (let i = 0; i + 1 < path.length; i++) cut += landCut(geo, path[i], path[i + 1])
    expect(cut).toBeLessThan(landCut(geo, a, b))
  })

  it('routeLegs routes each drawn leg through the services', async () => {
    const roads: LatLon[][] = []
    const services = {
      ...FakeServices(),
      road: async (coords: LatLon[]) => {
        roads.push(coords)
        return [['drive', coords] as ['drive', LatLon[]]]
      },
    }
    const routes = await routeLegs(trip, false, services, geo)
    expect(routes.map((r) => r?.mode)).toEqual(['flight', 'drive', 'train', 'boat', undefined, undefined])
    expect(roads).toHaveLength(1)
    expect(routes[2]).toMatchObject({ onRails: false }) // FakeServices has no rail
  })
})
