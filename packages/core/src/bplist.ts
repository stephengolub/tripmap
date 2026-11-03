// Minimal binary plist (bplist00) reader over a DataView. Browser-safe: the
// bplist-parser package imports node:fs and uses Buffer, so it cannot ship in the
// web bundle. Its output shape is matched (UID objects, dicts as plain objects) and
// test/places.test.ts cross-checks the two on the fixture.

/** A keyed-archiver UID: an index into the archive's $objects array. */
export class Uid {
  readonly UID: number
  constructor(id: number) {
    this.UID = id
  }
}

export type PlistValue =
  | null
  | boolean
  | number
  | string
  | Date
  | Uint8Array
  | Uid
  | PlistValue[]
  | { [key: string]: PlistValue }

const APPLE_EPOCH_MS = 978307200000

export function parseBplist(bytes: Uint8Array): PlistValue {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = String.fromCharCode(...bytes.subarray(0, 8))
  if (bytes.length < 40 || magic !== 'bplist00') throw new Error('not a binary plist')

  const trailer = bytes.length - 32
  const offsetSize = view.getUint8(trailer + 6)
  const refSize = view.getUint8(trailer + 7)
  const numObjects = uint(trailer + 8, 8)
  const top = uint(trailer + 16, 8)
  const tableOffset = uint(trailer + 24, 8)
  if (top >= numObjects || tableOffset + numObjects * offsetSize > trailer) throw new Error('bad trailer')

  const active = new Set<number>()
  return object(top)

  function uint(at: number, size: number): number {
    if (at < 0 || at + size > bytes.length) throw new Error('read past end')
    let n = 0
    for (let i = 0; i < size; i++) n = n * 256 + view.getUint8(at + i)
    return n
  }

  function object(ref: number): PlistValue {
    if (ref >= numObjects) throw new Error('bad object ref')
    if (active.has(ref)) throw new Error('cyclic plist')
    active.add(ref)
    try {
      return decode(uint(tableOffset + ref * offsetSize, offsetSize))
    } finally {
      active.delete(ref)
    }
  }

  // A count either sits in the marker's low nibble or, at 0xF, in a following int.
  function count(at: number, low: number): [number, number] {
    if (low !== 0xf) return [low, at + 1]
    const marker = view.getUint8(at + 1)
    if (marker >> 4 !== 0x1) throw new Error('bad length')
    const size = 1 << (marker & 0xf)
    return [uint(at + 2, size), at + 2 + size]
  }

  function decode(at: number): PlistValue {
    if (at >= trailer) throw new Error('bad offset')
    const marker = view.getUint8(at)
    const high = marker >> 4
    const low = marker & 0xf
    switch (high) {
      case 0x0:
        if (marker === 0x00) return null
        if (marker === 0x08) return false
        if (marker === 0x09) return true
        throw new Error('bad marker')
      case 0x1: {
        const size = 1 << low
        if (size === 8) return Number(view.getBigInt64(at + 1))
        if (size > 8) throw new Error('int too large')
        return uint(at + 1, size)
      }
      case 0x2:
        if (low === 2) return view.getFloat32(at + 1)
        if (low === 3) return view.getFloat64(at + 1)
        throw new Error('bad real')
      case 0x3:
        if (marker !== 0x33) throw new Error('bad date')
        return new Date(APPLE_EPOCH_MS + view.getFloat64(at + 1) * 1000)
      case 0x4: {
        const [len, start] = count(at, low)
        return bytes.slice(start, start + len)
      }
      case 0x5: {
        const [len, start] = count(at, low)
        return String.fromCharCode(...bytes.subarray(start, start + len))
      }
      case 0x6: {
        const [len, start] = count(at, low)
        let s = ''
        for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint16(start + i * 2))
        return s
      }
      case 0x8:
        return new Uid(uint(at + 1, low + 1))
      case 0xa:
      case 0xc: {
        const [len, start] = count(at, low)
        const out: PlistValue[] = []
        for (let i = 0; i < len; i++) out.push(object(uint(start + i * refSize, refSize)))
        return out
      }
      case 0xd: {
        const [len, start] = count(at, low)
        const out: { [key: string]: PlistValue } = {}
        for (let i = 0; i < len; i++) {
          const key = object(uint(start + i * refSize, refSize))
          if (typeof key !== 'string') throw new Error('non-string key')
          out[key] = object(uint(start + (len + i) * refSize, refSize))
        }
        return out
      }
      default:
        throw new Error('bad marker')
    }
  }
}
