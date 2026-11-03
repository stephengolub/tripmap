// Polls the CLI's one-shot listener (packages/cli/src/listener.ts) until the user's terminal
// has finished the draft. Until then nothing is listening, so a refused connection is the
// normal "not yet" answer and is retried. A 403 means the token is wrong, which no retry fixes.

import type { ListenerSession } from './command'

export class TimeoutError extends Error {
  constructor(message = 'Timed out waiting for the tripmap command to finish.') {
    super(message)
    this.name = 'TimeoutError'
  }
}

export class ListenerError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ListenerError'
    this.status = status
  }
}

export interface PollOptions extends ListenerSession {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number
  intervalMs?: number
  /** Aborting stops the poll and rejects with the signal's reason. */
  signal?: AbortSignal
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function listenerUrl({ port, token }: ListenerSession): string {
  return `http://127.0.0.1:${port}/trip?token=${encodeURIComponent(token)}`
}

/** Resolve with the trip YAML from the listener, or throw TimeoutError / ListenerError. */
export async function pollListener({
  port,
  token,
  fetch: fetchFn = (input, init) => fetch(input, init),
  sleep = realSleep,
  now = Date.now,
  timeoutMs = 600_000,
  intervalMs = 1500,
  signal,
}: PollOptions): Promise<string> {
  const url = listenerUrl({ port, token })
  const deadline = now() + timeoutMs
  for (;;) {
    signal?.throwIfAborted()
    let res: Response | undefined
    try {
      res = await fetchFn(url, { cache: 'no-store', signal })
    } catch {
      // Aborts end the poll; anything else is a network failure (nothing listening yet).
      if (signal?.aborted) throw signal.reason
    }
    if (res) {
      if (res.ok) return await res.text()
      if (res.status === 403) {
        throw new ListenerError(403, 'The tripmap listener refused the token. Copy the command again and rerun it.')
      }
      // Anything else (some other server on this port, a 5xx) is retried until the deadline.
    }
    if (now() + intervalMs > deadline) throw new TimeoutError()
    await sleep(intervalMs)
  }
}
