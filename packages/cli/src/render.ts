// `tripmap render`: draw a trip YAML as transparent PNG overlay(s), with buildSvg from core
// and resvg instead of headless Chrome. Port of cmd_render in src/tripmap/__init__.py.
// The preview on the photo is composited with resvg too and needs only a JPEG encoder:
// macOS `sips`, which every Mac has. Without one the preview is skipped with a notice.

import { execFileSync } from 'node:child_process'
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, extname, join } from 'node:path'
import type { BasemapGeo, LandGeo, RouteServices } from '@tripmap/core'
import { ImageInfoError, displaySize, imageInfo, orientationTransform } from './image-info.ts'

export interface RenderCommand {
  trip: string
  photo?: string
  size: number
  out?: string
  /** Only the with-day-trips variant. */
  dayTrips: boolean
  /** 'route' zooms to the route and fades the edges; 'basemap' follows the trip's basemap setting. */
  frame?: 'basemap' | 'route'
}

/** Land for the basemap and routing for the legs. */
export interface RenderContext {
  geo: BasemapGeo & LandGeo
  services: RouteServices
}

/** Encodes PNG bytes as a JPEG file at `quality` (0..100). */
export type JpegEncoder = (png: Uint8Array, path: string, quality: number) => void

export interface RenderDeps {
  prepare?: (log: (line: string) => void) => Promise<RenderContext>
  /** `null` means no encoder; undefined looks for `sips`. */
  jpeg?: JpegEncoder | null
  stdout?: (text: string) => void
  stderr?: (text: string) => void
}

/** The real context: Natural Earth from the cache (downloaded once) and OSRM roads. */
async function prepareReal(log: (line: string) => void): Promise<RenderContext> {
  const { createServices } = await import('@tripmap/core/node')
  const services = createServices({ log })
  const geo = await services.loadGeodata()
  return { geo, services: { ...services, road: (coords) => services.net.route(coords) } }
}

/** `sips` as a JPEG encoder, when it is on PATH (macOS). */
export function findSipsEncoder(path = process.env.PATH ?? ''): JpegEncoder | null {
  const sips = [...path.split(delimiter), '/usr/bin'].filter(Boolean).map((d) => join(d, 'sips')).find((p) => {
    try {
      accessSync(p, constants.X_OK)
      return true
    } catch {
      return false
    }
  })
  if (!sips) return null
  return (png, out, quality) => {
    const dir = mkdtempSync(join(tmpdir(), 'tripmap-'))
    try {
      const tmp = join(dir, 'preview.png')
      writeFileSync(tmp, png)
      execFileSync(sips, ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), tmp, '--out', out], { stdio: 'ignore' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** (W, H) for a render whose long side is `size`, shaped like the photo if one is given. */
export function canvasSize(size: number, photo?: [number, number]): [number, number] {
  if (!photo) return [size, size]
  const [pw, ph] = photo
  return pw >= ph ? [size, Math.round((size * ph) / pw)] : [Math.round((size * pw) / ph), size]
}

/** The output stem: the YAML's name lowercased, runs of other characters as one hyphen. */
export function slugFor(tripPath: string): string {
  const stem = basename(tripPath, extname(tripPath))
  return stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'trip'
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

/**
 * The overlay laid on the upright photo, shrunk to fit 1600 px like the Python's
 * `-resize 1600x1600>`. Returns PNG bytes for the JPEG encoder.
 */
function previewPng(photo: Uint8Array, overlay: Uint8Array, rasterize: (svg: string, w: number, h: number) => Uint8Array): Uint8Array {
  const info = imageInfo(photo)
  const [pw, ph] = displaySize(info)
  const scale = Math.min(1, 1600 / Math.max(pw, ph))
  const w = Math.max(1, Math.round(pw * scale)), h = Math.max(1, Math.round(ph * scale))
  const turn = orientationTransform(info.orientation, info.width, info.height)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<g transform="scale(${w / pw} ${h / ph})">
<image width="${info.width}" height="${info.height}"${turn ? ` transform="${turn}"` : ''} href="data:${info.mime};base64,${b64(photo)}"/>
<image width="${pw}" height="${ph}" preserveAspectRatio="none" href="data:image/png;base64,${b64(overlay)}"/>
</g></svg>`
  return rasterize(svg, w, h)
}

/** Run `render` and return the exit code. */
export async function runRender(cmd: RenderCommand, deps: RenderDeps = {}): Promise<number> {
  const out = deps.stdout ?? ((text: string) => void process.stdout.write(text))
  const err = deps.stderr ?? ((text: string) => void process.stderr.write(text))
  const log = (line: string) => err(`${line}\n`)
  const fail = (msg: string) => {
    err(`tripmap: ${msg}\n`)
    return 1
  }

  const { TripRenderError, buildSvg, parseTripYaml, routeLegs } = await import('@tripmap/core')
  const { rasterizeSvg } = await import('@tripmap/core/node')

  let text: string
  try {
    text = readFileSync(cmd.trip, 'utf8')
  } catch (e) {
    return fail(`cannot read ${cmd.trip} (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`)
  }
  let trip
  try {
    trip = parseTripYaml(text)
  } catch (e) {
    return fail(`${cmd.trip}: ${(e as Error).message}`)
  }

  let photo: Uint8Array | undefined
  let photoSize: [number, number] | undefined
  if (cmd.photo) {
    try {
      photo = new Uint8Array(readFileSync(cmd.photo))
      photoSize = displaySize(imageInfo(photo))
    } catch (e) {
      if (e instanceof ImageInfoError) return fail(`--photo: ${e.message}`)
      return fail(`cannot read the photo (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`)
    }
  }
  const [W, H] = canvasSize(cmd.size, photoSize)

  const outDir = cmd.out ?? dirname(cmd.trip)
  mkdirSync(outDir, { recursive: true })
  const slug = slugFor(cmd.trip)
  const hasDayTrips = trip.legs.some((l) => l.day_trip && l.enabled !== false)
  const variants: [boolean, string][] = []
  if (cmd.dayTrips && hasDayTrips) {
    variants.push([true, `${slug}-with-day-trips.png`])
  } else {
    if (cmd.dayTrips) log('tripmap: the trip has no day-trip legs; rendering the plain map')
    variants.push([false, `${slug}.png`])
    if (hasDayTrips && !cmd.dayTrips) variants.push([true, `${slug}-with-day-trips.png`])
  }

  const ctx = await (deps.prepare ?? prepareReal)(log)
  const jpeg = deps.jpeg === undefined ? findSipsEncoder() : deps.jpeg
  if (photo && !jpeg) log('tripmap: no JPEG encoder found (macOS sips); skipping the preview on your photo')

  for (const [withDayTrips, name] of variants) {
    let svg: string, mode: string
    try {
      const routes = await routeLegs(trip, withDayTrips, ctx.services, ctx.geo, log)
      ;({ svg, mode } = buildSvg(trip, W, H, withDayTrips, ctx.geo, routes, { frame: cmd.frame ?? 'basemap' }))
    } catch (e) {
      if (e instanceof TripRenderError) return fail(`${cmd.trip}: ${e.message}`)
      throw e
    }
    const png = rasterizeSvg(svg, W, H)
    const pngPath = join(outDir, name)
    writeFileSync(pngPath, png)
    out(`${pngPath}  (${W}x${H}, transparent, basemap: ${mode})\n`)
    if (photo && jpeg) {
      const prev = join(outDir, name.replace(/\.png$/, '-preview.jpg'))
      jpeg(previewPng(photo, png, rasterizeSvg), prev, 88)
      out(`${prev}  (preview on your photo)\n`)
    }
  }
  return 0
}
