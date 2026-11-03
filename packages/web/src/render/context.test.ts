import { describe, expect, it, vi } from 'vitest'
import { browserRouteServices, loadRenderContext } from './context'

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

  it('fails with the HTTP status when a download fails', async () => {
    const fetchFn = vi.fn(async () => json({}, 502))
    await expect(loadRenderContext(fetchFn as unknown as typeof fetch)).rejects.toThrow('HTTP 502')
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
