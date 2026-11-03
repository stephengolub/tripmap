// Label placement. Port of text_w and Labeler in src/tripmap/__init__.py: each label tries
// the candidate sides around its marker and takes the cheapest box, where cost counts
// overlap with boxes already placed, route points covered, and running off the canvas.

import { fmt1, type XY } from '../geo.ts'
import type { LabelSide } from '../types.ts'
import { fmt0 } from './helpers.ts'

export type LabelBox = [number, number, number, number] // x0, y0, x1, y1

type Side = Exclude<LabelSide, 'auto' | 'none'>

export const SIDES: Side[] = ['e', 'w', 'n', 's', 'ne', 'se', 'nw', 'sw']

const DX: Record<Side, number> = { e: 1, w: -1, n: 0, s: 0, ne: 0.75, se: 0.75, nw: -0.75, sw: -0.75 }
const DY: Record<Side, number> = { e: 0, w: 0, n: -1, s: 1, ne: -0.75, se: 0.75, nw: -0.75, sw: 0.75 }

// Rough text width: no font metrics, just a per-character factor.
export function textW(name: string, size: number, upper: boolean): number {
  return name.length * size * (upper ? 0.8 : 0.53)
}

const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;')

export class Labeler {
  readonly boxes: LabelBox[] = []
  readonly w: number
  readonly h: number
  readonly route: XY[]

  // Plain fields rather than parameter properties, so the web app's erasable-syntax
  // build can typecheck core too.
  constructor(w: number, h: number, route: XY[]) {
    this.w = w
    this.h = h
    this.route = route
  }

  // Reserve space (an icon, a pin) that labels should avoid.
  block(b: LabelBox): void {
    this.boxes.push(b)
  }

  // The label's box for one side of a marker at (cx, cy) with clearance m.
  candidate(side: Side, name: string, cx: number, cy: number, m: number, size: number, upper: boolean): LabelBox {
    const tw = textW(name, size, upper)
    const g = size * 0.35
    const dx = DX[side], dy = DY[side]
    const ax = cx + dx * (m + g), ay = cy + dy * (m + g)
    const x0 = dx > 0 ? ax : dx < 0 ? ax - tw : ax - tw / 2
    const y0 = dy < 0 ? ay - size * 0.95 : dy > 0 ? ay : ay - size * 0.5
    return [x0, y0, x0 + tw, y0 + size * 0.95]
  }

  // Cost of a box tried as the i-th candidate: earlier sides are slightly preferred.
  cost(b: LabelBox, i: number, size: number): number {
    let c = i * 0.5
    for (const o of this.boxes) {
      const ix = Math.max(0, Math.min(b[2], o[2]) - Math.max(b[0], o[0]))
      const iy = Math.max(0, Math.min(b[3], o[3]) - Math.max(b[1], o[1]))
      c += ((ix * iy) / (size * size)) * 40
    }
    for (const [x, y] of this.route) if (b[0] <= x && x <= b[2] && b[1] <= y && y <= b[3]) c += 0.6
    if (b[0] < 0 || b[1] < 0 || b[2] > this.w || b[3] > this.h) c += 1000
    return c
  }

  // Place a label and return its <text> element. `side` pins it; anything else (auto) searches.
  place(name: string, cx: number, cy: number, m: number, size: number, upper: boolean, side: string = 'auto'): string {
    const sides = (SIDES as string[]).includes(side) ? [side as Side] : SIDES
    let b = this.candidate(sides[0], name, cx, cy, m, size, upper)
    let bestCost = this.cost(b, 0, size)
    for (let i = 1; i < sides.length; i++) {
      const cand = this.candidate(sides[i], name, cx, cy, m, size, upper)
      const c = this.cost(cand, i, size)
      if (c < bestCost) [b, bestCost] = [cand, c] // strict: ties keep the earlier side, as min() does
    }
    this.boxes.push(b)
    const weight = upper ? 700 : 600
    const spacing = size * (upper ? 0.12 : 0.02)
    const text = upper ? name.toUpperCase() : name
    return (
      `<text x="${fmt1(b[0])}" y="${fmt1(b[1] + size * 0.75)}" font-size="${fmt0(size)}" ` +
      `font-weight="${weight}" letter-spacing="${fmt1(spacing)}" filter="url(#txt)">` +
      `${escape(text)}</text>`
    )
  }
}
