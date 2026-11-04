import {
  FetchExhaustedError,
  Geo,
  NE_COUNTRIES,
  NE_LAND,
  NO_STATIONS,
  addOsrmPieces,
  fetchWithRetry,
  naturalEarthUrl,
  type BasemapGeo,
  type Feature,
  type LandGeo,
  type OsrmRouteResponse,
  type RetryOptions,
  type RoadPiece,
  type RouteServices,
} from '@tripmap/core'
import type { LatLon } from '../types/trip'

// What a browser render needs: Natural Earth land for the basemap, and road geometry for
// drive legs. Both come straight from public services (GitHub for Natural Earth, the OSRM
// demo server for roads), never from tripmap serve, so rendering works in hosted mode too.
export type RenderContext = {
  geo: BasemapGeo & LandGeo
  services: RouteServices
}

type Fetch = typeof fetch

// A map-data download that did not work, with a message the user can act on.
export class MapDataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MapDataError'
  }
}

const GITHUB_STATUS = 'https://www.githubstatus.com'

async function features(name: string, fetchFn: Fetch, retry: RetryOptions): Promise<Feature[]> {
  const url = naturalEarthUrl(name)
  const host = new URL(url).host
  let res: Response
  try {
    res = await fetchWithRetry(url, {}, { ...retry, fetchFn })
  } catch (e) {
    if (!(e instanceof FetchExhaustedError)) throw e
    if (e.status === null) {
      throw new MapDataError(
        `Could not reach ${host} to download the ${name} map data (${e.attempts} attempts). ` +
          `Check your internet connection and try again.`,
        { cause: e },
      )
    }
    throw new MapDataError(
      `Could not download the ${name} map data: ${e.message}. Rendering needs it for the basemap, ` +
        `so the map cannot be drawn yet. Trying again in a minute usually works; if it keeps failing, ` +
        `check ${GITHUB_STATUS}.`,
      { cause: e },
    )
  }
  if (!res.ok) {
    throw new MapDataError(
      `The ${name} map data is not available from ${host} (HTTP ${res.status}). Trying again later may help.`,
    )
  }
  return ((await res.json()) as { features: Feature[] }).features
}

// Roads through OSRM, 25 points per request like the CLI. A failed stretch is a straight
// line. Rail and stations are left out: a train leg draws as the smooth off-rails line.
export function browserRouteServices(fetchFn: Fetch = fetch): RouteServices {
  return {
    async road(coords: LatLon[]): Promise<RoadPiece[]> {
      const r = coords.map(([a, b]): LatLon => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000])
      const pieces: RoadPiece[] = []
      for (let i = 0; i < r.length - 1; i += 24) {
        const chunk = r.slice(i, i + 25)
        const cs = chunk.map(([lat, lon]) => `${lon},${lat}`).join(';')
        let data: OsrmRouteResponse
        try {
          const res = await fetchFn(
            `https://router.project-osrm.org/route/v1/driving/${cs}` +
              '?overview=false&steps=true&geometries=geojson&continue_straight=false',
          )
          data = res.ok ? ((await res.json()) as OsrmRouteResponse) : { code: 'Error' }
        } catch {
          data = { code: 'Error' }
        }
        addOsrmPieces(pieces, chunk, data)
      }
      return pieces
    },
    rail: async () => null,
    stations: async () => NO_STATIONS,
  }
}

// Downloads the three Natural Earth files. Countries are fetched up front: Geo loads them
// synchronously. Each download retries transient failures (network, 429, 5xx) with backoff.
export async function loadRenderContext(
  fetchFn: Fetch = fetch,
  retry: Pick<RetryOptions, 'attempts' | 'baseDelayMs' | 'sleep'> = {},
): Promise<RenderContext> {
  const [countries, ...land] = await Promise.all([
    features(NE_COUNTRIES, fetchFn, retry),
    ...NE_LAND.map((n) => features(n, fetchFn, retry)),
  ])
  return { geo: new Geo(land.flat(), () => countries), services: browserRouteServices(fetchFn) }
}

let shared: Promise<RenderContext> | null = null

// One context per tab; a failed download is forgotten so the next render retries.
export function defaultRenderContext(): Promise<RenderContext> {
  if (!shared) {
    shared = loadRenderContext().catch((e) => {
      shared = null
      throw e
    })
  }
  return shared
}
