import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { describe, expect, it } from 'vitest'
import type { XY } from '../src/geo.ts'
import {
  Labeler, NAVY, PIN, badgeSvg, fmt0, lineD, pinSvg, polyD, smoothD, starPoints, textW,
} from '../src/render/index.ts'

// Each helper returns an SVG fragment; wrap it so the validator sees one document.
// XMLValidator is marked deprecated in v5 (moving to fast-xml-validator) but still works.
const wrap = (frag: string) => `<svg xmlns="http://www.w3.org/2000/svg">${frag}</svg>`
const wellFormed = (frag: string) => expect(XMLValidator.validate(wrap(frag))).toBe(true)
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' })

describe('drawing helpers', () => {
  it('pinSvg is a well-formed red pin with a white dot, tip at the point', () => {
    const svg = pinSvg(100, 200, 80)
    wellFormed(svg)
    const g = parser.parse(wrap(svg)).svg.g
    expect(g.path['@fill']).toBe(PIN)
    expect(g.path['@d'].startsWith('M100.0,200.0 C')).toBe(true)
    expect(g.circle['@fill']).toBe('#FFFFFF')
  })

  it('starPoints gives ten points, the first straight up', () => {
    const pts = starPoints(50, 50, 10)
    wellFormed(`<polygon points="${pts}"/>`)
    const list = pts.split(' ')
    expect(list).toHaveLength(10)
    expect(list[0]).toBe('50.0,40.0')
  })

  it('badgeSvg is well formed for every kind, and the three glyphs differ', () => {
    const boat = badgeSvg(10, 10, 58, 'boat')
    const train = badgeSvg(10, 10, 58, 'train')
    const plane = badgeSvg(10, 10, 58, 'plane', 45)
    for (const b of [boat, train, plane]) wellFormed(b)
    expect(train).not.toBe(boat)
    expect(train).not.toBe(plane)
    expect(boat).not.toBe(plane)
    expect(plane).toContain('rotate(45.0)')
    expect(boat).toContain('scale(1.000)')
  })

  it('the train badge has a rounded body, two windows, two wheels and a track line', () => {
    const g = parser.parse(wrap(badgeSvg(0, 0, 58, 'train'))).svg.g.g
    expect(g['@fill']).toBe(NAVY)
    const rects = [g.rect].flat()
    expect(rects).toHaveLength(2) // the body and the window band
    expect(rects[0]['@rx']).toBe('13')
    expect([g.circle].flat()).toHaveLength(2) // the wheels
    expect(g.path['@d']).toContain('M-31,34 L31,34') // the rail under it
  })

  it('lineD, smoothD and polyD produce path data the parser accepts', () => {
    const pts: XY[] = [[0, 0], [10, 5], [20, 0], [30, 10]]
    expect(lineD(pts)).toBe('M0.0,0.0 L10.0,5.0 L20.0,0.0 L30.0,10.0')
    expect(smoothD(pts).match(/C/g)).toHaveLength(3)
    const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    const hole = [[2, 2], [4, 2], [4, 4], [2, 2]]
    const d = polyD({ type: 'MultiPolygon', coordinates: [[ring, hole], [[[20, 20], [21, 20]]]] })
    expect(d.match(/M/g)).toHaveLength(2) // the two-point ring is dropped
    expect(d.endsWith('Z')).toBe(true)
    for (const p of [lineD(pts), smoothD(pts), d]) wellFormed(`<path d="${p}"/>`)
  })

  it('fmt0 rounds exact halves to even, as Python does', () => {
    expect([0.5, 1.5, 2.5, 78.4, 50.6].map(fmt0)).toEqual(['0', '2', '2', '78', '51'])
  })
})

describe('Labeler', () => {
  it('places east by default and escapes the text', () => {
    const lab = new Labeler(1000, 1000, [])
    const svg = lab.place('Fish & <Chips>', 500, 500, 10, 40, false)
    wellFormed(svg)
    expect(svg).toContain('>Fish &amp; &lt;Chips></text>')
    expect(parser.parse(wrap(svg)).svg.text['#text']).toBe('Fish & <Chips>')
    const [x0] = lab.boxes[0]
    expect(x0).toBeCloseTo(500 + 10 + 40 * 0.35, 6) // east: starts right of the marker
  })

  it('moves a label off a blocked side, and off the canvas edge', () => {
    const lab = new Labeler(1000, 1000, [])
    lab.block([505, 450, 900, 550]) // something to the east
    lab.place('Town', 500, 500, 10, 40, true)
    expect(lab.boxes[1][2]).toBeLessThanOrEqual(505) // went west

    const edge = new Labeler(1000, 1000, [])
    edge.place('Town', 990, 500, 10, 40, true) // east would run off the right edge
    expect(edge.boxes[0][2]).toBeLessThanOrEqual(1000)
  })

  it('avoids covering route points, and honours a pinned side', () => {
    const tw = textW('Town', 40, false)
    const route: XY[] = Array.from({ length: 10 }, (_, i) => [515 + (i * tw) / 10, 500] as XY)
    const lab = new Labeler(1000, 1000, route)
    lab.place('Town', 500, 500, 10, 40, false)
    const [x0, y0, x1, y1] = lab.boxes[0]
    expect(route.some(([x, y]) => x0 <= x && x <= x1 && y0 <= y && y <= y1)).toBe(false)

    const pinned = new Labeler(1000, 1000, route)
    pinned.place('Town', 500, 500, 10, 40, false, 'e')
    expect(pinned.boxes[0][0]).toBeGreaterThan(500) // kept east despite the route
  })

  it('upper-case labels are bold, spaced and capitalised', () => {
    const t = parser.parse(wrap(new Labeler(1000, 1000, []).place('town', 100, 100, 10, 78, true))).svg.text
    expect(t['#text']).toBe('TOWN')
    expect(t['@font-weight']).toBe('700')
    expect(t['@font-size']).toBe('78')
    expect(t['@letter-spacing']).toBe('9.4')
  })
})
