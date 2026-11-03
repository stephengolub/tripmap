import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RenderContext } from '../render/context'
import type { Trip } from '../types/trip'

// rasterizeSvgInBrowser needs a real canvas; jsdom has none, so it is stubbed and the
// SVG it was handed is kept for the assertions.
const raster = vi.hoisted(() => ({ svgs: [] as string[] }))
vi.mock('@tripmap/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@tripmap/core')>()
  return {
    ...real,
    rasterizeSvgInBrowser: vi.fn(async (svg: string, w: number, h: number) => {
      raster.svgs.push(svg)
      return new Blob([`${w}x${h}`], { type: 'image/png' })
    }),
  }
})

const {
  ApiError,
  draftTrip,
  exportYaml,
  getPhotosStatus,
  importYaml,
  renderTrip,
  suggestMode,
} = await import('./client')

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockFetch(res: Response) {
  const fn = vi.fn().mockResolvedValue(res)
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
  raster.svgs.length = 0
})

// The client module as built in `mode`: MODE is read once at import.
async function clientIn(mode: 'local' | 'hosted') {
  vi.stubEnv('VITE_MODE', mode)
  vi.resetModules()
  return await import('./client')
}

describe('getPhotosStatus', () => {
  it('parses the ok shape', async () => {
    const fetchMock = mockFetch(jsonResponse({ ok: true, library: '/lib', geotagged_assets: 42 }))
    const status = await getPhotosStatus()
    expect(fetchMock).toHaveBeenCalledWith('/api/photos/status', undefined)
    expect(status.ok).toBe(true)
    expect(status.geotagged_assets).toBe(42)
  })

  it('parses the not-ok shape', async () => {
    mockFetch(
      jsonResponse({
        ok: false,
        library: '/lib',
        reason: 'permission_denied',
        message: 'Grant Full Disk Access.',
      }),
    )
    const status = await getPhotosStatus()
    expect(status.ok).toBe(false)
    expect(status.reason).toBe('permission_denied')
    expect(status.message).toBe('Grant Full Disk Access.')
  })

  it('throws ApiError on a non-2xx response', async () => {
    mockFetch(jsonResponse({ detail: 'boom' }, 500))
    await expect(getPhotosStatus()).rejects.toMatchObject({ status: 500, message: 'boom' })
  })
})

describe('draftTrip', () => {
  it('posts the correct JSON body', async () => {
    const fetchMock = mockFetch(jsonResponse({ trip: { stops: [], legs: [] }, stats: {} }))
    await draftTrip('2026-05-01', '2026-05-04', 'Sample trip')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/detect')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({
      from: '2026-05-01',
      to: '2026-05-04',
      title: 'Sample trip',
    })
  })

  it('leaves title out when not given', async () => {
    const fetchMock = mockFetch(jsonResponse({ trip: {}, stats: {} }))
    await draftTrip('2026-05-01', '2026-05-04')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      from: '2026-05-01',
      to: '2026-05-04',
    })
  })

  it('uses the string detail of an error response', async () => {
    mockFetch(jsonResponse({ detail: 'Too few photos in that range' }, 404))
    const err = await draftTrip('2026-05-01', '2026-05-04').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(404)
    expect(err.message).toBe('Too few photos in that range')
  })

  it('joins validation messages from a 422 list detail', async () => {
    mockFetch(jsonResponse({ detail: [{ msg: 'Value error, end is before start' }] }, 422))
    await expect(draftTrip('2026-05-04', '2026-05-01')).rejects.toMatchObject({
      status: 422,
      message: 'end is before start',
    })
  })

  it('turns a network failure into ApiError status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(draftTrip('2026-05-01', '2026-05-04')).rejects.toMatchObject({ status: 0 })
  })
})

describe('importYaml', () => {
  it('parses YAML in the browser without calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { trip } = await importYaml(
      'title: Synthetic\nstops:\n  - {name: A, at: [10.0, 20.0], kind: major}\n  - {name: B, at: [10.5, 20.5], kind: major}\nlegs:\n  - {date: 2030-01-02, mode: drive, via: [A, B]}\n',
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(trip.title).toBe('Synthetic')
    expect(trip.stops.map((s) => s.name)).toEqual(['A', 'B'])
    expect(trip.legs[0]).toMatchObject({ mode: 'drive', via: ['A', 'B'], enabled: true })
  })

  it('turns a bad file into ApiError 422', async () => {
    await expect(importYaml('stops: [')).rejects.toMatchObject({ status: 422 })
  })
})

const trip = {
  title: 'Italy',
  stops: [{ name: 'Rome', at: [41.9, 12.5], kind: 'base' }],
  legs: [],
} as unknown as Trip

