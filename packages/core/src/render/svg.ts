// The map as an SVG string. Port of Canvas and build_svg in src/tripmap/__init__.py,
// layer for layer: land, route shadows, white strokes (roads, ferries, train track with
// cross-ties, dashed boat and flight paths), badges, markers, then labels on top.
// Pure and synchronous: geodata comes in as `geo` and leg geometry as `routes` (see
// routes.ts), so it runs in the browser. The style is fixed (CLAUDE.md); no options.

import { pickBasemap, type BasemapGeo, type Geometry } from '../basemap.ts'
import type { Box, PolygonCoords } from '../geodata.ts'
import { fmt1, midpoint, thin, type XY } from '../geo.ts'
import type { LatLon, Trip } from '../types.ts'
import { NAVY, STAR, badgeSvg, lineD, pinSvg, polyD, smoothD, starPoints } from './helpers.ts'
import { Labeler, type LabelBox } from './labeler.ts'
import { TripRenderError, boatPath, drawnLegs, resolver, type LegRoute } from './routes.ts'

// Equirectangular projection that fits bbox into w x h with 7% margins on each side.
export class Canvas {
  readonly kx: number
  readonly s: number
  readonly ox: number
  readonly oy: number
  readonly w: number
  readonly h: number

  constructor(w: number, h: number, bbox: Box) {
    this.w = w
    this.h = h
    const lat0 = (bbox[1] + bbox[3]) / 2
    this.kx = Math.cos((lat0 * Math.PI) / 180)
    const bw = (bbox[2] - bbox[0]) * this.kx
    const bh = bbox[3] - bbox[1]
    this.s = Math.min((w * 0.86) / bw, (h * 0.86) / bh)
    this.ox = w / 2 - ((this.s * (bbox[0] + bbox[2])) / 2) * this.kx
    this.oy = h / 2 + (this.s * (bbox[1] + bbox[3])) / 2
  }

  at(lat: number, lon: number): XY {
    return [this.ox + this.s * lon * this.kx, this.oy - this.s * lat]
  }

  // A [lon, lat] geometry projected to pixels and simplified to `tol` pixels.
  geom(g: Geometry, tol: number): Geometry {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    const out: PolygonCoords[] = []
    for (const p of polys) {
      const rings = p.map((r) => simplifyRing(r.map(([lo, la]) => [this.ox + this.s * lo * this.kx, this.oy - this.s * la]), tol))
      if (rings[0].length >= 4) out.push(rings.filter((r) => r.length >= 4))
    }
    return { type: 'MultiPolygon', coordinates: out }
  }
}

// Douglas-Peucker on a closed ring (shapely's simplify), keeping the closing point.
function simplifyRing(ring: number[][], tol: number): number[][] {
  if (ring.length <= 4) return ring
  const keep = new Uint8Array(ring.length)
  keep[0] = keep[ring.length - 1] = 1
  // A closed ring's ends coincide, so split it at the point farthest from the start.
  let far = 0, farD = -1
  for (let i = 1; i < ring.length - 1; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1])
    if (d > farD) [far, farD] = [i, d]
  }
  keep[far] = 1
  const stack: [number, number][] = [[0, far], [far, ring.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    const [ax, ay] = ring[i], [bx, by] = ring[j]
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy)
    let best = -1, bestD = tol
    for (let k = i + 1; k < j; k++) {
      const d = len ? Math.abs(dy * (ring[k][0] - ax) - dx * (ring[k][1] - ay)) / len : Math.hypot(ring[k][0] - ax, ring[k][1] - ay)
      if (d > bestD) [best, bestD] = [k, d]
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([i, best], [best, j])
    }
  }
  return ring.filter((_, i) => keep[i])
}

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1])

