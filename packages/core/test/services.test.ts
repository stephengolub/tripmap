import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// A fake home so the test proves the defaults come from os.homedir(), not a fixed path.
const FAKE_HOME = '/tmp/tripmap-fake-home'
vi.mock('node:os', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:os')>()
  return { ...real, homedir: () => FAKE_HOME }
})

const { DEFAULT_USER_AGENT, cachePaths, createServices, defaultCacheDir } = await import('../src/node/services.ts')

describe('createServices defaults', () => {
  it('puts the cache under ~/.cache/tripmap with the Python sub-paths', () => {
    const root = join(FAKE_HOME, '.cache', 'tripmap')
    expect(defaultCacheDir()).toBe(root)
    const s = createServices()
    expect(s.paths).toEqual({
      root,
      geocode: join(root, 'geocode.json'),
      osrm: join(root, 'osrm'),
      rail: join(root, 'rail'),
      ne: join(root, 'ne'),
    })
    expect(s.userAgent).toBe('tripmap/1.0 (personal photo-album route maps)')
    expect(s.userAgent).toBe(DEFAULT_USER_AGENT)
  })

  it('honours an explicit cache dir and User-Agent', () => {
    const s = createServices({ cacheDir: '/tmp/x', userAgent: 'test/0' })
    expect(s.paths).toEqual(cachePaths('/tmp/x'))
    expect(s.paths.osrm).toBe(join('/tmp/x', 'osrm'))
    expect(s.userAgent).toBe('test/0')
  })
})

// ---------------------------------------------------------------- HTTP clients
// Every test stubs globalThis.fetch and uses a temp cache dir; nothing touches the network.
// Coordinates are invented.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach } from 'vitest'

const { Net, pyQuote, pyRepr, pyRound, pyUrlencode } = await import('../src/node/net.ts')
const { createHash } = await import('node:crypto')

