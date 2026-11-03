import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Geo, ensureNaturalEarth, naturalEarthUrl, readFeatures, type Feature } from '../src/node/geodata.ts'

// Invented geometry: a 1-degree square with a hole, a far-off islet, and two "countries".
const square = (x0: number, y0: number, s: number) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]]
const LAND: Feature[] = [
  { geometry: { type: 'Polygon', coordinates: [square(10, 0, 1), square(10.4, 0.4, 0.2)] } },
  { geometry: { type: 'MultiPolygon', coordinates: [[square(20, 0, 0.1)]] } },
]
const COUNTRIES: Feature[] = [
  { geometry: { type: 'Polygon', coordinates: [square(10, 0, 0.5)] } },
  { geometry: { type: 'Polygon', coordinates: [square(10, 0.5, 0.5)] } },
]
const kmPerDeg = (lat: number) => 111 * Math.cos((lat * Math.PI) / 180)

describe('Geo on a synthetic polygon', () => {
  const geo = new Geo(LAND, () => COUNTRIES)

  it('flattens MultiPolygons into landmass indices', () => {
    expect(geo.size).toBe(2)
    expect(geo.classifyStrict(0.05, 20.05)).toBe(1)
  })

  it('classifies inside, in a hole, near the coast, and out at sea', () => {
    expect(geo.classify(0.2, 10.2)).toEqual({ landmass: 0, atSea: false })
    expect(geo.classifyStrict(0.5, 10.5)).toBeNull() // the hole is not land
    // 0.003 deg (~0.33 km) off the east coast: within SEA_KM, still that landmass
    expect(geo.classify(0.5, 11.003)).toEqual({ landmass: 0, atSea: false })
    expect(geo.classifyStrict(0.5, 11.003)).toBeNull()
    expect(geo.classify(0.5, 11.1)).toEqual({ landmass: null, atSea: true })
  })

  it('measures coast distance the way shapely does (degrees x 111 cos lat)', () => {
    expect(geo.coastKm(0.5, 10.1)).toBeCloseTo(0.1 * kmPerDeg(0.5), 6) // inside, 0.1 deg from the west edge
    expect(geo.coastKm(0.5, 11.2)).toBeCloseTo(0.2 * kmPerDeg(0.5), 6) // outside
    expect(geo.coastKm(0.5, 10.5)).toBeCloseTo(0.5 * kmPerDeg(0.5), 6) // a hole's edge is not coast
  })

  it('finds the nearest landmass from anywhere', () => {
    expect(geo.nearest(0.5, 12)).toBe(0)
    expect(geo.nearest(0.05, 19)).toBe(1)
  })

  it('lists countries in first-seen order without repeats', () => {
    expect(geo.countriesAt([[0.7, 10.2], [0.2, 10.2], [0.8, 10.3], [5, 5]])).toEqual([1, 0])
  })
})

describe('ensureNaturalEarth', () => {
  let dir = ''
  afterEach(() => {
    vi.unstubAllGlobals()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('downloads a missing file once from the Python URL, with the User-Agent', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tripmap-ne-'))
    const fetch = vi.fn(async () => new Response(JSON.stringify({ features: LAND })))
    vi.stubGlobal('fetch', fetch)
    const path = await ensureNaturalEarth(join(dir, 'ne'), 'ne_10m_land', { userAgent: 'test/0' })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson')
    expect(url).toBe(naturalEarthUrl('ne_10m_land'))
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('test/0')
    expect(readFeatures(path)).toHaveLength(2)
    await ensureNaturalEarth(join(dir, 'ne'), 'ne_10m_land', { userAgent: 'test/0' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('leaves no file behind when the download fails', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tripmap-ne-'))
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 503 }))
    await expect(ensureNaturalEarth(join(dir, 'ne'), 'ne_10m_land', { userAgent: 'test/0' })).rejects.toThrow('HTTP 503')
    expect(existsSync(join(dir, 'ne', 'ne_10m_land.geojson'))).toBe(false)
  })
})

// Real Natural Earth land from the shared cache, when a previous run downloaded it.
const REAL_LAND = join(homedir(), '.cache', 'tripmap', 'ne', 'ne_10m_land.geojson')
const haveReal = existsSync(REAL_LAND)
if (!haveReal) console.warn(`skipping real Natural Earth check: ${REAL_LAND} is not cached yet`)

describe.skipIf(!haveReal)('Geo on the cached ne_10m_land', () => {
  // 200 km due west of the check point is still inside Ireland (the Python agrees), so the
  // at-sea point is 400 km west, out in the Atlantic.
  it('puts an invented check point near Dublin on land and a point far west of it at sea', () => {
    const geo = new Geo(JSON.parse(readFileSync(REAL_LAND, 'utf8')).features)
    const land = geo.classify(53.35, -6.26)
    expect(land.atSea).toBe(false)
    expect(land.landmass).not.toBeNull()
    expect(geo.classify(53.35, -6.26 - 200 / kmPerDeg(53.35))).toEqual(land) // same island
    const westLon = -6.26 - 400 / kmPerDeg(53.35)
    expect(geo.classify(53.35, westLon)).toEqual({ landmass: null, atSea: true })
    expect(geo.coastKm(53.35, westLon)).toBeGreaterThan(50)
  })
})
