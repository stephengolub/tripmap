import { describe, expect, it, vi } from 'vitest'
import { FetchExhaustedError, fetchWithRetry, isRetryableStatus } from '../src/retry.ts'

const URL_ = 'https://example.test/data.geojson?x=1'

describe('isRetryableStatus', () => {
  it('retries 408, 429 and every 5xx, and nothing else', () => {
    expect([408, 429, 500, 502, 503, 599].map(isRetryableStatus)).toEqual([true, true, true, true, true, true])
    expect([200, 301, 400, 401, 403, 404].map(isRetryableStatus)).toEqual([false, false, false, false, false, false])
  })
})

describe('fetchWithRetry', () => {
  it('waits 1s, 2s, 4s between the four tries, doubling', async () => {
    const waits: number[] = []
    const fetchFn = vi.fn(async () => new Response('busy', { status: 503 }))
    const err = await fetchWithRetry(URL_, {}, { fetchFn, sleep: async (ms) => { waits.push(ms) } }).catch((e: unknown) => e)
    expect(fetchFn).toHaveBeenCalledTimes(4)
    expect(waits).toEqual([1000, 2000, 4000])
    expect(err).toBeInstanceOf(FetchExhaustedError)
    expect((err as FetchExhaustedError).status).toBe(503)
    expect((err as FetchExhaustedError).attempts).toBe(4)
  })

  it('reports the host, not the query string, in the error', async () => {
    const fetchFn = vi.fn(async () => new Response('busy', { status: 502 }))
    const err = await fetchWithRetry(URL_, {}, { fetchFn, attempts: 1 }).catch((e: unknown) => e)
    expect((err as Error).message).toBe('HTTP 502 from example.test after 1 attempt')
    expect((err as Error).message).not.toContain('x=1')
  })

  it('returns the response on success without waiting', async () => {
    const sleep = vi.fn(async () => {})
    const fetchFn = vi.fn(async () => new Response('ok', { status: 200 }))
    const res = await fetchWithRetry(URL_, {}, { fetchFn, sleep })
    expect(res.status).toBe(200)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('does not retry a 404; the caller sees it at once', async () => {
    const fetchFn = vi.fn(async () => new Response('gone', { status: 404 }))
    const res = await fetchWithRetry(URL_, {}, { fetchFn, sleep: async () => {} })
    expect(res.status).toBe(404)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('recovers from a network error on a later try', async () => {
    let calls = 0
    const fetchFn = vi.fn(async () => {
      if (++calls === 1) throw new TypeError('Failed to fetch')
      return new Response('ok', { status: 200 })
    })
    const res = await fetchWithRetry(URL_, {}, { fetchFn, sleep: async () => {} })
    expect(res.status).toBe(200)
    expect(calls).toBe(2)
  })

  it('reports a network error as no response, and keeps the cause', async () => {
    const cause = new TypeError('Failed to fetch')
    const fetchFn = vi.fn(async () => {
      throw cause
    })
    const err = await fetchWithRetry(URL_, {}, { fetchFn, sleep: async () => {}, attempts: 2 }).catch((e: unknown) => e)
    expect((err as FetchExhaustedError).status).toBeNull()
    expect((err as Error).message).toBe('no response from example.test after 2 attempts')
    expect((err as Error).cause).toBe(cause)
  })

  it('tells the caller about each retry, with the reason and the delay', async () => {
    let calls = 0
    const fetchFn = vi.fn(async () => (++calls < 3 ? new Response('busy', { status: 503 }) : new Response('ok')))
    const onRetry = vi.fn()
    await fetchWithRetry(URL_, {}, { fetchFn, sleep: async () => {}, onRetry })
    expect(onRetry.mock.calls).toEqual([
      [{ attempt: 1, reason: 'HTTP 503', delayMs: 1000 }],
      [{ attempt: 2, reason: 'HTTP 503', delayMs: 2000 }],
    ])
  })
})
