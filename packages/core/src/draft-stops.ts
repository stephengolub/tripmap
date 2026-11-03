// The photo-to-stops half of a draft: build_trip in src/tripmap/__init__.py from the
// land/sea pass through quick-stop naming, stopping before the per-day node sequences and
// leg modes (phase 05). No Photos access and no network: every lookup goes through
// Services. Browser-safe.

import type { Services } from './services.ts'
import {
  buildClusters, classifyPoints, markCoastalSea, nameBases, nightsFromPhotos, quickStops,
  type Cluster, type DraftStop, type Log, type PhotoPoint, type Point,
} from './stops.ts'

export interface BuildStopsOptions {
  /** Progress messages: counts and status only, never coordinates or paths. */
  log?: Log
}

export interface StopsResult {
  /** Quick stops (minor and hidden), in photo order. */
  stops: DraftStop[]
  /** Named, merged overnight bases. */
  bases: DraftStop[]
  /** Local date to the base slept at the night after it. */
  nights: Map<string, DraftStop>
  clusters: Cluster[]
  points: Point[]
  /** Local dates with photos, sorted, and each date's photos in order (for leg building). */
  dates: string[]
  byDay: Map<string, Point[]>
}

/** Photos in time order to overnight bases and quick stops. Every stop cluster ends up
 *  with `ref` set to its stop or base (null when it is near neither). */
export async function buildStops(
  photos: readonly PhotoPoint[], services: Services, opts: BuildStopsOptions = {},
): Promise<StopsResult> {
  const { log } = opts
  const points = classifyPoints(photos, services)
  const clusters = buildClusters(points)
  await markCoastalSea(points, services, log)
  const { dates, byDay, bases: raw, nights } = nightsFromPhotos(points)
  const bases = await nameBases(raw, nights, points, services, log)
  const stops = await quickStops(clusters, bases, services, log)
  return { stops, bases, nights, clusters, points, dates, byDay }
}
