import { TripRenderError, buildSvg, dumpTripYaml, parseTripYaml, rasterizeSvgInBrowser, routeLegs } from '@tripmap/core'
import type { Trip as CoreTrip } from '@tripmap/core'
import { API_BASE, MODE } from '../mode'
import { defaultRenderContext, type RenderContext } from '../render/context'
import type { LatLon, Mode, Stats, Trip } from '../types/trip'

// The calls the components make. In local mode the Photos ones go to `tripmap serve`
// under /api (the Vite dev server proxies it to 127.0.0.1:8787). Hosted mode has no API:
// YAML is read and written by @tripmap/core, and drafting goes through the CLI listener
// instead (src/hosted/). Rendering never touches the server in either mode: the SVG is
// built and rasterized in this tab.

export type PhotosStatus = {
  ok: boolean
  library: string
  geotagged_assets?: number | null
  reason?: 'not_found' | 'permission_denied' | 'unreadable' | null
  message?: string | null
}

export type DraftResponse = { trip: Trip; stats: Stats }

export type RenderOptions = {
  size?: number
  photo_size?: { width: number; height: number } | null
  with_day_trips?: boolean
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// Errors are {"detail": "..."} from the handlers, or {"detail": [{msg}, ...]}
// from request validation. Anything else gets a plain message with the status.
async function errorFrom(res: Response): Promise<ApiError> {
  let message = `The server answered with status ${res.status}.`
  try {
    const body = await res.json()
    const detail = body?.detail
    if (typeof detail === 'string' && detail) {
      message = detail
    } else if (Array.isArray(detail) && detail.length) {
      message = detail
        .map((d) => (typeof d?.msg === 'string' ? d.msg.replace(/^Value error, /, '') : ''))
        .filter(Boolean)
        .join('; ') || message
    }
  } catch {
    // Not JSON; keep the status message.
  }
  return new ApiError(res.status, message)
}

const HOSTED_MESSAGE = 'This needs tripmap serve; the hosted page has no server.'

async function request(path: string, init?: RequestInit): Promise<Response> {
  if (MODE !== 'local') throw new ApiError(0, HOSTED_MESSAGE)
  let res: Response
  try {
    res = await fetch(API_BASE + path, init)
  } catch {
    throw new ApiError(0, 'Could not reach the tripmap server. Is tripmap serve running?')
  }
  if (!res.ok) throw await errorFrom(res)
  return res
}

function postJson(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function getPhotosStatus(): Promise<PhotosStatus> {
  const res = await request('/api/photos/status')
  return (await res.json()) as PhotosStatus
}

export async function draftTrip(from: string, to: string, title?: string): Promise<DraftResponse> {
  const body: { from: string; to: string; title?: string } = { from, to }
  if (title) body.title = title
  const res = await postJson('/api/detect', body)
  return (await res.json()) as DraftResponse
}

// Parsed in the browser in both modes; a bad file becomes a 422-style ApiError.
export async function importYaml(text: string): Promise<{ trip: Trip }> {
  try {
    return { trip: parseTripYaml(text) as Trip }
  } catch (e) {
    throw new ApiError(422, e instanceof Error ? e.message : String(e))
  }
}

// The render's (W, H): long side `size`, in the photo's shape when there is one.
function canvasSize(size: number, photo?: { width: number; height: number } | null): [number, number] {
  if (!photo) return [size, size]
  const { width: pw, height: ph } = photo
  return pw >= ph ? [size, Math.round((size * ph) / pw)] : [Math.round((size * pw) / ph), size]
}

// Core's Trip has the optional fields filled in; the editor's leaves them out.
function coreTrip(trip: Trip): CoreTrip {
  return {
    ...trip,
    basemap: trip.basemap ?? 'auto',
    legs: trip.legs.map((l) => ({ ...l, day_trip: l.day_trip ?? false })),
  }
}

// Built with buildSvg and rasterized on a canvas, in this tab. `context` supplies the
// Natural Earth land and road routing (public services, never the tripmap server).
export async function renderTrip(
  trip: Trip,
  opts: RenderOptions = {},
  context: () => Promise<RenderContext> = defaultRenderContext,
): Promise<Blob> {
  const [W, H] = canvasSize(opts.size ?? 4000, opts.photo_size)
  const withDayTrips = opts.with_day_trips ?? false
  const t = coreTrip(trip)
  try {
    const { geo, services } = await context()
    const routes = await routeLegs(t, withDayTrips, services, geo)
    const { svg } = buildSvg(t, W, H, withDayTrips, geo, routes)
    return await rasterizeSvgInBrowser(svg, W, H)
  } catch (e) {
    if (e instanceof TripRenderError) throw new ApiError(422, e.message)
    throw e
  }
}

// Local mode asks tripmap serve (POST /api/yaml); hosted mode writes it with core.
export async function exportYaml(trip: Trip): Promise<string> {
  if (MODE !== 'local') return dumpTripYaml(coreTrip(trip))
  const res = await postJson('/api/yaml', { trip })
  return await res.text()
}

// Local only. tripmap serve does not answer this route yet, so a 404 is reported as
// "not available" in the leg card rather than as a server fault.
export async function suggestMode(
  from: LatLon,
  to: LatLon,
  elapsedHours?: number,
): Promise<{ mode: Mode; reason: string }> {
  const body: { from: LatLon; to: LatLon; elapsed_hours?: number } = { from, to }
  if (elapsedHours !== undefined) body.elapsed_hours = elapsedHours
  try {
    const res = await postJson('/api/suggest-mode', body)
    return (await res.json()) as { mode: Mode; reason: string }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      throw new ApiError(404, 'Mode suggestions are not available from this tripmap serve.')
    }
    throw e
  }
}
