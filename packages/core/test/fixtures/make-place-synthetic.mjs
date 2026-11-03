// Write place-synthetic.bplist: an NSKeyedArchiver plist shaped like the reverse geocode
// Photos stores in ZREVERSELOCATIONDATA. Every name and number here is invented.
//
// Run from this directory: node make-place-synthetic.mjs
import { writeFileSync } from 'node:fs'

class UID {
  constructor(value) {
    this.value = value
  }
}

const objects = ['$null']

function add(value) {
  objects.push(value)
  return new UID(objects.length - 1)
}

function place(kind, name, area) {
  return add({ placeType: kind, name: add(name), area })
}

// Integers are whole numbers; areas are reals (they are floats in the real data).
class Real {
  constructor(value) {
    this.value = value
  }
}

const infos = [
  place(4, 'Testville', new Real(3.0e7)),
  place(6, 'Testham', new Real(2.0e6)),
  place(8, 'Example Point', new Real(1.0e6)),
  place(8, 'Testmoor SAC', new Real(5.0e5)), // designation: smaller, so it would win if not skipped
  place(11, 'Test Isle', new Real(4.0e7)),
  place(17, 'Guesthouse Lane', new Real(1.0e2)), // street level: must never be read
  place(7, 'Test Bay', new Real(1.0e9)),
]
const sortedInfos = add({ 'NS.objects': infos })
const mapItem = add({ sortedPlaceInfos: sortedInfos })
const postal = add({
  _city: add('Testville'),
  _state: add('Test County'),
  _country: add('Testland'),
  _street: add('Guesthouse Lane'),
})
const root = add({ postalAddress: postal, countryCode: add('TL'), mapItem })

const archive = {
  $archiver: 'NSKeyedArchiver',
  $version: 100000,
  $top: { root },
  $objects: objects,
}

writeFileSync('place-synthetic.bplist', binaryPlist(archive))

// A minimal bplist00 writer: dicts, arrays, ASCII strings, ints, reals and UIDs, which is
// everything an NSKeyedArchiver place record uses. One-byte object refs and four-byte offsets.
function binaryPlist(top) {
  const encoded = []
  function flatten(value) {
    const index = encoded.length
    encoded.push(null)
    encoded[index] = encode(value)
    return index
  }
  function marker(type, count) {
    if (count < 15) return [(type << 4) | count]
    return [(type << 4) | 0xf, ...int(count)]
  }
  function int(n) {
    if (n < 0x100) return [0x10, n]
    if (n < 0x10000) return [0x11, n >> 8, n & 0xff]
    return [0x12, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
  }
  function encode(value) {
    if (value instanceof UID) return [0x80, value.value]
    if (value instanceof Real) {
      const bytes = Buffer.alloc(8)
      bytes.writeDoubleBE(value.value)
      return [0x23, ...bytes]
    }
    if (typeof value === 'number') return int(value)
    if (typeof value === 'string') return [...marker(0x5, value.length), ...Buffer.from(value, 'ascii')]
    if (Array.isArray(value)) {
      const refs = value.map(flatten)
      return [...marker(0xa, refs.length), ...refs]
    }
    const entries = Object.entries(value)
    const keys = entries.map(([key]) => flatten(key))
    const values = entries.map(([, v]) => flatten(v))
    return [...marker(0xd, entries.length), ...keys, ...values]
  }
  flatten(top)
  if (encoded.length > 0xff) throw new Error('too many objects for one-byte refs')

  const body = [...Buffer.from('bplist00', 'ascii')]
  const offsets = []
  for (const bytes of encoded) {
    offsets.push(body.length)
    body.push(...bytes)
  }
  const tableOffset = body.length
  for (const offset of offsets) {
    body.push((offset >>> 24) & 0xff, (offset >> 16) & 0xff, (offset >> 8) & 0xff, offset & 0xff)
  }
  const trailer = Buffer.alloc(32)
  trailer.writeUInt8(4, 6) // offset int size
  trailer.writeUInt8(1, 7) // object ref size
  trailer.writeBigUInt64BE(BigInt(encoded.length), 8)
  trailer.writeBigUInt64BE(0n, 16) // top object
  trailer.writeBigUInt64BE(BigInt(tableOffset), 24)
  return Buffer.from([...body, ...trailer])
}
