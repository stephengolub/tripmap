import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, draftTrip, getPhotosStatus, importYaml } from './client'

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