// `routes` is indexed like trip.legs (routeLegs makes it). A drawn leg without a route
// falls back to what the Python draws when routing fails: straight road pieces, a smooth
// train line off the rails, and a boat path bent out to sea from `geo`'s land.
export function buildSvg(
  trip: Trip, W: number, H: number, withDayTrips: boolean, geo: BasemapGeo, routes: (LegRoute | undefined)[] = [],
): { svg: string; mode: string } {
  const u = Math.max(W, H) / 4000
  const resolve = resolver(trip)
  // Disabled legs are left out entirely, the same as a commented-out leg in the YAML.
  const enabled = trip.legs.filter((l) => l.enabled !== false)
  const legs = drawnLegs(trip, withDayTrips)

  const allLL: LatLon[] = [
    ...enabled.flatMap((l) => l.via.map(resolve)),
    ...trip.stops.filter((s) => (s.kind ?? 'minor') !== 'hidden').map((s): LatLon => [s.at[0], s.at[1]]),
  ]
  const { mode, land, bbox } = pickBasemap(geo, trip.basemap ?? 'auto', allLL, W / H)
  const P = new Canvas(W, H, bbox)
  const at = (ll: LatLon) => P.at(ll[0], ll[1])

  const lw = 15 * u
  const tl = P.at(bbox[3], bbox[0]), br = P.at(bbox[1], bbox[2])
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${fmt1(9 * u)}"/></filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
    <feDropShadow dx="0" dy="${fmt1(6 * u)}" stdDeviation="${fmt1(8 * u)}" flood-color="${NAVY}" flood-opacity="0.55"/></filter>
  <filter id="txt" x="-20%" y="-50%" width="140%" height="200%">
    <feDropShadow dx="0" dy="${fmt1(3 * u)}" stdDeviation="${fmt1(7 * u)}" flood-color="${NAVY}" flood-opacity="0.85"/></filter>
  <filter id="fadeblur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${fmt1(170 * u)}"/></filter>
  <mask id="fade" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
    <rect x="${fmt1(tl[0] + 380 * u)}" y="${fmt1(tl[1] + 380 * u)}"
          width="${fmt1(br[0] - tl[0] - 760 * u)}"
          height="${fmt1(br[1] - tl[1] - 760 * u)}"
          rx="${fmt1(120 * u)}" fill="#FFFFFF" filter="url(#fadeblur)"/></mask>
</defs>
<g font-family="Avenir Next, Avenir, Helvetica Neue, sans-serif" fill="#FFFFFF">`]

  // land
  const mask = mode === 'region' ? ' mask="url(#fade)"' : ''
  const landD = land.map((g) => polyD(P.geom(g, 1.0 * u))).join(' ')
  parts.push(
    `<g${mask}><path d="${landD}" fill="${NAVY}" fill-opacity="0.45" fill-rule="evenodd" stroke="#FFFFFF" ` +
      `stroke-opacity="0.9" stroke-width="${fmt1(6 * u)}" stroke-linejoin="round" filter="url(#soft)"/></g>`,
  )

  // route geometry
  const roads: XY[][] = [], ferries: XY[][] = [], boats: XY[][] = []
  const trains: [XY[], boolean][] = [], flights: [XY, XY][] = []
  let routePts: XY[] = []
  for (const { leg, index } of legs) {
    const ll = leg.via.map(resolve)
    const r = routes[index]
    if (r && r.mode !== leg.mode) throw new TripRenderError(`route ${index} is for a ${r.mode} leg, not ${leg.mode}`)
    switch (leg.mode) {
      case 'drive':
        for (const [pm, pts] of r?.mode === 'drive' ? r.pieces : [['drive', ll] as const]) {
          ;(pm === 'ferry' ? ferries : roads).push(thin(pts.map(at), 1.5 * u))
        }
        break
      case 'boat':
        boats.push((r?.mode === 'boat' ? r.path : boatPath(geo, ll)).map(at))
        break
      case 'train': {
        const { path, onRails } = r?.mode === 'train' ? r : { path: ll, onRails: false }
        const xy = path.map(at)
        trains.push([onRails ? thin(xy, 1.5 * u) : xy, onRails])
        break
      }
      case 'flight':
        for (let i = 0; i + 1 < ll.length; i++) flights.push([at(ll[i]), at(ll[i + 1])])
        break
      default:
        throw new TripRenderError(`unknown leg mode '${String(leg.mode)}' (use drive, train, boat or flight)`)
    }
  }
  for (const group of [roads, ferries, boats, trains.map(([xy]) => xy)]) {
    for (const xy of group) routePts = routePts.concat(thin(xy, 20 * u))
  }

  const attrs = 'fill="none" stroke-linecap="round" stroke-linejoin="round"'
  const shadow = `stroke="${NAVY}" stroke-opacity="0.55" filter="url(#shadow)"`
  const arcs: [XY, XY, XY][] = []
  for (const [[ax, ay], [bx, by]] of flights) {
    const mx = (ax + bx) / 2, my = (ay + by) / 2
    const dx = bx - ax, dy = by - ay
    let nx = -dy * 0.18, ny = dx * 0.18
    if (ny > 0) [nx, ny] = [-nx, -ny] // bow upward
    arcs.push([[ax, ay], [mx + nx, my + ny], [bx, by]])
    for (let i = 0; i <= 20; i++) {
      const t = i / 20
      routePts.push([ax + (bx - ax) * t + 2 * (1 - t) * t * nx * 2, ay + (by - ay) * t + 2 * (1 - t) * t * ny * 2])
    }
  }
  const arcD = arcs.map(([a, c, b]) => `M${fmt1(a[0])},${fmt1(a[1])} Q${fmt1(c[0])},${fmt1(c[1])} ${fmt1(b[0])},${fmt1(b[1])}`)
  const boatD = boats.map(smoothD)
  const trainD = trains.map(([xy, onRails]) => (onRails ? lineD(xy) : smoothD(xy)))
  const dash = `stroke-dasharray="${fmt1(36 * u)} ${fmt1(30 * u)}"`
  const dots = `stroke-dasharray="${fmt1(1 * u)} ${fmt1(34 * u)}"`
  const ties = `stroke-width="${fmt1(lw * 1.9)}" stroke-dasharray="${fmt1(5 * u)} ${fmt1(25 * u)}" stroke-linecap="butt"`

  parts.push(`<g ${attrs} ${shadow} stroke-width="${fmt1(lw + 14 * u)}">`)
  parts.push(...roads.map((r) => `<path d="${lineD(r)}"/>`))
  parts.push(...trainD.map((d) => `<path d="${d}"/>`))
  parts.push(...[...boatD, ...arcD].map((d) => `<path d="${d}" ${dash}/>`))
  parts.push('</g>')
  parts.push(`<g ${attrs} stroke="#FFFFFF" stroke-width="${fmt1(lw)}">`)
  parts.push(...roads.map((r) => `<path d="${lineD(r)}"/>`))
  parts.push(...ferries.map((r) => `<path d="${lineD(r)}" ${dots}/>`))
  parts.push(...trainD.map((d) => `<path d="${d}" ${ties}/><path d="${d}" stroke-width="${fmt1(lw * 0.6)}"/>`))
  parts.push(...[...boatD, ...arcD].map((d) => `<path d="${d}" ${dash}/>`))
  parts.push('</g>')

  const labeler = new Labeler(W, H, routePts)
  const iconBox = (x: number, y: number): LabelBox => [x - 60 * u, y - 60 * u, x + 60 * u, y + 60 * u]
  const icons: string[] = [], iconAt: XY[] = []
  let badged: XY[] = [] // train lines already carrying a badge: legs sharing a line get one between them
  for (const [kind, paths] of [['boat', boats], ['train', trains.map(([xy]) => xy)]] as const) {
    for (const b of paths) {
      const [p, length] = midpoint(b)
      if (kind === 'train' && badged.some((q) => dist(p, q) < 40 * u)) continue
      if (length > 140 * u && iconAt.every((q) => dist(p, q) > 260 * u)) {
        iconAt.push(p)
        icons.push(badgeSvg(p[0], p[1], 58 * u, kind))
        labeler.block(iconBox(p[0], p[1]))
        if (kind === 'train') badged = badged.concat(thin(b, 10 * u))
      }
    }
  }
  for (const [a, c, b] of arcs) {
    const x = 0.25 * a[0] + 0.5 * c[0] + 0.25 * b[0], y = 0.25 * a[1] + 0.5 * c[1] + 0.25 * b[1]
    const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 90
    icons.push(badgeSvg(x, y, 58 * u, 'plane', ang))
    labeler.block(iconBox(x, y))
  }
  parts.push(...icons)

  // markers: only stops on a visible leg (or referenced by none at all)
  const named = (ls: { via: Trip['legs'][number]['via'] }[]) =>
    new Set(ls.flatMap((l) => l.via.filter((v): v is string => typeof v === 'string')))
  const onLegs = named(enabled), visible = named(legs.map(({ leg }) => leg))
  const shown = trip.stops.filter(
    (s) => (s.kind ?? 'minor') !== 'hidden' && (visible.has(s.name) || !onLegs.has(s.name)),
  )
  const majors = shown.filter((s) => s.kind === 'major')
  const minors = shown.filter((s) => s.kind !== 'major')
  const pinH = 118 * u
  for (const s of majors) {
    const [x, y] = at(s.at)
    labeler.block([x - pinH * 0.31, y - pinH, x + pinH * 0.31, y])
  }
  for (const s of minors) {
    const [x, y] = at(s.at)
    labeler.block([x - 46 * u, y - 46 * u, x + 46 * u, y + 46 * u])
  }
  const labels: string[] = []
  for (const s of majors) {
    const [x, y] = at(s.at)
    parts.push(pinSvg(x, y, pinH))
    const side = s.label ?? 'auto'
    if (side !== 'none') labels.push(labeler.place(s.name, x, y - pinH * 0.55, pinH * 0.5, 78 * u, true, side))
  }
  for (const s of minors) {
    const [x, y] = at(s.at)
    parts.push(
      `<polygon points="${starPoints(x, y, 46 * u)}" fill="${STAR}" stroke="#8A4B12" ` +
        `stroke-width="${fmt1(4 * u)}" stroke-linejoin="round" filter="url(#soft)"/>`,
    )
    const side = s.label ?? 'auto'
    if (side !== 'none') labels.push(labeler.place(s.name, x, y, 46 * u, 50 * u, false, side))
  }
  parts.push(...labels)
  parts.push('</g></svg>')
  return { svg: parts.join('\n'), mode }
}
