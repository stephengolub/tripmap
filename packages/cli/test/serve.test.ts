import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Trip } from '@tripmap/core'
import { startServe, type DetectFn, type Serving } from '../src/serve.ts'

// Synthetic trips only: invented names and coordinates, nothing from Photos.
function syntheticTrip(from: string, to: string): Trip {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000
  const stops = Array.from({ length: days + 1 }, (_, i) => ({
    name: `Stop ${i}`, kind: 'major' as const, at: [10 + i * 0.1, 20 + i * 0.1] as [number, number], nights: 1,
  }))
  const legs = stops.slice(1).map((s, i) => ({
    date: from, mode: 'drive' as const, day_trip: false, via: [stops[i]!.name, s.name], enabled: true,
  }))
  return { title: `Synthetic ${from}`, basemap: 'region', stops, legs }
}

class TripError extends Error {
  name = 'TripError'
}

const calls: string[] = []
const detect: DetectFn = async ({ from, to }) => {
  calls.push(`${from}..${to}`)
  if (from === '2001-01-01') throw new TripError(`Only 1 geotagged photos between ${from} and ${to}.`)
  // Let the two concurrent requests overlap, so shared state would show up.
  await new Promise((r) => setTimeout(r, from === '2002-01-01' ? 40 : 5))
  const trip = syntheticTrip(from, to)
  return { trip, stats: { photo_count: trip.stops.length * 10, overnight_names: [], quick_names: [], hidden_names: [], leg_counts: { drive: trip.legs.length } } }
}

let serving: Serving
let base: string
let web: string
const logs: string[] = []

beforeAll(async () => {
  web = mkdtempSync(join(tmpdir(), 'tripmap-web-'))
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>tripmap</title>')
  mkdirSync(join(web, 'assets'))
  writeFileSync(join(web, 'assets', 'app.js'), 'console.log(1)')
  serving = await startServe({
    port: 0, library: '/synthetic/library', webRoot: web, detect,
    photosStatus: (library) => ({ ok: false, library, reason: 'permission_denied', message: 'Grant Full Disk Access' }),
    toYaml: (trip) => `title: "${trip.title}"\nlegs: ${trip.legs.length}\n`,
    log: (line) => logs.push(line),
  })
  base = `http://127.0.0.1:${serving.port}`
})

afterAll(async () => {
  await serving.close()
  rmSync(web, { recursive: true, force: true })
})

const post = (path: string, body: unknown) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

describe('POST /api/detect', () => {
  it('answers 422 when the end is before the start', async () => {
    const res = await post('/api/detect', { from: '2003-01-05', to: '2003-01-01' })
    expect(res.status).toBe(422)
    expect((await res.json()).detail).toMatch(/before/)
  })

  it('answers 422 when the span is over 60 days', async () => {
    const res = await post('/api/detect', { from: '2003-01-01', to: '2003-03-15' })
    expect(res.status).toBe(422)
    expect((await res.json()).detail).toMatch(/60 days/)
  })

  it('answers 422 for a missing or malformed date', async () => {
    expect((await post('/api/detect', { to: '2003-01-01' })).status).toBe(422)
    expect((await post('/api/detect', { from: 'soon', to: '2003-01-01' })).status).toBe(422)
  })

  it('answers 404 with the message when there are too few photos', async () => {
    const res = await post('/api/detect', { from: '2001-01-01', to: '2001-01-03' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ detail: 'Only 1 geotagged photos between 2001-01-01 and 2001-01-03.' })
  })

  it('answers 200 with {trip, stats}', async () => {
    const res = await post('/api/detect', { from: '2003-01-01', to: '2003-01-03', title: 'Mine' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['stats', 'trip'])
    expect(body.trip.stops).toHaveLength(3)
    expect(body.trip.legs.every((l: { enabled: boolean }) => l.enabled)).toBe(true)
    expect(body.stats.photo_count).toBe(30)
  })

  it('keeps no state: two concurrent requests of different sizes get their own trips', async () => {
    const [a, b] = await Promise.all([
      post('/api/detect', { from: '2002-01-01', to: '2002-01-10' }).then((r) => r.json()),
      post('/api/detect', { from: '2004-01-01', to: '2004-01-02' }).then((r) => r.json()),
    ])
    expect(a.trip.stops).toHaveLength(10)
    expect(a.trip.title).toBe('Synthetic 2002-01-01')
    expect(b.trip.stops).toHaveLength(2)
    expect(b.trip.title).toBe('Synthetic 2004-01-01')
  })

  it('refuses a body that is not JSON, which a cross-site form could send without preflight', async () => {
    const res = await fetch(`${base}/api/detect`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })
    expect(res.status).toBe(415)
  })
})

describe('the rest of the API', () => {
  it('reports the Photos status with the reason code', async () => {
    const res = await fetch(`${base}/api/photos/status`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, library: '/synthetic/library', reason: 'permission_denied', message: 'Grant Full Disk Access' })
  })

  it('turns a trip into YAML text', async () => {
    const res = await post('/api/yaml', { trip: syntheticTrip('2003-01-01', '2003-01-04') })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/yaml/)
    expect(await res.text()).toBe('title: "Synthetic 2003-01-01"\nlegs: 3\n')
  })

  it('answers 422 for a trip with no legs', async () => {
    expect((await post('/api/yaml', { trip: { stops: [{}], legs: [] } })).status).toBe(422)
    expect((await post('/api/yaml', {})).status).toBe(422)
  })

  it('answers 404 for an unknown route and 405 for the wrong method', async () => {
    expect((await fetch(`${base}/api/nope`)).status).toBe(404)
    expect((await fetch(`${base}/api/detect`)).status).toBe(405)
  })
})

describe('static files and safety', () => {
  it('serves the web app, with index.html for app routes', async () => {
    const root = await fetch(`${base}/`)
    expect(root.status).toBe(200)
    expect(root.headers.get('content-type')).toMatch(/^text\/html/)
    expect(await root.text()).toContain('<title>tripmap</title>')
    expect(await (await fetch(`${base}/assets/app.js`)).text()).toBe('console.log(1)')
    expect((await fetch(`${base}/some/route`)).status).toBe(200)
    expect((await fetch(`${base}/missing.js`)).status).toBe(404)
  })

  it('does not serve files outside web-dist', async () => {
    const res = await fetch(`${base}/..%2f..%2fetc%2fpasswd`)
    expect(res.status).not.toBe(500)
    expect(await res.text()).not.toContain('root:')
  })

  it('binds 127.0.0.1 only', () => {
    expect((serving.server.address() as { address: string }).address).toBe('127.0.0.1')
  })

  it('logs counts and status codes, never request bodies', () => {
    expect(logs.some((l) => l === 'POST /api/detect 200')).toBe(true)
    expect(logs.join('\n')).not.toMatch(/Stop \d|10\.\d|2003-01/)
  })
})
