import type { LatLon, Mode, Stats, Trip } from '../types/trip'

// Typed calls to tripmap-api. Every path is relative (/api/...): the Vite dev server
// proxies it to 127.0.0.1:8000, so the browser never talks to the backend port directly.

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

// FastAPI errors are {"detail": "..."} from the handlers, or {"detail": [{msg}, ...]}
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

async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError(0, 'Could not reach the tripmap server. Is tripmap-api running?')
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

export async function draftTrip(start: string, end: string, title?: string): Promise<DraftResponse> {
  const body: { start: string; end: string; title?: string } = { start, end }
  if (title) body.title = title
  const res = await postJson('/api/trips/draft', body)
  return (await res.json()) as DraftResponse
}

export async function importYaml(text: string): Promise<{ trip: Trip }> {
  const res = await request('/api/trips/import', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: text,
  })
  return (await res.json()) as { trip: Trip }
}

export async function renderTrip(trip: Trip, opts: RenderOptions = {}): Promise<Blob> {
  const res = await postJson('/api/trips/render', { trip, ...opts })
  return await res.blob()
}

export async function exportYaml(trip: Trip): Promise<string> {
  const res = await postJson('/api/trips/yaml', { trip })
  return await res.text()
}

export async function suggestMode(
  from: LatLon,
  to: LatLon,
  elapsedHours?: number,
): Promise<{ mode: Mode; reason: string }> {
  const body: { from: LatLon; to: LatLon; elapsed_hours?: number } = { from, to }
  if (elapsedHours !== undefined) body.elapsed_hours = elapsedHours
  const res = await postJson('/api/legs/suggest-mode', body)
  return (await res.json()) as { mode: Mode; reason: string }
}
