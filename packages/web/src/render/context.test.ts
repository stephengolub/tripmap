import { describe, expect, it, vi } from 'vitest'
import { MapDataError, browserRouteServices, loadRenderContext } from './context'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Invented geometry only.
const land = { geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] } }

describe('loadRenderContext', () => {
  it('builds a Geo from the three Natural Earth files', async () => {
    const fetchFn = vi.fn(async () => json({ features: [land] }))
    const { geo } = await loadRenderContext(fetchFn as unknown as typeof fetch)
    expect(fetchFn).toHaveBeenCalledTimes(3)
    for (const [url] of fetchFn.mock.calls as unknown as [string][]) {
      expect(url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/nvkelso\/natural-earth-vector\//)
    }
    expect(geo.landPolygons).toHaveLength(2)
    expect(geo.countryPolygons).toHaveLength(1)
  })

  // Waits are recorded, not slept, so the retry tests run instantly.
  const noWait = { sleep: async () => {}, baseDelayMs: 1 }

  it('retries a 503 and succeeds on a later try', async () => {
    let calls = 0
    const fetchFn = vi.fn(async () => (++calls <= 2 ? json({}, 503) : json({ features: [land] })))
    const { geo } = await loadRenderContext(fetchFn as unknown as typeof fetch, noWait)
    expect(geo.countryPolygons).toHaveLength(1)
    // Two 503s are shared across the three downloads (the first two requests), then three successes.
    expect(fetchFn).toHaveBeenCalledTimes(5)
  })

  it('says what failed, which host, how many tries, and what to do, when every try fails', async () => {
    const fetchFn = vi.fn(async () => json({}, 503))
    const err = await loadRenderContext(fetchFn as unknown as typeof fetch, noWait).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MapDataError)
    const msg = (err as Error).message
    expect(msg).toMatch(/Could not download the ne_10m_(admin_0_countries|land) map data/)
    expect(msg).toContain('HTTP 503 from raw.githubusercontent.com after 4 attempts')
    expect(msg).toContain('Trying again in a minute')
    expect(msg).toContain('githubstatus.com')
  })

  it('says it could not reach the host on a network error, without the raw error text', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const err = await loadRenderContext(fetchFn as unknown as typeof fetch, noWait).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/^Could not reach raw\.githubusercontent\.com to download the ne_10m_\w+ map data \(4 attempts\)/)
    expect((err as Error).message).toContain('Check your internet connection')
  })

  it('does not retry a 404, and reports it as not available', async () => {
    const fetchFn = vi.fn(async () => json({}, 404))
    const err = await loadRenderContext(fetchFn as unknown as typeof fetch, noWait).catch((e: unknown) => e)
    // Each of the three files is requested once; none of them is retried.
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect((err as Error).message).toContain('not available from raw.githubusercontent.com (HTTP 404)')
  })
})

describe('browserRouteServices', () => {
  it('turns OSRM steps into road pieces, lat/lon swapped', async () => {
    const fetchFn = vi.fn(async () =>
      json({
        code: 'Ok',
        routes: [{ legs: [{ steps: [{ mode: 'driving', geometry: { coordinates: [[1, 2], [3, 4]] } }] }] }],
      }),
    )
    const pieces = await browserRouteServices(fetchFn as unknown as typeof fetch).road([
      [2, 1],
      [4, 3],
    ])
    expect(String((fetchFn.mock.calls[0] as unknown as [string])[0])).toContain('/route/v1/driving/1,2;3,4?')
    expect(pieces).toEqual([['drive', [[2, 1], [4, 3]]]])
  })

  it('draws a straight line when OSRM cannot be reached', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const pieces = await browserRouteServices(fetchFn as unknown as typeof fetch).road([
      [2, 1],
      [4, 3],
    ])
    expect(pieces).toEqual([['drive', [[2, 1], [4, 3]]]])
  })
})
