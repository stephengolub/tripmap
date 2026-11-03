// Geometry helpers. Ports of km, thin, midpoint and smooth_d in src/tripmap/__init__.py.
// km works on [lat, lon]; the rest work on projected [x, y] pixel points.

import type { LatLon } from './types.ts'

export type XY = [number, number]

// Great-circle distance in km (haversine, Earth diameter 12742 km as in the Python).
export function km(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const la1 = a[0] * rad, lo1 = a[1] * rad, la2 = b[0] * rad, lo2 = b[1] * rad
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1])

// Drop points closer than `step` to the last kept one; always keeps both ends.
export function thin(pts: XY[], step: number): XY[] {
  const out: XY[] = [pts[0]]
  for (const p of pts.slice(1)) {
    if (dist(p, out[out.length - 1]) >= step) out.push(p)
  }
  const last = out[out.length - 1], end = pts[pts.length - 1]
  if (last[0] !== end[0] || last[1] !== end[1]) out.push(end)
  return out
}

// The point halfway along the polyline by length, and the total length.
export function midpoint(pts: XY[]): [XY, number] {
  let total = 0
  for (let i = 0; i + 1 < pts.length; i++) total += dist(pts[i], pts[i + 1])
  let acc = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1]
    const seg = dist(a, b)
    if (acc + seg >= total / 2 && seg) {
      const f = (total / 2 - acc) / seg
      return [[a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])], total]
    }
    acc += seg
  }
  return [pts[0], total]
}

// Python's f"{x:.1f}". toFixed rounds exact ties away from zero; Python rounds them to
// even. With one decimal the only exact binary ties are x.25 and x.75, so fix those.
export function fmt1(x: number): string {
  if (Number.isInteger(x * 4) && !Number.isInteger(x * 2)) {
    const r = Math.round(x * 10) // a tie: x*10 is n.5, Math.round goes up
    const even = r % 2 === 0 ? r : r - 1
    return (even / 10).toFixed(1)
  }
  return x.toFixed(1)
}

// SVG path through the points: Catmull-Rom spline as cubic Beziers (smooth_d).
export function smoothPath(pts: XY[]): string {
  let d = `M${fmt1(pts[0][0])},${fmt1(pts[0][1])}`
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = i ? pts[i - 1] : pts[i]
    const p1 = pts[i], p2 = pts[i + 1]
    const p3 = i + 2 < pts.length ? pts[i + 2] : p2
    const c1: XY = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: XY = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${fmt1(c1[0])},${fmt1(c1[1])} ${fmt1(c2[0])},${fmt1(c2[1])} ${fmt1(p2[0])},${fmt1(p2[1])}`
  }
  return d
}
