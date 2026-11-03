import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Trip } from '../types/trip'
import {
  ApiError,
  draftTrip,
  exportYaml,
  getPhotosStatus,
  importYaml,
  renderTrip,
  suggestMode,
} from './client'

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
})

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
    await draftTrip('2026-05-01', '2026-05-04', 'Ireland sample')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/trips/draft')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({
      start: '2026-05-01',
      end: '2026-05-04',
      title: 'Ireland sample',
    })
  })

  it('leaves title out when not given', async () => {
    const fetchMock = mockFetch(jsonResponse({ trip: {}, stats: {} }))
    await draftTrip('2026-05-01', '2026-05-04')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      start: '2026-05-01',
      end: '2026-05-04',
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
  it('posts the YAML as text/plain', async () => {
    const fetchMock = mockFetch(jsonResponse({ trip: { stops: [], legs: [] } }))
    await importYaml('title: x\n')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/trips/import')
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain' })
    expect(init.body).toBe('title: x\n')
  })
})

const trip = {
  title: 'Italy',
  stops: [{ name: 'Rome', at: [41.9, 12.5], kind: 'base' }],
  legs: [],
} as unknown as Trip

describe('renderTrip', () => {
  it('posts the trip and options as JSON and returns a Blob', async () => {
    const fetchMock = mockFetch(
      new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }),
    )
    const blob = await renderTrip(trip, { size: 1600, with_day_trips: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/trips/render')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ trip, size: 1600, with_day_trips: true })
    // Response.blob() hands back Node's Blob, not jsdom's, so instanceof would compare realms.
    expect(Object.prototype.toString.call(blob)).toBe('[object Blob]')
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(4)
  })

  it('sends only the trip when no options are given', async () => {
    const fetchMock = mockFetch(new Response(new Uint8Array([1])))
    await renderTrip(trip)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ trip })
  })

  it('surfaces a 503 when Chrome is missing', async () => {
    mockFetch(jsonResponse({ detail: 'Chrome not found' }, 503))
    await expect(renderTrip(trip)).rejects.toMatchObject({ status: 503, message: 'Chrome not found' })
  })
})

describe('exportYaml', () => {
  it('posts {trip} as JSON and returns the YAML text', async () => {
    const fetchMock = mockFetch(
      new Response('title: Italy\n', { headers: { 'Content-Type': 'text/yaml' } }),
    )
    const text = await exportYaml(trip)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/trips/yaml')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ trip })
    expect(text).toBe('title: Italy\n')
  })
})

describe('suggestMode', () => {
  it('posts from, to and elapsed_hours', async () => {
    const fetchMock = mockFetch(jsonResponse({ mode: 'drive', reason: 'A road links them.' }))
    const res = await suggestMode([53.35, -6.26], [53.27, -9.06], 2.5)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/legs/suggest-mode')
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

describe('importYaml method', () => {
  it('uses POST', async () => {
    const fetchMock = mockFetch(jsonResponse({ trip: { stops: [], legs: [] } }))
    await importYaml('title: x\n')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })
})
