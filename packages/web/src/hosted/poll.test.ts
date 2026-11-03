import { describe, expect, it, vi } from 'vitest'
import { ListenerError, listenerUrl, pollListener, TimeoutError } from './poll'

const SESSION = { port: 50123, token: '0123456789abcdef' }
const YAML = 'title: Synthetic trip\nstops: []\nlegs: []\n'

// A fake clock that only moves when the poller sleeps.
function fakeClock() {
  let t = 1_000
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => {
      t += ms
    }),
  }
}

type Step = Response | Error
function fakeFetch(steps: Step[]) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const step = steps.shift() ?? new TypeError('Failed to fetch')
    if (step instanceof Error) throw step
    return step
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

describe('listenerUrl', () => {
  it('targets the loopback listener with the token', () => {
    expect(listenerUrl(SESSION)).toBe('http://127.0.0.1:50123/trip?token=0123456789abcdef')
  })
})

describe('pollListener', () => {
  it('returns the YAML on the first 200', async () => {
    const clock = fakeClock()
    const fetch = fakeFetch([new Response(YAML, { status: 200 })])
    await expect(pollListener({ ...SESSION, fetch, ...clock })).resolves.toBe(YAML)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:50123/trip?token=0123456789abcdef')
    expect(clock.sleep).not.toHaveBeenCalled()
  })

  it('retries network failures every interval until the YAML arrives', async () => {
    const clock = fakeClock()
    const fetch = fakeFetch([new TypeError('Failed to fetch'), new TypeError('Failed to fetch'), new Response(YAML)])
    await expect(pollListener({ ...SESSION, fetch, ...clock })).resolves.toBe(YAML)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(clock.sleep.mock.calls).toEqual([[1500], [1500]])
  })

  it('retries a non-403 error status such as 404 or 502', async () => {
    const clock = fakeClock()
    const fetch = fakeFetch([new Response('', { status: 404 }), new Response('', { status: 502 }), new Response(YAML)])
    await expect(pollListener({ ...SESSION, fetch, ...clock })).resolves.toBe(YAML)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('stops on a 403 without retrying', async () => {
    const clock = fakeClock()
    const fetch = fakeFetch([new Response('forbidden\n', { status: 403 }), new Response(YAML)])
    const err = await pollListener({ ...SESSION, fetch, ...clock }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ListenerError)
    expect((err as ListenerError).status).toBe(403)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(clock.sleep).not.toHaveBeenCalled()
  })

  it('throws TimeoutError once the deadline passes', async () => {
    const clock = fakeClock()
    const fetch = fakeFetch([]) // every call fails
    const err = await pollListener({ ...SESSION, fetch, ...clock, timeoutMs: 10_000, intervalMs: 1_000 }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(TimeoutError)
    expect(fetch).toHaveBeenCalledTimes(11) // t = 0, 1s, ..., 10s
    expect(clock.sleep).toHaveBeenCalledTimes(10)
  })

  it('defaults to a 10-minute timeout at 1.5 s', async () => {
    const clock = fakeClock()
    const fetch = fakeFetch([])
    await expect(pollListener({ ...SESSION, fetch, ...clock })).rejects.toBeInstanceOf(TimeoutError)
    expect(fetch).toHaveBeenCalledTimes(401) // 600 s / 1.5 s, plus the first try
  })

  it('stops when aborted', async () => {
    const clock = fakeClock()
    const controller = new AbortController()
    const fetch = fakeFetch([])
    clock.sleep.mockImplementationOnce(async () => controller.abort(new Error('cancelled')))
    await expect(pollListener({ ...SESSION, fetch, ...clock, signal: controller.signal })).rejects.toThrow('cancelled')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
