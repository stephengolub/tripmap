// Browser rasterizer: the counterpart of src/node/rasterize.ts. Loads the SVG from buildSvg
// into an Image, draws it on a canvas, and returns the PNG as a Blob. The canvas starts
// transparent and is never filled, so the PNG can be laid over an album photo.
// Browser-safe: no Node imports.

export async function rasterizeSvgInBrowser(svg: string, width: number, height: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image(width, height)
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('the SVG did not load as an image'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2D canvas context')
    ctx.drawImage(img, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('canvas produced no PNG'))), 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
