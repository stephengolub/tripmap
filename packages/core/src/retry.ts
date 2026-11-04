// Fetch with retries for transient failures: network errors, 408, 429 and 5xx. Browser-safe
// (no Node imports). The sleep and fetch functions are injectable so tests run instantly.

export type RetryOptions = {
  /** Total tries, including the first. Default 4 (the first try, then retries after 1s, 2s and 4s). */
  attempts?: number
  baseDelayMs?: number
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Called before each wait, so a caller can log progress without the URL's query string. */
  onRetry?: (info: { attempt: number; reason: string; delayMs: number }) => void
}

/** Every try failed. `status` is the last HTTP status, or null when no response arrived. */
export class FetchExhaustedError extends Error {
  readonly host: string
  readonly status: number | null
  readonly attempts: number

  constructor(url: string, status: number | null, attempts: number, cause?: unknown) {
    const host = new URL(url).host
    const what = status === null ? 'no response' : `HTTP ${status}`
    super(`${what} from ${host} after ${attempts} attempt${attempts === 1 ? '' : 's'}`, { cause })
    this.name = 'FetchExhaustedError'
    this.host = host
    this.status = status
    this.attempts = attempts
  }
}

export const isRetryableStatus = (status: number) => status === 408 || status === 429 || status >= 500

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * GET `url` and return the response. A retryable failure is retried with doubling waits; when
 * every try fails this throws FetchExhaustedError. Any other non-2xx response (404, say) is
 * returned at once for the caller to report, since retrying it would not change the answer.
 */
export async function fetchWithRetry(url: string, init: RequestInit = {}, opts: RetryOptions = {}): Promise<Response> {
  const attempts = opts.attempts ?? 4
  const baseDelayMs = opts.baseDelayMs ?? 1000
  const fetchFn = opts.fetchFn ?? fetch
  const sleep = opts.sleep ?? wait
  let lastStatus: number | null = null
  let lastCause: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchFn(url, init)
      if (res.ok || !isRetryableStatus(res.status)) return res
      lastStatus = res.status
      lastCause = undefined
    } catch (e) {
      lastStatus = null
      lastCause = e
    }
    if (attempt < attempts) {
      const delayMs = baseDelayMs * 2 ** (attempt - 1)
      const reason = lastStatus === null ? 'network error' : `HTTP ${lastStatus}`
      opts.onRetry?.({ attempt, reason, delayMs })
      await sleep(delayMs)
    }
  }
  throw new FetchExhaustedError(url, lastStatus, attempts, lastCause)
}
