// Which land to draw under the route, and the lon/lat box it covers. Port of pick_basemap
// in src/tripmap/__init__.py. Pure: geodata comes in as a parameter, so the browser can
// pass its own (pre-simplified) Geo.

import { boxOf, inPolygon, type Box, type Geo, type PolygonCoords } from './geodata.ts'
import type { Basemap, LatLon } from './types.ts'

export type Geometry =
  | { type: 'Polygon'; coordinates: PolygonCoords }
  | { type: 'MultiPolygon'; coordinates: PolygonCoords[] }

export type BasemapGeo = Pick<Geo, 'landPolygons' | 'countryPolygons' | 'classify' | 'countriesAt'>

export type BasemapResult = {
  mode: Exclude<Basemap, 'auto'>
  land: Geometry[] // [lon, lat] coordinates
  bbox: Box // minLon, minLat, maxLon, maxLat
}

const unionBox = (bs: Box[]): Box => [
  Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])),
  Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3])),
]

const grow = (b: Box, f: number): Box => {
  const w = b[2] - b[0], h = b[3] - b[1]
  return [b[0] - w * f, b[1] - h * f, b[2] + w * f, b[3] + h * f]
}

const inside = (g: Box, b: Box) => g[0] >= b[0] && g[1] >= b[1] && g[2] <= b[2] && g[3] <= b[3]
const overlaps = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
const polyBox = (p: PolygonCoords) => boxOf([p[0]])

// Sutherland-Hodgman: one ring clipped to an axis-aligned box. Stands in for shapely's
// intersection with the frame; the extra edges it leaves along the frame are hidden by fill.
function clipRing(ring: number[][], b: Box): number[][] {
  const edges: [(p: number[]) => boolean, (p: number[], q: number[]) => number[]][] = [
    [(p) => p[0] >= b[0], (p, q) => cutX(p, q, b[0])],
    [(p) => p[0] <= b[2], (p, q) => cutX(p, q, b[2])],
    [(p) => p[1] >= b[1], (p, q) => cutY(p, q, b[1])],
    [(p) => p[1] <= b[3], (p, q) => cutY(p, q, b[3])],
  ]
  let out = ring.slice(0, -1) // drop the closing point
  for (const [keep, cut] of edges) {
    const src = out
    out = []
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length]
      if (keep(cur)) {
        if (!keep(prev)) out.push(cut(prev, cur))
        out.push(cur)
      } else if (keep(prev)) out.push(cut(prev, cur))
    }
  }
  return out.length >= 3 ? [...out, out[0]] : []
}
const cutX = (p: number[], q: number[], x: number) => [x, p[1] + ((q[1] - p[1]) * (x - p[0])) / (q[0] - p[0])]
const cutY = (p: number[], q: number[], y: number) => [p[0] + ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1]), y]

function clipPolygon(p: PolygonCoords, b: Box): PolygonCoords | null {
  const outer = clipRing(p[0], b)
  if (!outer.length) return null
  return [outer, ...p.slice(1).map((r) => clipRing(r, b)).filter((r) => r.length)]
}

export function pickBasemap(geo: BasemapGeo, mode: Basemap, tripLatLons: LatLon[], aspect = 1.0): BasemapResult {
  const lons = tripLatLons.map((p) => p[1]), lats = tripLatLons.map((p) => p[0])
  const tripBox: Box = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
  const masses = [...new Set(tripLatLons.map(([la, lo]) => geo.classify(la, lo).landmass))]
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b)
  const land = geo.landPolygons
  const landBoxes = masses.map((i) => polyBox(land[i]))

  if (mode === 'auto') {
    const small = landBoxes.every((b) => Math.max((b[2] - b[0]) * 0.6, b[3] - b[1]) < 12)
    mode = masses.length && small ? 'island' : 'country'
  }
  if (mode === 'island') {
    const g = grow(unionBox(landBoxes), 0.03)
    const main: Box = [
      Math.min(g[0], tripBox[0]), Math.min(g[1], tripBox[1]), Math.max(g[2], tripBox[2]), Math.max(g[3], tripBox[3]),
    ]
    const keep = land.filter((p) => inside(polyBox(p), main)).map((p): Geometry => ({ type: 'Polygon', coordinates: p }))
    return { mode, land: keep, bbox: main }
  }
  if (mode === 'country') {
    const geoms: { geom: Geometry; box: Box }[] = []
    for (const ci of geo.countriesAt(tripLatLons)) {
      const ps = geo.countryPolygons[ci].polys
      const hits = ps.filter((p) => tripLatLons.some(([la, lo]) => inPolygon(p, lo, la)))
      const keepBox = grow(unionBox((hits.length ? hits : ps).map(polyBox)), 0.25)
      const kept = ps.filter((p) => inside(polyBox(p), keepBox))
      geoms.push({ geom: { type: 'MultiPolygon', coordinates: kept }, box: unionBox(kept.map(polyBox)) })
    }
    if (geoms.length) {
      const b = unionBox(geoms.map((g) => g.box))
      const tbArea = Math.max(tripBox[2] - tripBox[0], 1.0) * Math.max(tripBox[3] - tripBox[1], 1.0)
      if ((b[2] - b[0]) * (b[3] - b[1]) <= 12 * tbArea) return { mode, land: geoms.map((g) => g.geom), bbox: b }
    }
  }
  // region: crop around the trip, edges faded
  let w = Math.max(tripBox[2] - tripBox[0], 1.5), h = Math.max(tripBox[3] - tripBox[1], 1.0)
  const cx = (tripBox[0] + tripBox[2]) / 2, cy = (tripBox[1] + tripBox[3]) / 2
  const kx = Math.cos((cy * Math.PI) / 180)
  w *= 0.85 // half-sizes, with margin
  h *= 0.85
  if ((w * kx) / h < aspect) w = (h * aspect) / kx
  else h = (w * kx) / aspect
  const b: Box = [cx - w, cy - h, cx + w, cy + h]
  const cropped: Geometry[] = []
  for (const c of geo.countryPolygons) {
    if (!overlaps(c.box, b)) continue
    const polys = c.polys.map((p) => clipPolygon(p, b)).filter((p): p is PolygonCoords => p !== null)
    if (polys.length) cropped.push({ type: 'MultiPolygon', coordinates: polys })
  }
  return { mode: 'region', land: cropped, bbox: b }
}
