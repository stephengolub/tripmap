// The one-shot listener behind hosted mode. After `draft --port P --token T`, the hosted page polls
// http://127.0.0.1:P/trip?token=T; this answers it once with the trip YAML, then closes. It never
// logs the trip, only "served trip" or "rejected request" with a status code.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export const DEFAULT_TIMEOUT_MS = 600_000

/** The hosted page's origin, plus the Vite dev server. No other origin may read the trip. */
export const ALLOWED_ORIGINS = ['https://stephengolub.github.io', 'http://localhost:5173']

export interface ListenerOptions {
  port: number
  token: string
  /** The trip as YAML text, served verbatim. */
  trip: string
  timeoutMs?: number
  allowedOrigins?: string[]
  log?: (line: string) => void
}

export interface Listener {
  /** The bound port (useful when started on port 0). */
  port: number
  /** Resolves once the server has closed: 'served' after the first success, else 'timeout'. */
  done: Promise<'served' | 'timeout'>
  close(): void
}

/** Start the listener on 127.0.0.1. Rejects if the port cannot be bound (busy, say). */
export function startListener(opts: ListenerOptions): Promise<Listener> {
  const allowed = opts.allowedOrigins ?? ALLOWED_ORIGINS
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`))
  let outcome: 'served' | 'timeout' = 'timeout'
  let resolveDone!: (value: 'served' | 'timeout') => void
  const done = new Promise<'served' | 'timeout'>((resolve) => { resolveDone = resolve })

  const server = createServer((req, res) => {
    corsHeaders(req, res, allowed)
    const status = handle(req, res, opts, allowed)
    log(status === 200 ? `served trip (${status})` : `rejected request (${status})`)
    if (status === 200) {
      outcome = 'served'
      res.on('finish', shutdown)
    }
  })

  let timer: NodeJS.Timeout | undefined
  function shutdown(): void {
    clearTimeout(timer)
    server.close(() => resolveDone(outcome))
    server.closeAllConnections()
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, '127.0.0.1', () => {
      server.off('error', reject)
      timer = setTimeout(shutdown, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : opts.port
      resolve({ port, done, close: shutdown })
    })
  })
}

function corsHeaders(req: IncomingMessage, res: ServerResponse, allowed: string[]): void {
  const origin = req.headers.origin
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
}

/** Answer one request and return its status code. */
function handle(req: IncomingMessage, res: ServerResponse, opts: ListenerOptions, allowed: string[]): number {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  // A request from any other origin never gets the trip, and it does not use up the one-shot.
  // Browsers always send Origin on cross-origin requests; a client with no Origin is not a page.
  const origin = req.headers.origin
  if (origin && !allowed.includes(origin)) return send(res, 403, 'forbidden\n')
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
    }
    return send(res, 204)
  }
  if (url.pathname !== '/trip') return send(res, 404, 'not found\n')
  if (req.method !== 'GET') return send(res, 405, 'method not allowed\n')
  if (url.searchParams.get('token') !== opts.token) return send(res, 403, 'forbidden\n')
  res.setHeader('Cache-Control', 'no-store')
  return send(res, 200, opts.trip, 'text/yaml; charset=utf-8')
}

function send(res: ServerResponse, status: number, body = '', type = 'text/plain; charset=utf-8'): number {
  res.statusCode = status
  if (body) res.setHeader('Content-Type', type)
  res.end(body)
  return status
}
