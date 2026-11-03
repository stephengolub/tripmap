// Node-only: loading Natural Earth land, minor islands and countries. Port of
// natural_earth in src/tripmap/__init__.py. Files land in the same cache dir (`ne/`) as
// the Python, so the two versions share one download. The Geo itself is pure (../geodata.ts).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Geo, type Feature } from '../geodata.ts'
import type { Log } from '../stops.ts'

export { Geo, type Feature }

export const NE_LAND = ['ne_10m_land', 'ne_10m_minor_islands'] as const
export const NE_COUNTRIES = 'ne_10m_admin_0_countries'

export const naturalEarthUrl = (name: string) =>
  `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/${name}.geojson`

// The path to a Natural Earth file, downloading it once when it is missing. Written to a
// temp name and renamed, so an interrupted download never leaves a truncated file behind.
export async function ensureNaturalEarth(
  neDir: string,
  name: string,
  opts: { userAgent: string; log?: Log } = { userAgent: 'tripmap' },
): Promise<string> {
  const path = join(neDir, `${name}.geojson`)
  if (existsSync(path)) return path
  mkdirSync(neDir, { recursive: true })
  opts.log?.(`downloading ${name} (one-time)...`)
  const res = await fetch(naturalEarthUrl(name), { headers: { 'User-Agent': opts.userAgent } })
  if (!res.ok) throw new Error(`downloading ${name} failed: HTTP ${res.status}`)
  const tmp = `${path}.part`
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
  renameSync(tmp, path)
  return path
}

export function readFeatures(path: string): Feature[] {
  return JSON.parse(readFileSync(path, 'utf8')).features
}

// Downloads anything missing, then builds the Geo. Countries load on first countriesAt.
export async function loadGeo(neDir: string, opts: { userAgent: string; log?: Log }): Promise<Geo> {
  const land: Feature[] = []
  for (const name of NE_LAND) land.push(...readFeatures(await ensureNaturalEarth(neDir, name, opts)))
  const countriesPath = await ensureNaturalEarth(neDir, NE_COUNTRIES, opts)
  return new Geo(land, () => readFeatures(countriesPath))
}
