import { describe, expect, it } from 'vitest'
import { rasterizeSvg } from '../src/node/rasterize.ts'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// A synthetic SVG: half the canvas filled, half left empty, plus a label.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20">
<rect x="0" y="0" width="20" height="20" fill="#C62828"/>
<text x="22" y="14" font-size="10" font-family="Avenir Next, sans-serif" fill="#FFFFFF">A</text>
</svg>`

describe('rasterizeSvg', () => {
  it('returns PNG bytes', () => {
    const png = rasterizeSvg(svg, 40, 20)
    expect(png).toBeInstanceOf(Uint8Array)
    expect(Array.from(png.slice(0, 8))).toEqual(PNG_SIGNATURE)
    // IHDR: width and height big-endian at bytes 16..23; colour type 6 (RGBA) at byte 25.
    const view = new DataView(png.buffer, png.byteOffset)
    expect(view.getUint32(16)).toBe(40)
    expect(view.getUint32(20)).toBe(20)
    expect(png[25]).toBe(6)
  })

  it('scales the SVG to the requested size', () => {
    const png = rasterizeSvg(svg, 80, 40)
    const view = new DataView(png.buffer, png.byteOffset)
    expect(view.getUint32(16)).toBe(80)
    expect(view.getUint32(20)).toBe(40)
  })

  it('rejects a size that does not match the SVG aspect', () => {
    expect(() => rasterizeSvg(svg, 40, 40)).toThrow(/expected 40x40/)
  })
})
