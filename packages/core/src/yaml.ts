// The trip as editable YAML text. Ports dump_trip_yaml in src/tripmap/__init__.py; the
// output must match it byte for byte (docs/trip-format.md).

import { parse } from 'yaml'
import type { Basemap, Leg, Trip } from './types.ts'

export type DumpOptions = {
  // Only feed the first header line.
  photoCount?: number
  start?: string // YYYY-MM-DD
  end?: string
  // Only feeds the "tripmap render" hint.
  filename?: string
}

// Python's json.dumps(s, ensure_ascii=False).
const q = (s: string): string => JSON.stringify(s)

// Python's f"{x:.{digits}f}": exact ties round half to even, and -0 keeps its sign.
// toFixed rounds exact ties away from zero, so those are detected from the exact
// decimal expansion (toFixed(100) is exact for coordinate-sized doubles).
export function pyFixed(x: number, digits: number): string {
  const neg = x < 0 || Object.is(x, -0)
  const a = Math.abs(x)
  let out = a.toFixed(digits)
  const [ip, fp = ''] = a.toFixed(100).split('.')
  if (/^50*$/.test(fp.slice(digits))) {
    const last = Number(digits > 0 ? fp[digits - 1] : ip.at(-1))
    if (last % 2 === 0) out = digits > 0 ? `${ip}.${fp.slice(0, digits)}` : ip
  }
  return (neg ? '-' : '') + out
}

export function dumpTripYaml(trip: Trip, opts: DumpOptions = {}): string {
  const { photoCount, start, end, filename = 'trip.yaml' } = opts
  const first =
    photoCount !== undefined
      ? `# tripmap draft from ${photoCount} photos, ${start} to ${end}.`
      : '# tripmap trip.'
  const L = [
    `${first} Edit freely, then:`,
    `#   tripmap render ${filename} --photo <background photo>`,
    '#',
    '# stops: kind = major (red pin) | minor (gold star) | hidden (route passes, no marker)',
    '#        label = auto | n | s | e | w | ne | nw | se | sw | none',
    '#        rename freely; legs refer to stops by name, so rename in both places',
    '# legs:  mode = drive (real roads) | train (real rail lines, train icon) | boat (dashed, ship icon)',
    '#               | flight (dashed arc, plane icon)',
    '#        via = stop names or [lat, lon] route hints, in travel order',
    '#        day_trip: true legs are left out of the plain version and drawn in',
    '#        the "-with-day-trips" version',
    '# basemap: auto | island (whole island, e.g. Ireland) | country | region (cropped, faded edges)',
    '',
    `title: ${q(trip.title ?? '')}`,
    `basemap: ${trip.basemap}`,
    '',
    'stops:',
  ]
  for (const s of trip.stops) {
    let note =
      s.nights && !s.note
        ? `${s.nights} night${s.nights > 1 ? 's' : ''}`
        : `${s.photos ?? 0} photos, ${s.when ?? ''}`
    if (s.note) note += ` (${s.note}; hidden by default)`
    L.push(
      `  - {name: ${q(s.name)}, kind: ${s.kind}, at: [${pyFixed(s.at[0], 4)}, ${pyFixed(s.at[1], 4)}], ` +
        `label: ${s.label ?? 'auto'}}  # ${note}`,
    )
  }
  L.push('')
  if (trip.legs.some((l) => !l.enabled)) {
    L.push(
      '# The flights there and home are commented out (usually just a layover).\n' +
        '# Uncomment them to draw them; their stops are already listed, hidden.',
    )
  }
  L.push('legs:')
  for (const l of trip.legs) {
    const via = l.via
      .map((v) => (typeof v === 'string' ? q(v) : `[${pyFixed(v[0], 3)}, ${pyFixed(v[1], 3)}]`))
      .join(', ')
    L.push(
      `  ${l.enabled ? '' : '# '}- {date: ${l.date}, mode: ${l.mode}, ` +
        `day_trip: ${l.day_trip}, via: [${via}]}`,
    )
  }
  return L.join('\n') + '\n'
}

// Trip YAML text back to a trip. Mirrors trip_import in src/tripmap_api/routes.py.
// Commented-out legs are comments, so they do not come back.
export function parseTripYaml(text: string): Trip {
  let doc: unknown
  try {
    // The core schema plus timestamps, like PyYAML's safe_load turning dates into dates.
    // (The full YAML 1.1 schema would also read `label: n` as false.)
    doc = parse(text, { customTags: ['timestamp'] })
  } catch (e) {
    throw new Error(`Not valid YAML: ${(e as Error).message}`)
  }
  if (!isMapping(doc)) throw new Error('The YAML is not a trip document')
  for (const key of ['stops', 'legs']) {
    const v = doc[key]
    if (!Array.isArray(v) || v.length === 0) throw new Error(`The trip has no ${key}`)
  }
  const legs = (doc.legs as unknown[]).map((leg): Leg => {
    if (!isMapping(leg)) throw new Error('Each leg must be a mapping')
    const date = leg.date instanceof Date ? leg.date.toISOString().slice(0, 10) : leg.date
    return { ...leg, date, day_trip: leg.day_trip ?? false, enabled: leg.enabled ?? true } as Leg
  })
  return { ...doc, basemap: (doc.basemap ?? 'auto') as Basemap, legs } as Trip
}

function isMapping(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)
}
