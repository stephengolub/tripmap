// `tripmap serve`: the local web app on 127.0.0.1. It serves the built app from web-dist/ and a
// small API the app's Detect button calls. It keeps no state: the browser owns the trip and sends
// it in each request. Logs say the method, path and status only, never coordinates or paths.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Stats, Trip } from '@tripmap/core'

export const MAX_DETECT_DAYS = 60
const MAX_BODY_BYTES = 5 * 1024 * 1024
const DAY_MS = 86_400_000

/** The Vite dev server may call the API too; the built app is same-origin and needs no CORS. */
export const DEV_ORIGIN = 'http://localhost:5173'

export type PhotosStatus =
  | { ok: true; library: string; geotagged_assets: number }
  | { ok: false; library: string; reason: 'not_found' | 'permission_denied' | 'unreadable'; message: string }

export interface DetectRequest {
  library: string
  from: string
  to: string
  title?: string
  log: (line: string) => void
}

export type DetectFn = (req: DetectRequest) => Promise<{ trip: Trip; stats: Stats }>

export interface ServeOptions {
  port: number
  library: string
  /** The built web app. Defaults to web-dist/ next to dist/ in the package. */
  webRoot?: string
  detect?: DetectFn
  photosStatus?: (library: string) => PhotosStatus | Promise<PhotosStatus>
  /** Trip JSON to YAML text. Defaults to core's dumpTripYaml. */
  toYaml?: (trip: Trip) => string | Promise<string>
  log?: (line: string) => void
}

export interface Serving {
  port: number
  server: Server
  close(): Promise<void>
}

const DEFAULT_WEB_ROOT = fileURLToPath(new URL('../web-dist/', import.meta.url))

// Core loads lazily, so the module imports cheaply and tests can stub every dependency.
const detectFromPhotos: DetectFn = async (req) => (await import('./photos-draft.ts')).detectFromPhotos(req)

async function realPhotosStatus(library: string): Promise<PhotosStatus> {
  const { PhotosError, countGeotaggedPhotos } = await import('@tripmap/core/node')
  try {
    return { ok: true, library, geotagged_assets: countGeotaggedPhotos(library) }
  } catch (e) {
    if (e instanceof PhotosError) return { ok: false, library, reason: e.code, message: e.message }
    throw e
  }
}

async function realToYaml(): Promise<(trip: Trip) => string> {
  const { dumpTripYaml } = await import('@tripmap/core')
  return (trip) => dumpTripYaml(trip)
}

const USER_ERRORS = new Set(['TripError', 'PhotosError'])

