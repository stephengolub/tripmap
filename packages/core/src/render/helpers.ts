// SVG drawing pieces: pins, stars, badges and path data. Ports of star_pts, pin_svg,
// badge_svg, poly_d, line_d and smooth_d in src/tripmap/__init__.py. Pure strings, so they
// run in the browser too. The colours are the fixed style (CLAUDE.md); no options.

import type { Geometry } from '../basemap.ts'
import { fmt1, smoothPath, type XY } from '../geo.ts'

export const STAR = '#FFC93C'
export const PIN = '#E8553E'
export const NAVY = '#0B2238'

export type BadgeKind = 'boat' | 'train' | 'plane'

// Python's f"{x:.0f}": exact .5 ties round to even, where toFixed rounds them away from zero.
export function fmt0(x: number): string {
  if (Number.isInteger(x * 2) && !Number.isInteger(x)) {
    const r = Math.round(x)
    return String(r % 2 === 0 ? r : r - 1)
  }
  return x.toFixed(0)
}

// Ten points of a five-pointed star, outer radius r, inner 0.45 r, first point straight up.
export function starPoints(cx: number, cy: number, r: number): string {
  const out: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 === 0 ? r : r * 0.45
    out.push(`${fmt1(cx + rr * Math.cos(a))},${fmt1(cy + rr * Math.sin(a))}`)
  }
  return out.join(' ')
}

// A map pin of height h whose tip sits at (x, y).
export function pinSvg(x: number, y: number, h: number): string {
  const r = h * 0.31
  const cy = y - h + r
  const d =
    `M${fmt1(x)},${fmt1(y)} C${fmt1(x - r * 0.35)},${fmt1(y - h * 0.3)} ${fmt1(x - r)},${fmt1(cy + r * 0.55)} ` +
    `${fmt1(x - r)},${fmt1(cy)} A${fmt1(r)},${fmt1(r)} 0 1 1 ${fmt1(x + r)},${fmt1(cy)} ` +
    `C${fmt1(x + r)},${fmt1(cy + r * 0.55)} ${fmt1(x + r * 0.35)},${fmt1(y - h * 0.3)} ${fmt1(x)},${fmt1(y)} Z`
  return (
    `<g filter="url(#soft)"><path d="${d}" fill="${PIN}" stroke="#FFFFFF" stroke-width="${fmt1(h * 0.06)}"/>` +
    `<circle cx="${fmt1(x)}" cy="${fmt1(cy)}" r="${fmt1(r * 0.38)}" fill="#FFFFFF"/></g>`
  )
}

// A white disc of radius r with a navy glyph, drawn on a 58-unit grid and scaled to fit.
// `angle` turns the plane to its heading; the ship and the train stay upright.
export function badgeSvg(x: number, y: number, r: number, kind: BadgeKind, angle = 0): string {
  let glyph: string
  if (kind === 'boat') {
    glyph = `<path d="M-36,4 L36,4 L26,22 L-26,22 Z"/>
    <rect x="-20" y="-12" width="30" height="16" rx="2"/>
    <rect x="-14" y="-8" width="6" height="6" fill="#FFFFFF"/>
    <rect x="-2" y="-8" width="6" height="6" fill="#FFFFFF"/>
    <rect x="14" y="-26" width="9" height="30" rx="2" fill="${PIN}"/>
    <path d="M-38,32 q9.5,-8 19,0 t19,0 t19,0 t19,0" fill="none" stroke="${NAVY}" stroke-width="5" stroke-linecap="round"/>`
  } else if (kind === 'train') {
    glyph = `<rect x="-25" y="-36" width="50" height="54" rx="13"/>
    <rect x="-17" y="-26" width="34" height="18" rx="3" fill="#FFFFFF"/>
    <circle cx="-12" cy="6" r="4.5" fill="#FFFFFF"/>
    <circle cx="12" cy="6" r="4.5" fill="#FFFFFF"/>
    <path d="M-13,20 L-23,34 M13,20 L23,34 M-31,34 L31,34" fill="none" stroke="${NAVY}" stroke-width="6" stroke-linecap="round"/>`
  } else {
    glyph =
      `<path transform="rotate(${fmt1(angle)})" d="M0,-34 C5,-34 6,-29 6,-22 L6,-8 L36,8 L36,15 L6,6 ` +
      `L6,22 L15,29 L15,34 L0,30 L-15,34 L-15,29 L-6,22 L-6,6 L-36,15 L-36,8 L-6,-8 L-6,-22 ` +
      `C-6,-29 -5,-34 0,-34 Z"/>`
  }
  return (
    `<g transform="translate(${fmt1(x)},${fmt1(y)})" filter="url(#soft)"><circle r="${fmt1(r)}" fill="#FFFFFF"/>` +
    `<g fill="${NAVY}" transform="scale(${(r / 58).toFixed(3)})">${glyph}</g></g>`
  )
}

// Path data for every ring of a (projected) polygon or multipolygon, holes included.
export function polyD(g: Geometry): string {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  const d: string[] = []
  for (const p of polys) {
    for (const ring of p) {
      if (ring.length > 2) d.push('M' + ring.map(([x, y]) => `${fmt1(x)},${fmt1(y)}`).join(' L') + 'Z')
    }
  }
  return d.join(' ')
}

// Straight segments through the points.
export function lineD(pts: XY[]): string {
  return 'M' + pts.map(([x, y]) => `${fmt1(x)},${fmt1(y)}`).join(' L')
}

// Catmull-Rom curve through the points; already ported as smoothPath.
export const smoothD = smoothPath
