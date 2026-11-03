// Parity compare: check each TypeScript draft in ~/.cache/tripmap/parity/<trip>.ts.yaml
// against the Python baseline in ~/.cache/tripmap/regression-baseline/<trip>.yaml.
// Prints one PASS / FAIL / SKIP line per check with counts only: never a name, a
// coordinate, or a path from the trip. Exits 1 when any check fails.
//
//   npx tsx scripts/parity/compare.ts [--trip ireland|italy|pnw]

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { km, parseTripYaml } from '@tripmap/core'
import type { LatLon, Trip } from '@tripmap/core'
import { BASELINE_DIR, PARITY_DIR, TRIPS } from './trips.ts'

const HINT_TOLERANCE_KM = 0.3

export type Side = { trip: Trip; nights: Map<string, number>; photos: number | null }
export type Check = { name: string; ok: boolean; detail: string }

// Draft writes the opening and closing flights as commented-out legs. Uncomment them as
// `enabled: false` so the leg sequence compares them too, the way the web app reads them.
export function readSide(yamlText: string, countText?: string): Side {
  const text = yamlText.replace(/^(\s*)#\s*- \{date:/gm, '$1- {enabled: false, date:')
  const trip = parseTripYaml(text)
  // Nights only live in the YAML comment after each stop: `# 2 nights`.
  const nights = new Map<string, number>()
  for (const line of yamlText.split('\n')) {
    const m = line.match(/name: "((?:[^"\\]|\\.)*)".*kind: major.*#\s*(\d+) nights?/)
    if (m) nights.set(JSON.parse(`"${m[1]}"`), Number(m[2]))
  }
  const header = yamlText.match(/draft from (\d+) photos/)
  const photos = countText ? Number(countText.trim()) : header ? Number(header[1]) : null
  return { trip, nights, photos }
}

// The Python log's first line: `571 geotagged photos, ...`.
export function logPhotoCount(log: string): number | null {
  const m = log.match(/^(\d+) geotagged photos/m)
  return m ? Number(m[1]) : null
}

const sameList = <T>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i])
const sorted = (xs: string[]) => [...xs].sort()
const names = (t: Trip, kind: string) => t.stops.filter((s) => s.kind === kind).map((s) => s.name)
const hints = (via: unknown[]) => via.filter((v): v is LatLon => Array.isArray(v))
const viaNames = (via: unknown[]) => via.filter((v): v is string => typeof v === 'string')

// Count of positions (by index) where two sequences agree, out of the longer length.
function agreement<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number] {
  const n = Math.max(a.length, b.length)
  let same = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (eq(a[i], b[i])) same++
  return [same, n]
}

export function compare(py: Side, ts: Side): Check[] {
  const out: Check[] = []
  const add = (name: string, ok: boolean, detail: string) => out.push({ name, ok, detail })

  add('photo count', py.photos !== null && py.photos === ts.photos, `py ${py.photos ?? '?'}, ts ${ts.photos ?? '?'}`)

  const pyOver = names(py.trip, 'major'), tsOver = names(ts.trip, 'major')
  add('overnight count', pyOver.length === tsOver.length, `py ${pyOver.length}, ts ${tsOver.length}`)
  const tsOverSet = new Set(tsOver)
  const shared = pyOver.filter((n) => tsOverSet.has(n))
  add('overnight names', sameList(sorted(pyOver), sorted(tsOver)), `${shared.length} shared of py ${pyOver.length}, ts ${tsOver.length}`)
  const nightsMatch = shared.filter((n) => py.nights.get(n) === ts.nights.get(n)).length
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
  add(
    'overnight nights',
    shared.length === pyOver.length && nightsMatch === shared.length && sum(py.nights) === sum(ts.nights),
    `${nightsMatch}/${pyOver.length} stops match; total py ${sum(py.nights)}, ts ${sum(ts.nights)}`,
  )

  const pyEn = py.trip.legs.filter((l) => l.enabled), tsEn = ts.trip.legs.filter((l) => l.enabled)
  add('enabled legs', pyEn.length === tsEn.length, `py ${pyEn.length}, ts ${tsEn.length}`)

  const pyLegs = py.trip.legs, tsLegs = ts.trip.legs
  const [dm, dn] = agreement(pyLegs, tsLegs, (a, b) => a.date === b.date && a.mode === b.mode && a.enabled === b.enabled)
  add('leg dates and modes', dm === dn, `${dm}/${dn} legs in order`)
  const [tm, tn] = agreement(pyLegs, tsLegs, (a, b) => a.day_trip === b.day_trip)
  add('day_trip flags', tm === tn, `${tm}/${tn} legs`)
  const [vm, vn] = agreement(pyLegs, tsLegs, (a, b) => sameList(viaNames(a.via), viaNames(b.via)))
  add('via stop names', vm === vn, `${vm}/${vn} legs`)

  const pyHid = names(py.trip, 'hidden'), tsHid = names(ts.trip, 'hidden')
  add('hidden stops', sameList(sorted(pyHid), sorted(tsHid)), `py ${pyHid.length}, ts ${tsHid.length}`)

  // Route hints: only legs at the same index with the same number of hints are compared.
  let compared = 0, within = 0, skipped = 0
  for (let i = 0; i < Math.min(pyLegs.length, tsLegs.length); i++) {
    const a = hints(pyLegs[i].via), b = hints(tsLegs[i].via)
    if (a.length !== b.length) { if (a.length || b.length) skipped++; continue }
    for (let j = 0; j < a.length; j++) {
      compared++
      if (km(a[j], b[j]) <= HINT_TOLERANCE_KM) within++
    }
  }
  add('route hints within 300 m', within === compared, `${within}/${compared} points; ${skipped} legs with different hint counts not compared`)
  return out
}

const CHECK_NAMES = compare(
  { trip: { basemap: 'auto', stops: [], legs: [] }, nights: new Map(), photos: 0 },
  { trip: { basemap: 'auto', stops: [], legs: [] }, nights: new Map(), photos: 0 },
).map((c) => c.name)

function main() {
  const { values } = parseArgs({ options: { trip: { type: 'string' } } })
  const trips = values.trip ? [values.trip] : Object.keys(TRIPS)
  for (const n of trips) if (!TRIPS[n]) throw new Error(`unknown trip ${n}; expected ${Object.keys(TRIPS).join(', ')}`)

  let failed = 0
  for (const trip of trips) {
    const pyYaml = join(BASELINE_DIR, `${trip}.yaml`), pyLog = join(BASELINE_DIR, `${trip}.log`)
    const tsYaml = join(PARITY_DIR, `${trip}.ts.yaml`), tsCount = join(PARITY_DIR, `${trip}.ts.count`)
    const missing = !existsSync(pyYaml) ? 'no Python baseline' : !existsSync(tsYaml) ? 'no TypeScript draft; run run.ts' : null
    if (missing) {
      for (const name of CHECK_NAMES) console.log(`${trip}  ${name}: SKIP (${missing})`)
      continue
    }
    const py = readSide(readFileSync(pyYaml, 'utf8'))
    if (existsSync(pyLog)) py.photos = logPhotoCount(readFileSync(pyLog, 'utf8'))
    const ts = readSide(readFileSync(tsYaml, 'utf8'), existsSync(tsCount) ? readFileSync(tsCount, 'utf8') : undefined)
    for (const c of compare(py, ts)) {
      if (!c.ok) failed++
      console.log(`${trip}  ${c.name}: ${c.ok ? 'PASS' : 'FAIL'} (${c.detail})`)
    }
  }
  console.log(failed ? `${failed} FAIL` : 'all checks PASS')
  process.exitCode = failed ? 1 : 0
}

main()
