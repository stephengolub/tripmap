// Node-only: draft straight from a macOS Photos library. The Photos half of build_trip in
// src/tripmap/__init__.py; the rest is draft() in ../draft.ts.

import { draft, type DraftOptions } from '../draft.ts'
import { decodePlaceNames } from '../places.ts'
import type { Services } from '../services.ts'
import type { PhotoPoint } from '../stops.ts'
import type { Stats, Trip } from '../types.ts'
import { readGeotaggedPhotos } from './photos.ts'

const DAY_MS = 86_400_000

/** Geotagged photos taken on the local dates from..to. The library query is padded (1.2
 *  days before local midnight of `from`, 2.2 days after local midnight of `to`, as in the
 *  Python) so time zones cannot cut photos off, then filtered to the exact local dates. */
export function photosForRange(library: string, from: string, to: string): PhotoPoint[] {
  const t0 = new Date(`${from}T00:00:00`).getTime() - 1.2 * DAY_MS
  const t1 = new Date(`${to}T00:00:00`).getTime() + 2.2 * DAY_MS
  return readGeotaggedPhotos(library, t0, t1)
    .filter((p) => from <= p.localIso.slice(0, 10) && p.localIso.slice(0, 10) <= to)
    .map((p) => ({ t: p.ts, local: p.localIso, lat: p.lat, lon: p.lon, place: decodePlaceNames(p.blob) }))
}

export async function draftFromLibrary(
  library: string, opts: DraftOptions, services: Services,
): Promise<{ trip: Trip; stats: Stats }> {
  return draft(opts, services, photosForRange(library, opts.from, opts.to))
}
