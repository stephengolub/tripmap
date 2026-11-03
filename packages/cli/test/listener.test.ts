import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { ALLOWED_ORIGINS, type Listener, startListener } from '../src/listener.ts'

// A synthetic trip: invented coordinates, no real places.
const TRIP = `title: Test Trip
stops:
  A: [10.0, 20.0]
  B: [10.5, 20.5]
legs:
  - 2001-01-01: A -> B
`
const TOKEN = '0123456789abcdef'
const PAGES = 'https://stephengolub.github.io'

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; body: string }

function call(port: number, path: string, method = 'GET', headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

let listener: Listener | undefined
const logs: string[] = []

async function start(timeoutMs = 10_000): Promise<Listener> {
  listener = await startListener({ port: 0, token: TOKEN, trip: TRIP, timeoutMs, log: (l) => logs.push(l) })
  return listener
}

afterEach(() => {
  listener?.close()
  listener = undefined
  logs.length = 0
})

describe('startListener', () => {
  it('allows only the Pages origin and the dev server by default', () => {
    expect(ALLOWED_ORIGINS).toEqual(['https://stephengolub.github.io', 'http://localhost:5173'])
  })

  it('rejects a wrong or missing token with 403 and no trip data', async () => {
    const { port } = await start()
    for (const path of [`/trip?token=ffffffffffffffff`, '/trip']) {
      const r = await call(port, path, 'GET', { Origin: PAGES })
      expect(r.status).toBe(403)
      expect(r.body).not.toContain('Test Trip')
      expect(r.body).not.toContain('10.0')
    }
    expect(logs).toEqual(['rejected request (403)', 'rejected request (403)'])
  })

  it('echoes an allowed origin and not another one', async () => {
    const { port } = await start()
    const ok = await call(port, '/trip?token=bad', 'GET', { Origin: PAGES })
    expect(ok.headers['access-control-allow-origin']).toBe(PAGES)
    const other = await call(port, '/trip?token=bad', 'GET', { Origin: 'https://evil.example' })
    expect(other.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('answers a private-network preflight', async () => {
    const { port } = await start()
    const r = await call(port, `/trip?token=${TOKEN}`, 'OPTIONS', {
      Origin: PAGES,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Private-Network': 'true',
    })
    expect(r.status).toBe(204)
    expect(r.headers['access-control-allow-origin']).toBe(PAGES)
    expect(r.headers['access-control-allow-methods']).toBe('GET')
    expect(r.headers['access-control-allow-headers']).toBe('Content-Type')
    expect(r.headers['access-control-allow-private-network']).toBe('true')

    const plain = await call(port, `/trip?token=${TOKEN}`, 'OPTIONS', { Origin: PAGES })
    expect(plain.headers['access-control-allow-private-network']).toBeUndefined()
  })

  it('serves the YAML once, then closes', async () => {
    const l = await start()
    const r = await call(l.port, `/trip?token=${TOKEN}`, 'GET', { Origin: PAGES })
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/^text\/yaml/)
    expect(r.body).toBe(TRIP)
    await expect(l.done).resolves.toBe('served')
    await expect(call(l.port, `/trip?token=${TOKEN}`)).rejects.toThrow(/ECONNREFUSED/)
    expect(logs).toEqual(['served trip (200)'])
  })

  it('closes after the timeout with nothing served', async () => {
    const l = await start(50)
    await expect(l.done).resolves.toBe('timeout')
    await expect(call(l.port, `/trip?token=${TOKEN}`)).rejects.toThrow(/ECONNREFUSED/)
  })

  it('rejects when the port is busy', async () => {
    const l = await start()
    await expect(startListener({ port: l.port, token: TOKEN, trip: TRIP, log: () => {} })).rejects.toThrow(/EADDRINUSE/)
  })
})
