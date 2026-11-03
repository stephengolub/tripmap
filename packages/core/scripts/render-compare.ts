// Visual check against the Python render: draws the Italy regression baseline at 800 px
// with the TypeScript renderer and compares it with the Python PNG using ImageMagick.
// Both images stay under ~/.cache/tripmap; nothing is written to the repo, and only
// counts are printed (no coordinates, no place names).
//
//   node --no-warnings --experimental-strip-types packages/core/scripts/render-compare.ts

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSvg, parseTripYaml, routeLegs } from '../src/index.ts'
import { createServices, defaultCacheDir, rasterizeSvg } from '../src/node/index.ts'

const SIZE = 800
const cache = defaultCacheDir()
const baseline = join(cache, 'regression-baseline')
const outDir = join(cache, 'ts-render')
const outPng = join(outDir, 'italy.png')
const pyPng = join(baseline, 'italy.png')

const trip = parseTripYaml(readFileSync(join(baseline, 'italy.yaml'), 'utf8'))
const services = createServices()
const geo = await services.loadGeodata()
const routes = await routeLegs(trip, false, { ...services, road: (coords) => services.net.route(coords) }, geo)
const { svg, mode } = buildSvg(trip, SIZE, SIZE, false, geo, routes)
mkdirSync(outDir, { recursive: true })
writeFileSync(outPng, rasterizeSvg(svg, SIZE, SIZE))
console.log(`wrote ${SIZE}x${SIZE} TypeScript render (basemap: ${mode})`)

// Bring both images to the same size first; the baseline is normally 800x800 already.
const size = `${SIZE}x${SIZE}!`
const a = join(outDir, 'cmp-ts.png'), b = join(outDir, 'cmp-py.png')
execFileSync('magick', [outPng, '-resize', size, a])
execFileSync('magick', [pyPng, '-resize', size, b])

// compare prints the metric on stderr and exits 1 when the images differ.
const metric = (name: string, extra: string[] = []): string => {
  try {
    execFileSync('compare', ['-metric', name, ...extra, a, b, 'null:'], { stdio: ['ignore', 'ignore', 'pipe'] })
    return '0'
  } catch (e) {
    const err = e as { status?: number; stderr?: Buffer }
    if (err.status !== 1) throw e
    return String(err.stderr).trim()
  }
}
const ae = Number.parseFloat(metric('AE'))
const ae5 = Number.parseFloat(metric('AE', ['-fuzz', '5%']))
const total = SIZE * SIZE
console.log(`AE (exact):    ${ae} of ${total} pixels differ (${((100 * ae) / total).toFixed(2)}%)`)
console.log(`AE (fuzz 5%):  ${ae5} of ${total} pixels differ (${((100 * ae5) / total).toFixed(2)}%)`)
console.log(`RMSE:          ${metric('RMSE')}`)
