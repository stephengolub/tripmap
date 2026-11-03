import { spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runDraft, type DraftFn } from '../src/draft.ts'
import type { Listener } from '../src/listener.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const STUB = fileURLToPath(new URL('./fixtures/draft-stub.mjs', import.meta.url))
const TOKEN = '0123456789abcdef'
const YAML = 'title: "Synthetic"\nstops: []\nlegs: []\n'
const draft: DraftFn = async () => ({ yaml: YAML, summary: ['  0 overnight stops: '] })

function capture() {
  const io = { out: '', err: '' }
  return { io, stdout: (t: string) => { io.out += t }, stderr: (t: string) => { io.err += t } }
}

describe('draft --port --token (built CLI)', () => {
  let busy: Server
  let port: number

  beforeAll(async () => {
    const build = spawnSync(process.execPath, [fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)), '-b', 'tsconfig.json'], { cwd: ROOT, encoding: 'utf8' })
    expect(build.status, build.stdout + build.stderr).toBe(0)
    busy = createServer()
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve))
    port = (busy.address() as { port: number }).port
  }, 120_000)
  afterAll(() => new Promise<void>((resolve) => busy.close(() => resolve())))

  it('prints the YAML to stdout and exits 1 when the port is busy', () => {
    const run = spawnSync(process.execPath, [STUB, 'draft', '--from', '2020-01-01', '--to', '2020-01-02', '--port', String(port), '--token', TOKEN], { encoding: 'utf8', timeout: 30_000 })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('title: "Synthetic trip"')
    expect(run.stdout).toContain('legs:')
    expect(run.stderr).toMatch(/cannot listen on 127\.0\.0\.1:\d+ \(port is busy\)/)
    expect(run.stderr).not.toContain('Waiting for the page')
  })
})

describe('runDraft', () => {
  it('writes the YAML to stdout without -o and puts the summary on stderr', async () => {
    const c = capture()
    expect(await runDraft({ library: '/lib', from: '2020-01-01', to: '2020-01-02' }, { draft, ...c })).toBe(0)
    expect(c.io.out).toBe(YAML)
    expect(c.io.err).toContain('overnight stops')
  })

  it('serves through the listener and prints one waiting line with no trip data', async () => {
    const c = capture()
    let served: string | undefined
    const fake = async (opts: { port: number; token: string; trip: string }): Promise<Listener> => {
      served = opts.trip
      return { port: opts.port, done: Promise.resolve('served'), close() {} }
    }
    const code = await runDraft({ library: '/lib', from: '2020-01-01', to: '2020-01-02', listen: { port: 50123, token: TOKEN } },
      { draft, startListener: fake, ...c })
    expect(code).toBe(0)
    expect(served).toBe(YAML)
    const waiting = c.io.err.split('\n').filter((l) => l.startsWith('Waiting'))
    expect(waiting).toEqual(['Waiting for the page to pick this up on 127.0.0.1:50123'])
  })

  it('exits 1 with the YAML on stdout when the page never picks it up', async () => {
    const c = capture()
    const fake = async (opts: { port: number }): Promise<Listener> => ({ port: opts.port, done: Promise.resolve('timeout'), close() {} })
    const code = await runDraft({ library: '/lib', from: '2020-01-01', to: '2020-01-02', listen: { port: 50124, token: TOKEN } },
      { draft, startListener: fake, ...c })
    expect(code).toBe(1)
    expect(c.io.out).toBe(YAML)
    expect(c.io.err).toMatch(/did not pick up/)
  })

  it('reports a TripError as a message and exits 1', async () => {
    const c = capture()
    const failing: DraftFn = async () => { const e = new Error('Only 1 geotagged photos between 2020-01-01 and 2020-01-02.'); e.name = 'TripError'; throw e }
    expect(await runDraft({ library: '/lib', from: '2020-01-01', to: '2020-01-02' }, { draft: failing, ...c })).toBe(1)
    expect(c.io.err).toMatch(/^tripmap: Only 1 geotagged photos/)
    expect(c.io.out).toBe('')
  })
})
