// The real draft behind `tripmap draft`: Photos library in, trip YAML and summary out.
// Imported lazily by draft.ts, so only a real draft loads core, sqlite and the network code.

import { dumpTripYaml } from '@tripmap/core'
import { createServices, draftFromLibrary } from '@tripmap/core/node'
import type { DraftRequest, DraftResult } from './draft.ts'
import type { DetectFn } from './serve.ts'

/** The trip and stats for a date range: what `POST /api/detect` returns. */
export const detectFromPhotos: DetectFn = async (req) => {
  const services = createServices({ log: req.log })
  await services.loadGeodata()
  return draftFromLibrary(req.library, { from: req.from, to: req.to, title: req.title, log: req.log }, services)
}

export async function draftFromPhotos(req: DraftRequest): Promise<DraftResult> {
  const { trip, stats } = await detectFromPhotos(req)
  const yaml = dumpTripYaml(trip, { photoCount: stats.photo_count, start: req.from, end: req.to, filename: req.filename })

  // cmd_draft's summary in src/tripmap/__init__.py.
  const nights = new Map(trip.stops.map((s) => [s.name, s.nights]))
  const summary = [
    `  ${stats.overnight_names.length} overnight stops: ${stats.overnight_names.map((n) => `${n} (${nights.get(n)})`).join(', ')}`,
    `  ${stats.quick_names.length} quick stops: ${stats.quick_names.join(', ')}`,
  ]
  if (stats.hidden_names.length) summary.push(`  hidden: ${stats.hidden_names.join(', ')}`)
  const dayTripDays = new Set(trip.legs.filter((l) => l.day_trip).map((l) => l.date)).size
  summary.push(`  legs: ${Object.entries(stats.leg_counts).map(([k, v]) => `${v} ${k}`).join(', ')}; ${dayTripDays} day-trip days`)
  return { yaml, summary }
}
