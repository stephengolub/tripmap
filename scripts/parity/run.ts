// Parity run: draft the three example trips with the TypeScript pipeline against the real
// Photos library and write each YAML to ~/.cache/tripmap/parity/<trip>.ts.yaml (never into
// the repo). Prints photo counts only; no coordinates or place names.
//
//   npx tsx scripts/parity/run.ts [--trip ireland|italy|pnw]

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { dumpTripYaml } from '@tripmap/core'
import { createServices, draftFromLibrary } from '@tripmap/core/node'
import { PARITY_DIR, TRIPS } from './trips.ts'

// Draft log lines carry counts and status, but a network error message could echo a
// request URL; strip anything that looks like a coordinate before printing.
const redact = (s: string) => s.replace(/-?\d+\.\d{2,}/g, '<n>').replace(/https?:\/\/\S+/g, '<url>')

async function main() {
  const { values } = parseArgs({ options: { trip: { type: 'string' }, library: { type: 'string' } } })
  const names = values.trip ? [values.trip] : Object.keys(TRIPS)
  for (const n of names) if (!TRIPS[n]) throw new Error(`unknown trip ${n}; expected ${Object.keys(TRIPS).join(', ')}`)
  const library = values.library ?? process.env.TRIPMAP_LIBRARY ?? join(homedir(), 'Pictures', 'Photos Library.photoslibrary')

  mkdirSync(PARITY_DIR, { recursive: true })
  const log = (m: string) => console.error(`    ${redact(m)}`)
  const services = createServices({ log })
  await services.loadGeodata()

  for (const name of names) {
    const { from, to } = TRIPS[name]
    console.log(`${name}: drafting`)
    const { trip, stats } = await draftFromLibrary(library, { from, to, log }, services)
    const out = join(PARITY_DIR, `${name}.ts.yaml`)
    writeFileSync(out, dumpTripYaml(trip, { photoCount: stats.photo_count, start: from, end: to, filename: `${name}.ts.yaml` }))
    writeFileSync(join(PARITY_DIR, `${name}.ts.count`), `${stats.photo_count}\n`)
    console.log(`${name}: ${stats.photo_count} photos, ${trip.stops.length} stops, ${trip.legs.length} legs -> ${out}`)
  }
}

await main()