/** An error answered with its status and message as `{detail}`, like the FastAPI version. */
class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Start the server on 127.0.0.1. Rejects if the port cannot be bound. */
export function startServe(opts: ServeOptions): Promise<Serving> {
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`))
  const server = createServer((req, res) => {
    handle(req, res, opts).then(
      (status) => log(`${req.method} ${pathOf(req)} ${status}`),
      (e) => {
        const status = e instanceof HttpError ? e.status : 500
        if (!res.headersSent) json(res, status, { detail: e instanceof HttpError ? e.message : 'internal error' })
        else res.end()
        log(`${req.method} ${pathOf(req)} ${status}${status === 500 ? ` (${(e as Error)?.name ?? 'Error'})` : ''}`)
      },
    )
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, '127.0.0.1', () => {
      server.off('error', reject)
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : opts.port
      resolve({
        port,
        server,
        close: () => new Promise((done) => {
          server.close(() => done())
          server.closeAllConnections()
        }),
      })
    })
  })
}

function pathOf(req: IncomingMessage): string {
  return new URL(req.url ?? '/', 'http://127.0.0.1').pathname
}

/** Answer one request and return its status code; throw an HttpError for an error answer. */
async function handle(req: IncomingMessage, res: ServerResponse, opts: ServeOptions): Promise<number> {
  // A loopback server can still be reached through DNS rebinding; only answer local host names.
  const host = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new HttpError(403, 'Unknown host')

  if (req.headers.origin === DEV_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', DEV_ORIGIN)
    res.setHeader('Vary', 'Origin')
  }
  const path = pathOf(req)
  if (!path.startsWith('/api/')) return serveStatic(req, res, path, opts.webRoot ?? DEFAULT_WEB_ROOT)

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.statusCode = 204
    res.end()
    return 204
  }
  const route = `${req.method} ${path}`
  switch (route) {
    case 'GET /api/photos/status':
      return json(res, 200, await (opts.photosStatus ?? realPhotosStatus)(opts.library))
    case 'POST /api/detect': {
      const body = await readJson(req)
      const { from, to, title } = detectBody(body)
      try {
        const { trip, stats } = await (opts.detect ?? detectFromPhotos)({
          library: opts.library, from, to, title, log: () => {},
        })
        return json(res, 200, { trip, stats })
      } catch (e) {
        if (e instanceof Error && e.name === 'TripError') throw new HttpError(404, e.message)
        if (e instanceof Error && USER_ERRORS.has(e.name)) throw new HttpError(503, e.message)
        throw e
      }
    }
    case 'POST /api/yaml': {
      const trip = tripBody(await readJson(req))
      const toYaml = opts.toYaml ?? await realToYaml()
      let text: string
      try {
        text = await toYaml(trip)
      } catch (e) {
        throw new HttpError(422, `Not a complete trip: ${(e as Error)?.message ?? e}`)
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/yaml; charset=utf-8')
      res.end(text)
      return 200
    }
    default:
      if (['/api/photos/status', '/api/detect', '/api/yaml'].includes(path)) throw new HttpError(405, 'Method not allowed')
      throw new HttpError(404, 'Not found')
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function detectBody(body: unknown): { from: string; to: string; title?: string } {
  const b = (body ?? {}) as Record<string, unknown>
  for (const key of ['from', 'to'] as const) {
    const v = b[key]
    if (typeof v !== 'string' || !DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
      throw new HttpError(422, `${key} must be a date as YYYY-MM-DD`)
    }
  }
  const from = b.from as string
  const to = b.to as string
  if (b.title !== undefined && b.title !== null && typeof b.title !== 'string') throw new HttpError(422, 'title must be text')
  if (to < from) throw new HttpError(422, 'end is before start')
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS
  if (days > MAX_DETECT_DAYS) throw new HttpError(422, `the range is over ${MAX_DETECT_DAYS} days`)
  return { from, to, title: typeof b.title === 'string' && b.title ? b.title : undefined }
}

function tripBody(body: unknown): Trip {
  const trip = (body as { trip?: unknown } | null)?.trip as Record<string, unknown> | undefined
  if (!trip || typeof trip !== 'object' || Array.isArray(trip)) throw new HttpError(422, 'The body needs a trip')
  for (const key of ['stops', 'legs']) {
    const list = trip[key]
    if (!Array.isArray(list) || list.length === 0) throw new HttpError(422, `The trip has no ${key}`)
  }
  return trip as unknown as Trip
}

/** Read a JSON body. Requiring application/json forces a CORS preflight on any cross-site POST. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'The body must be application/json')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'The body is too large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(422, 'The body is not valid JSON')
  }
}

function json(res: ServerResponse, status: number, body: unknown): number {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
  return status
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

/** Serve a file from the built app, falling back to index.html for app routes. */
function serveStatic(req: IncomingMessage, res: ServerResponse, path: string, root: string): number {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed')
  const index = join(root, 'index.html')
  if (!existsSync(index)) {
    throw new HttpError(404, 'The web app is not built (web-dist/ is missing). The API is still available under /api/.')
  }
  let rel: string
  try {
    rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '')
  } catch {
    throw new HttpError(400, 'Bad path')
  }
  let file = join(root, rel)
  if (file !== root.replace(/[/\\]$/, '') && !file.startsWith(root.endsWith(sep) ? root : root + sep)) {
    throw new HttpError(404, 'Not found')
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (extname(rel)) throw new HttpError(404, 'Not found')
    file = index
  }
  res.statusCode = 200
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file))
  return 200
}
