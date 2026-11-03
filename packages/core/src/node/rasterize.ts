// Node rasterizer: turns the SVG from buildSvg into PNG bytes with resvg. Replaces the
// Python's headless-Chrome step. The background stays transparent so the PNG can be
// laid over an album photo.

import { Resvg } from '@resvg/resvg-js'

export function rasterizeSvg(svg: string, width: number, height: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica Neue' },
  })
  const img = resvg.render()
  if (img.width !== width || img.height !== height) {
    throw new Error(`rasterized to ${img.width}x${img.height}, expected ${width}x${height}`)
  }
  return new Uint8Array(img.asPng())
}