// Synthetic geodata: one square of land around the stops, and roads as straight lines.
async function fakeContext(): Promise<() => Promise<RenderContext>> {
  const { Geo } = await import('@tripmap/core')
  const land = {
    geometry: { type: 'Polygon', coordinates: [[[15, 35], [25, 35], [25, 45], [15, 45], [15, 35]]] },
  }
  const geo = new Geo([land], () => [land])
  return async () => ({
    geo,
    services: {
      road: async (coords) => [['drive', coords]],
      rail: async () => null,
      stations: async () => ({ nearest: () => null }),
    },
  })
}

const renderable = {
  title: 'Synthetic',
  basemap: 'region',
  stops: [
    { name: 'A', at: [40.0, 20.0], kind: 'major' },
    { name: 'B', at: [40.5, 21.0], kind: 'major' },
  ],
  legs: [{ date: '2030-01-02', mode: 'drive', via: ['A', 'B'], enabled: true }],
} as unknown as Trip

describe('renderTrip', () => {
  for (const mode of ['local', 'hosted'] as const) {
    it(`renders in the browser and never calls fetch (${mode} mode)`, async () => {
      const client = await clientIn(mode)
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const blob = await client.renderTrip(renderable, { size: 1600 }, await fakeContext())
      expect(fetchMock).not.toHaveBeenCalled()
      expect(blob.type).toBe('image/png')
      expect(await blob.text()).toBe('1600x1600')
      expect(raster.svgs).toHaveLength(1)
      expect(raster.svgs[0]).toMatch(/^<svg/)
      expect(raster.svgs[0]).not.toContain('<script')
    })
  }

  it('draws in the photo shape', async () => {
    const blob = await renderTrip(
      renderable,
      { size: 1600, photo_size: { width: 4000, height: 3000 } },
      await fakeContext(),
    )
    expect(await blob.text()).toBe('1600x1200')
  })

  it('reports a bad stop name as ApiError 422', async () => {
    const bad = { ...renderable, legs: [{ ...renderable.legs[0], via: ['A', 'Nowhere'] }] } as Trip
    await expect(renderTrip(bad, { size: 400 }, await fakeContext())).rejects.toMatchObject({ status: 422 })
  })
})

describe('exportYaml', () => {
  it('posts {trip} as JSON and returns the YAML text', async () => {
    const fetchMock = mockFetch(
      new Response('title: Italy\n', { headers: { 'Content-Type': 'text/yaml' } }),
    )
    const text = await exportYaml(trip)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/yaml')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ trip })
    expect(text).toBe('title: Italy\n')
  })

  it('writes the YAML with core in hosted mode, without fetch', async () => {
    const client = await clientIn('hosted')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const text = await client.exportYaml(renderable)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(text).toContain('title: "Synthetic"')
    expect(text).toContain('mode: drive')
  })
})

describe('suggestMode', () => {
  it('posts from, to and elapsed_hours', async () => {
    const fetchMock = mockFetch(jsonResponse({ mode: 'drive', reason: 'A road links them.' }))
    const res = await suggestMode([53.35, -6.26], [53.27, -9.06], 2.5)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/suggest-mode')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({
      from: [53.35, -6.26],
      to: [53.27, -9.06],
      elapsed_hours: 2.5,
    })
    expect(res).toEqual({ mode: 'drive', reason: 'A road links them.' })
  })

  it('leaves elapsed_hours out when not given', async () => {
    const fetchMock = mockFetch(jsonResponse({ mode: 'flight', reason: 'far' }))
    await suggestMode([53.35, -6.26], [45.76, 4.84])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      from: [53.35, -6.26],
      to: [45.76, 4.84],
    })
  })
})

describe('suggestMode errors', () => {
  it('says the feature is unavailable when serve answers 404', async () => {
    mockFetch(jsonResponse({ detail: 'Not found' }, 404))
    await expect(suggestMode([10, 20], [11, 21])).rejects.toMatchObject({
      status: 404,
      message: 'Mode suggestions are not available from this tripmap serve.',
    })
  })
})

describe('hosted mode', () => {
  it('refuses the server calls without calling fetch', async () => {
    const client = await clientIn('hosted')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(client.getPhotosStatus()).rejects.toBeInstanceOf(client.ApiError)
    await expect(client.draftTrip('2030-01-01', '2030-01-03')).rejects.toMatchObject({ status: 0 })
    await expect(client.suggestMode([10, 20], [11, 21])).rejects.toMatchObject({
      message: expect.stringContaining('tripmap serve'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
