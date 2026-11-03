import { afterEach, describe, expect, it, vi } from 'vitest'
import { rasterizeSvgInBrowser } from '../src/render/rasterize-browser.ts'

// Vitest runs in Node, so Image, document and the canvas are stubbed. The stubs record
// what the rasterizer asked for: an SVG blob URL, a canvas of the requested size, a PNG.
function stubDom(opts: { loadFails?: boolean; noBlob?: boolean } = {}) {
  const calls = { drawn: [] as unknown[][], fills: 0, revoked: [] as string[], srcType: '', mime: '' }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: (...a: unknown[]) => calls.drawn.push(a),
      fillRect: () => calls.fills++,
    }),
    toBlob: (cb: (b: Blob | null) => void, mime: string) => {
      calls.mime = mime
      cb(opts.noBlob ? null : new Blob([new Uint8Array([0x89, 0x50])], { type: mime }))
    },
  }
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    decoding = ''
    set src(_: string) {
      queueMicrotask(() => (opts.loadFails ? this.onerror?.() : this.onload?.()))
    }
  }
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('document', { createElement: (tag: string) => (tag === 'canvas' ? canvas : null) })
  vi.spyOn(URL, 'createObjectURL').mockImplementation(b => {
    calls.srcType = (b as Blob).type
    return 'blob:svg'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(u => void calls.revoked.push(u))
  return { calls, canvas }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/>'

describe('rasterizeSvgInBrowser', () => {
  it('draws the SVG on a transparent canvas of the requested size and returns a PNG blob', async () => {
    const { calls, canvas } = stubDom()
    const blob = await rasterizeSvgInBrowser(svg, 40, 20)
    expect(blob.type).toBe('image/png')
    expect(calls.srcType).toBe('image/svg+xml')
    expect([canvas.width, canvas.height]).toEqual([40, 20])
    expect(calls.drawn).toHaveLength(1)
    expect(calls.drawn[0]!.slice(1)).toEqual([0, 0, 40, 20])
    expect(calls.fills).toBe(0)
    expect(calls.mime).toBe('image/png')
    expect(calls.revoked).toEqual(['blob:svg'])
  })

  it('rejects and still frees the URL when the SVG fails to load', async () => {
    const { calls } = stubDom({ loadFails: true })
    await expect(rasterizeSvgInBrowser(svg, 40, 20)).rejects.toThrow(/did not load/)
    expect(calls.revoked).toEqual(['blob:svg'])
  })

  it('rejects when the canvas gives no PNG', async () => {
    stubDom({ noBlob: true })
    await expect(rasterizeSvgInBrowser(svg, 40, 20)).rejects.toThrow(/no PNG/)
  })
})
