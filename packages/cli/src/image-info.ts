// Width, height and EXIF orientation of a JPEG or PNG, read from the file header. Replaces
// the Python's `magick identify`, so `render --photo` needs no ImageMagick.

export interface ImageInfo {
  mime: 'image/jpeg' | 'image/png'
  /** Stored pixel size, before EXIF orientation. */
  width: number
  height: number
  /** EXIF orientation 1..8 (1 when absent). 5..8 swap width and height on display. */
  orientation: number
}

export class ImageInfoError extends Error {}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function imageInfo(buf: Uint8Array): ImageInfo {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (buf.length >= 24 && PNG_SIGNATURE.every((b, i) => buf[i] === b)) {
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20), orientation: 1 }
  }
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new ImageInfoError('the photo must be a JPEG or PNG')

  let orientation = 1
  let i = 2
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new ImageInfoError('the JPEG is damaged')
    const marker = buf[i + 1]!
    if (marker === 0xff) { i++; continue } // fill byte
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue }
    const len = view.getUint16(i + 2)
    const seg = i + 4
    if (marker === 0xe1 && len >= 8 && String.fromCharCode(...buf.subarray(seg, seg + 6)) === 'Exif\0\0') {
      orientation = exifOrientation(view, seg + 6) ?? orientation
    }
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { mime: 'image/jpeg', height: view.getUint16(seg + 1), width: view.getUint16(seg + 3), orientation }
    }
    if (marker === 0xda) break // start of scan: no frame header found before the data
    i = seg + len - 2
  }
  throw new ImageInfoError('the JPEG has no frame size')
}

/** The Orientation tag (0x0112) from IFD0 of the TIFF block at `tiff`, if present and valid. */
function exifOrientation(view: DataView, tiff: number): number | undefined {
  try {
    const little = view.getUint16(tiff) === 0x4949
    const u16 = (o: number) => view.getUint16(tiff + o, little)
    const ifd = view.getUint32(tiff + 4, little)
    const entries = u16(ifd)
    for (let e = 0; e < entries; e++) {
      const at = ifd + 2 + e * 12
      if (u16(at) === 0x0112) {
        const v = u16(at + 8)
        return v >= 1 && v <= 8 ? v : undefined
      }
    }
  } catch {
    // A truncated EXIF block reads as no orientation.
  }
  return undefined
}

/** The photo's size as it is displayed, after EXIF orientation. */
export function displaySize(info: ImageInfo): [number, number] {
  return info.orientation >= 5 ? [info.height, info.width] : [info.width, info.height]
}

/**
 * An SVG transform that draws the stored image (`w` x `h`) upright. resvg ignores EXIF
 * orientation, so the preview applies it itself.
 */
export function orientationTransform(orientation: number, w: number, h: number): string {
  switch (orientation) {
    case 2: return `matrix(-1 0 0 1 ${w} 0)`
    case 3: return `matrix(-1 0 0 -1 ${w} ${h})`
    case 4: return `matrix(1 0 0 -1 0 ${h})`
    case 5: return 'matrix(0 1 1 0 0 0)'
    case 6: return `matrix(0 1 -1 0 ${h} 0)`
    case 7: return `matrix(0 -1 -1 0 ${h} ${w})`
    case 8: return `matrix(0 -1 1 0 0 ${w})`
    default: return ''
  }
}