type Reply = { status?: number; json?: unknown; text?: string } | Error
function stubFetch(...replies: Reply[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = replies.shift()
    if (!r) throw new Error('unexpected fetch')
    if (r instanceof Error) throw r
    const status = r.status ?? 200
    return new Response(r.text ?? JSON.stringify(r.json), { status })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}

let dir: string
const net = () => new Net({ paths: cachePaths(dir), userAgent: 'test/0', sleep: async () => {} })
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tripmap-net-')) })
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

describe('Python formatting helpers', () => {
  it('match round(), str(float) and urlencode', () => {
    expect(pyRound(0.0625, 3)).toBe(0.062)
    expect(pyRound(0.1875, 3)).toBe(0.188)
    expect(pyRound(2.675, 2)).toBe(2.67)
    expect(pyRound(1.0005, 3)).toBe(1)
    expect(pyRepr(-20)).toBe('-20.0')
    expect(pyRepr(pyRound(-0.0001, 3))).toBe('-0.0')
    expect(pyRepr(10.123)).toBe('10.123')
    expect(pyQuote('a b/(c)!')).toBe('a%20b/%28c%29%21')
    expect(pyUrlencode([['format', 'jsonv2'], ['q', 'Saint-Émile (Nord) ~x'], ['countrycodes', 'xx'], ['limit', 8], ['accept-language', 'en']]))
      .toBe('format=jsonv2&q=Saint-%C3%89mile+%28Nord%29+~x&countrycodes=xx&limit=8&accept-language=en')
  })
})

describe('Overpass', () => {
  const station = { type: 'node', lat: 10.121, lon: -20.001, tags: { railway: 'station', name: 'Synthetic' } }

  it('caches a successful answer under the Python key and reuses it without fetching', async () => {
    const { fn, calls } = stubFetch({ json: { elements: [station] } })
    const n = net()
    expect(await n.stationPoints([[10.12345, -20]])).toEqual([[10.121, -20.001, false]])
    expect(calls[0].url).toBe('https://overpass-api.de/api/interpreter')
    expect(calls[0].init?.method).toBe('POST')
    expect((calls[0].init?.headers as Record<string, string>)['User-Agent']).toBe('test/0')
    // Same key Python computes for this query (checked against src/tripmap/__init__.py).
    const cache = JSON.parse(readFileSync(cachePaths(dir).geocode, 'utf8'))
    expect(Object.keys(cache)).toEqual(['overpass:62ea0f0934e60c5b255df953793ebe4afdae89e8'])
    // A fresh client reads the cache from disk: no second fetch.
    expect(await net().stationPoints([[10.12345, -20]])).toEqual([[10.121, -20.001, false]])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('treats a 200 with a remark and no elements as a failure, tries the mirror, caches nothing', async () => {
    const { calls } = stubFetch(
      { json: { remark: 'runtime error: Query timed out', elements: [] } },
      { status: 502, text: 'bad gateway' },
    )
    expect(await net().stationPoints([[10.1, -20.1]])).toEqual([])
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['overpass-api.de', 'overpass.private.coffee'])
    expect(existsSync(cachePaths(dir).geocode)).toBe(false)
  })

  it('names landmarks from one batched query', async () => {
    const els = [
      { type: 'node', lat: 10.0001, lon: 20.0001, tags: { name: 'Plain' } },
      { type: 'way', center: { lat: 10.0002, lon: 20.0002 }, tags: { name: 'Famous', wikidata: 'Q1', 'name:en': 'Famous EN' } },
    ]
    const { calls } = stubFetch({ json: { elements: els } })
    expect(await net().landmarks([[10, 20], [11, 21]])).toEqual(['Famous EN', null])
    expect(calls).toHaveLength(1)
    expect(decodeURIComponent(String(calls[0].init?.body))).toContain('nwr(around:500,10.0,20.0)[name]')
  })
})

describe('Nominatim', () => {
  it('waits 1.1 s between calls and caches answers in geocode.json', async () => {
    const waits: number[] = []
    let t = 0
    const n = new Net({ paths: cachePaths(dir), userAgent: 'test/0', sleep: async (ms) => { waits.push(ms) }, now: () => t })
    const { fn } = stubFetch({ json: [{ lat: '1', lon: '2' }] }, { json: [] })
    t = 5000
    await n.searchTown('Alpha', 'XX')
    t = 5300
    await n.searchTown('Beta', null)
    expect(waits).toEqual([800])
    await n.searchTown('Alpha', 'XX')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(String(fn.mock.calls[0][0])).toBe(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&q=Alpha&countrycodes=xx&limit=8&accept-language=en')
  })

  it('gives up after three tries without caching', async () => {
    stubFetch(new Error('down'), new Error('down'), { status: 503, text: '' })
    expect(await net().searchTown('Gamma', null)).toEqual([])
    expect(existsSync(cachePaths(dir).geocode)).toBe(false)
  })
})

describe('OSRM', () => {
  it('routes, splits ferry steps, and caches Ok answers under sha1 of the coordinate string', async () => {
    const step = (mode: string, coordinates: number[][]) => ({ mode, geometry: { coordinates } })
    const { fn, calls } = stubFetch({
      json: { code: 'Ok', routes: [{ legs: [{ steps: [step('driving', [[2, 1], [2.1, 1.1]]), step('ferry', [[2.1, 1.1], [3, 2]])] }] }] },
    })
    const pieces = await net().route([[1.0005, -0.0001], [2.5, 3.0625]])
    expect(pieces).toEqual([['drive', [[1, 2], [1.1, 2.1]]], ['ferry', [[1.1, 2.1], [2, 3]]]])
    expect(calls[0].url).toContain('/route/v1/driving/-0.0,1.0;3.062,2.5?')
    expect(readdirSync(cachePaths(dir).osrm)).toEqual(['dfa700ad9bd8f8616487b5760de2c34142a3c7d1.json'])
    await net().route([[1.0005, -0.0001], [2.5, 3.0625]])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('falls back to a straight line on failure and caches nothing', async () => {
    stubFetch({ json: { code: 'NoRoute' } })
    expect(await net().route([[1, 2], [3, 4]])).toEqual([['drive', [[1, 2], [3, 4]]]])
    expect(existsSync(cachePaths(dir).osrm)).toBe(false)
  })

  it('reads nearest-road distance and caches it by rounded coordinates', async () => {
    stubFetch({ json: { code: 'Ok', waypoints: [{ distance: 1500 }] } })
    expect(await net().nearest(1.23456, -2)).toBe(1.5)
    expect(readdirSync(cachePaths(dir).osrm)).toEqual(['nearest_1.235_-2.0.json'])
    stubFetch(new Error('down'))
    expect(await net().nearest(5, 6)).toBeNull()
  })
})

describe('BRouter', () => {
  const hash = (cs: string) => createHash('sha1').update(cs).digest('hex') + '.json'
  const pts: [number, number][] = [[10, 20], [11, 21]]
  const cs = '20.0000,10.0000|21.0000,11.0000'

  it('returns the path as [lat, lon] and caches it', async () => {
    const { calls } = stubFetch({ json: { features: [{ geometry: { coordinates: [[20, 10, 5], [21, 11, 6]] } }] } })
    expect(await net().rail(pts)).toEqual([[10, 20], [11, 21]])
    expect(calls[0].url).toContain('profile=rail')
    expect(readdirSync(cachePaths(dir).rail)).toEqual([hash(cs)])
  })

  it('caches a "no track found" error as a real answer', async () => {
    const { fn } = stubFetch({ status: 400, text: 'operation failed: no track found at pass=0' })
    expect(await net().rail(pts)).toBeNull()
    expect(readdirSync(cachePaths(dir).rail)).toEqual([hash(cs)])
    expect(await net().rail(pts)).toBeNull()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not cache a 503 or a network error', async () => {
    const { fn } = stubFetch({ status: 503, text: 'Service Unavailable' }, new Error('reset'))
    expect(await net().rail(pts)).toBeNull()
    expect(await net().rail(pts)).toBeNull()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(existsSync(cachePaths(dir).rail)).toBe(false)
  })
})

// ---------------------------------------------------------------- createServices wiring

const { Geo } = await import('../src/node/geodata.ts')
const { stationsFrom, trainRoute } = await import('../src/services.ts')
const { km } = await import('../src/geo.ts')

describe('createServices wiring', () => {
  const svc = () => createServices({ cacheDir: dir, userAgent: 'test/0', net: { sleep: async () => {} } })

  it('townCentre keeps hits within 20 km, prefers a town, then the nearest', async () => {
    const { calls } = stubFetch({
      json: [
        { lat: '10.0100', lon: '20.0100', addresstype: 'hamlet' }, // nearest, but not a town
        { lat: '10.0500', lon: '20.0500', addresstype: 'town' },
        { lat: '12.0000', lon: '22.0000', addresstype: 'city' }, // far away: dropped
      ],
    })
    expect(await svc().townCentre('Testville', 'XX', [10, 20])).toEqual([10.05, 20.05])
    expect(calls[0].url).toContain('countrycodes=xx')
    expect(calls[0].url).not.toContain('lat=')
  })

  it('townCentre falls back to the rounded point when nothing is near', async () => {
    stubFetch({ json: [] })
    expect(await svc().townCentre('Nowhere', null, [10.12345, 20.98765])).toEqual([10.123, 20.988])
  })

  it('stations builds a Stations from the station query', async () => {
    stubFetch({ json: { elements: [{ lat: 10.001, lon: 20.001, tags: { railway: 'station' } }] } })
    const st = await svc().stations([[10, 20]], 5)
    expect(st.nearest([10, 20], 3)).toEqual([10.001, 20.001])
    expect(st.nearest([11, 21], 3)).toBeNull()
  })

  it('drivable is false on the straight-line fallback and true on a direct road', async () => {
    stubFetch(new Error('down'))
    expect(await svc().drivable([10, 20], [10.1, 20.1])).toBe(false)
    const road = [[20, 10], [20.05, 10.05], [20.1, 10.1]]
    stubFetch({ json: { code: 'Ok', routes: [{ legs: [{ steps: [{ mode: 'driving', geometry: { coordinates: road } }] }] }] } })
    expect(await svc().drivable([10, 20], [10.1, 20.1])).toBe(true)
  })

  it('drivable is false when the route is mostly ferry', async () => {
    const steps = [
      { mode: 'driving', geometry: { coordinates: [[20, 10], [20.01, 10]] } },
      { mode: 'ferry', geometry: { coordinates: [[20.01, 10], [20.1, 10]] } },
    ]
    stubFetch({ json: { code: 'Ok', routes: [{ legs: [{ steps }] }] } })
    expect(await svc().drivable([10, 20], [10, 20.1])).toBe(false)
  })

  it('roadKm and rail go through OSRM nearest and BRouter', async () => {
    stubFetch({ json: { code: 'Ok', waypoints: [{ distance: 2500 }] } })
    expect(await svc().roadKm(10, 20)).toBe(2.5)
    stubFetch({ status: 400, text: 'no track found' })
    expect(await svc().rail([[10, 20], [11, 21]])).toBeNull()
  })

  it('geodata calls use a supplied Geo, and say what to do when the cache is empty', async () => {
    const sq = [[20, 10], [21, 10], [21, 11], [20, 11], [20, 10]]
    const s = createServices({ cacheDir: dir, geo: new Geo([{ geometry: { type: 'Polygon', coordinates: [sq] } }]) })
    expect(s.classify(10.5, 20.5)).toEqual({ landmass: 0, atSea: false })
    expect(s.classifyStrict(12, 22)).toBeNull()
    expect(s.nearestLandmass(12, 22)).toBe(0)
    expect(s.coastKm(10.5, 20.5)).toBeCloseTo(0.5 * 111 * Math.cos((10.5 * Math.PI) / 180), 6)
    expect(() => svc().classify(10, 20)).toThrow(/loadGeodata/)
  })
})

describe('trainRoute', () => {
  const stations = stationsFrom([[10.002, 20.002, false], [11.002, 21.002, false]], km)

  it('snaps named stops to stations and keeps the leg ends', async () => {
    const rail = vi.fn(async (pts: [number, number][]) => pts)
    const r = await trainRoute({ rail }, [[10, 20], [11, 21]], [true, true], stations)
    expect(rail).toHaveBeenCalledWith([[10.002, 20.002], [11.002, 21.002]])
    expect(r).toEqual({ path: [[10, 20], [10.002, 20.002], [11.002, 21.002], [11, 21]], onRails: true })
  })

  it('drops unroutable photo hints, then falls back to a plain line', async () => {
    const rail = vi.fn(async (pts: [number, number][]) => (pts.length === 2 ? pts : null))
    const r = await trainRoute({ rail }, [[10, 20], [10.5, 20.5], [11, 21]], [true, false, true], stations)
    expect(rail).toHaveBeenCalledTimes(2)
    expect(r.onRails).toBe(true)
    const none = await trainRoute({ rail: async () => null }, [[10, 20], [11, 21]], [true, true], stations)
    expect(none).toEqual({ path: [[10, 20], [11, 21]], onRails: false })
  })
})
