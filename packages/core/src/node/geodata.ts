// Node-only: loading Natural Earth land, minor islands and countries. Port of
// natural_earth in src/tripmap/__init__.py. Files land in the same cache dir (`ne/`) as
// the Python, so the two versions share one download. The Geo itself is pure (../geodata.ts).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Geo, NE_COUNTRIES, NE_LAND, naturalEarthUrl, type Feature } from '../geodata.ts'
import { FetchExhaustedError, fetchWithRetry, type RetryOptions } from '../retry.ts'
import type { Log } from '../stops.ts'

export { Geo, NE_COUNTRIES, NE_LAND, naturalEarthUrl, type Feature }

// The path to a Natural Earth file, downloading it once when it is missing. Written to a
// temp name and renamed, so an interrupted download never leaves a truncated file behind.
export async function ensureNaturalEarth(
  neDir: string,
  name: string,
  opts: { userAgent: string; log?: Log; retry?: Pick<RetryOptions, 'attempts' | 'baseDelayMs' | 'sleep'> } = { userAgent: 'tripmap' },
): Promise<string> {
  const path = join(neDir, `${name}.geojson`)
  if (existsSync(path)) return path
  mkdirSync(neDir, { recursive: true })
  opts.log?.(`downloading ${name} (one-time)...`)
  let res: Response
  try {
    res = await fetchWithRetry(naturalEarthUrl(name), { headers: { 'User-Agent': opts.userAgent } }, {
      ...opts.retry,
      onRetry: ({ attempt, reason, delayMs }) =>
        opts.log?.(`  ${name}: ${reason}, retrying in ${delayMs / 1000}s (attempt ${attempt + 1})`),
    })
  } catch (e) {
    if (e instanceof FetchExhaustedError) {
      throw new Error(`downloading ${name} failed: ${e.message}. Try again later, or check https://www.githubstatus.com.`)
    }
    throw e
  }
  if (!res.ok) throw new Error(`downloading ${name} failed: HTTP ${res.status} from ${new URL(naturalEarthUrl(name)).host}`)
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
