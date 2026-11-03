import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeServices, Geo, type Feature } from '@tripmap/core'
import { rasterizeSvg } from '@tripmap/core/node'
import { displaySize, imageInfo } from '../src/image-info.ts'
import { canvasSize, findSipsEncoder, runRender, slugFor, type RenderDeps } from '../src/render.ts'

// Synthetic only: an invented 4-degree island and invented stop names, nothing from Photos.
const square = (x0: number, y0: number, s: number) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]]
const island: Feature = { geometry: { type: 'Polygon', coordinates: [square(10, 10, 4)] } }
const geo = new Geo([island], () => [island])

const TRIP = `title: Synthetic Island
basemap: island
stops:
  - {name: North, kind: major, at: [13.5, 11], nights: 2}
  - {name: South, kind: major, at: [10.5, 11], nights: 1}
  - {name: Lookout, kind: minor, at: [12, 12]}
legs:
  - {date: 2001-02-03, mode: drive, via: [South, North]}
  - {date: 2001-02-04, mode: drive, day_trip: true, via: [North, Lookout, North]}
`
const PLAIN = TRIP.replace(/  - \{date: 2001-02-04.*\n/, '')

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const isPng = (path: string) => PNG_SIGNATURE.every((b, i) => readFileSync(path)[i] === b)
const size = (path: string) => {
  const info = imageInfo(new Uint8Array(readFileSync(path)))
  return [info.width, info.height]
}

let dir: string
const out: string[] = []
const err: string[] = []
const deps = (extra: RenderDeps = {}): RenderDeps => ({
  prepare: async () => ({ geo, services: { ...FakeServices(), road: async (ll) => [['drive', ll]] } }),
  jpeg: null,
  stdout: (t) => out.push(t),
  stderr: (t) => err.push(t),
  ...extra,
})

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tripmap-render-'))
  writeFileSync(join(dir, 'My Trip!.yaml'), TRIP)
  writeFileSync(join(dir, 'plain.yaml'), PLAIN)
  // A 300x200 landscape "photo".
  writeFileSync(join(dir, 'bg.png'), rasterizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#3a7"/></svg>', 300, 200))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('render', () => {
  it('writes <stem>.png and <stem>-with-day-trips.png as transparent PNGs', async () => {
    const code = await runRender({ trip: join(dir, 'My Trip!.yaml'), size: 400, dayTrips: false, out: join(dir, 'a') }, deps())
    expect(code).toBe(0)
    expect(readdirSync(join(dir, 'a')).sort()).toEqual(['my-trip.png', 'my-trip-with-day-trips.png'].sort())
    for (const f of ['my-trip.png', 'my-trip-with-day-trips.png']) {
      expect(isPng(join(dir, 'a', f))).toBe(true)
      expect(size(join(dir, 'a', f))).toEqual([400, 400])
    }
    expect(out.join('')).toContain('(400x400, transparent, basemap: island)')
  })

  it('writes only <stem>.png when there are no day-trip legs, next to the YAML by default', async () => {
    expect(await runRender({ trip: join(dir, 'plain.yaml'), size: 300, dayTrips: false }, deps())).toBe(0)
    expect(isPng(join(dir, 'plain.png'))).toBe(true)
    expect(existsSync(join(dir, 'plain-with-day-trips.png'))).toBe(false)
  })

  it('--day-trips writes only the with-day-trips variant', async () => {
    expect(await runRender({ trip: join(dir, 'My Trip!.yaml'), size: 200, dayTrips: true, out: join(dir, 'b') }, deps())).toBe(0)
    expect(readdirSync(join(dir, 'b'))).toEqual(['my-trip-with-day-trips.png'])
  })

  it('shapes the render like --photo and skips the preview without a JPEG encoder', async () => {
    err.length = 0
    const code = await runRender({ trip: join(dir, 'plain.yaml'), photo: join(dir, 'bg.png'), size: 600, dayTrips: false, out: join(dir, 'c') }, deps())
    expect(code).toBe(0)
    expect(size(join(dir, 'c', 'plain.png'))).toEqual([600, 400])
    expect(readdirSync(join(dir, 'c'))).toEqual(['plain.png'])
    expect(err.join('')).toMatch(/no JPEG encoder/)
  })

  it('composites the preview and hands it to the JPEG encoder', async () => {
    const encoded: [number[], string, number][] = []
    const jpeg = (png: Uint8Array, path: string, q: number) => {
      encoded.push([Array.from(png.slice(0, 8)), path, q])
      expect(size2(png)).toEqual([300, 200]) // under 1600, so the photo's own size
    }
    const size2 = (png: Uint8Array) => { const i = imageInfo(png); return [i.width, i.height] }
    const code = await runRender({ trip: join(dir, 'plain.yaml'), photo: join(dir, 'bg.png'), size: 600, dayTrips: false, out: join(dir, 'd') }, deps({ jpeg }))
    expect(code).toBe(0)
    expect(encoded).toHaveLength(1)
    expect(encoded[0]![0]).toEqual(PNG_SIGNATURE)
    expect(encoded[0]![1]).toBe(join(dir, 'd', 'plain-preview.jpg'))
    expect(encoded[0]![2]).toBe(88)
  })

  it.skipIf(!findSipsEncoder())('writes a real JPEG preview with sips', async () => {
    const code = await runRender({ trip: join(dir, 'plain.yaml'), photo: join(dir, 'bg.png'), size: 300, dayTrips: false, out: join(dir, 'e') }, deps({ jpeg: undefined }))
    expect(code).toBe(0)
    const jpg = readFileSync(join(dir, 'e', 'plain-preview.jpg'))
    expect([jpg[0], jpg[1]]).toEqual([0xff, 0xd8])
    expect(size(join(dir, 'e', 'plain-preview.jpg'))).toEqual([300, 200])
  })

  it('exits 1 with a message for a missing file or a trip with a bad leg', async () => {
    err.length = 0
    expect(await runRender({ trip: join(dir, 'nope.yaml'), size: 200, dayTrips: false }, deps())).toBe(1)
    writeFileSync(join(dir, 'bad.yaml'), PLAIN.replace('via: [South, North]', 'via: [South, Nowhere]'))
    expect(await runRender({ trip: join(dir, 'bad.yaml'), size: 200, dayTrips: false }, deps())).toBe(1)
    expect(err.join('')).toMatch(/cannot read .*nope\.yaml[\s\S]*Nowhere/)
  })
})

describe('render helpers', () => {
  it('canvasSize matches the Python', () => {
    expect(canvasSize(4000)).toEqual([4000, 4000])
    expect(canvasSize(4000, [3000, 2000])).toEqual([4000, 2667])
    expect(canvasSize(4000, [2000, 3000])).toEqual([2667, 4000])
  })

  it('slugFor matches the Python', () => {
    expect(slugFor('/x/My Trip!.yaml')).toBe('my-trip')
    expect(slugFor('/x/!!!.yaml')).toBe('trip')
  })

  it('reads JPEG size and EXIF orientation', () => {
    if (!findSipsEncoder()) return
    const jpgPath = join(dir, 'raw.jpg')
    execFileSync('sips', ['-s', 'format', 'jpeg', join(dir, 'bg.png'), '--out', jpgPath], { stdio: 'ignore' })
    const jpg = readFileSync(jpgPath)
    // Splice an EXIF block with Orientation = 6 (rotate 90) in right after SOI.
    const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0])
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff])
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body])
    const info = imageInfo(new Uint8Array(Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)])))
    expect(info).toMatchObject({ mime: 'image/jpeg', width: 300, height: 200, orientation: 6 })
    expect(displaySize(info)).toEqual([200, 300])
  })
})
