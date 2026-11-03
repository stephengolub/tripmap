// Apple's per-asset reverse geocode (ZREVERSELOCATIONDATA), decoded. A port of
// apple_place in src/tripmap/__init__.py. Browser-safe: no Node imports.
//
// Place types: 4 = town, 6 = neighbourhood, 7 = water body, 8 = POI, 11 = island,
// 17 = street. Type 17 is never read: it can name the lodging.

import { parseBplist, Uid, type PlistValue } from './bplist.ts'

/** Decoded place names. Empty object when the blob is missing or undecodable. */
export interface PlaceInfo {
  city?: string | null
  state?: string | null
  country?: string | null
  cc?: string | null
  /** Towns and islands (types 4, 11): name to area. */
  towns?: Record<string, number>
  /** Towns, neighbourhoods and islands (types 4, 6, 11): name to area. */
  localities?: Record<string, number>
  poi?: string | null
  island?: string | null
  /** Apple puts the photo on a water body and on no land place. */
  water?: boolean
  onland?: boolean
}

const DESIGNATION = /\b(SAC|SPA|NHA|pNHA|SSSI|AONB|IBA)\b/
const LAND = new Set([4, 6, 11])

type Dict = { [key: string]: PlistValue }
type Place = { type: PlistValue; name: string; area: number }

const isDict = (v: PlistValue | undefined): v is Dict =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Uid) &&
  !(v instanceof Date) && !(v instanceof Uint8Array)

// Python's min() over (area, name) tuples: smallest area, ties by name.
function smallest(entries: Array<[number, string]>): string | null {
  if (!entries.length) return null
  return entries.reduce((a, b) => (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a))[1]
}

export function decodePlaceNames(blob: Uint8Array | null): PlaceInfo {
  if (!blob || !blob.length) return {}
  let info: PlaceInfo
  const places: Place[] = []
  try {
    const plist = parseBplist(blob)
    if (!isDict(plist) || !isDict(plist.$top) || !Array.isArray(plist.$objects)) return {}
    const objects = plist.$objects
    const R = (v: PlistValue | undefined): PlistValue | undefined => {
      if (!(v instanceof Uid)) return v
      if (v.UID >= objects.length) throw new Error('bad UID')
      return objects[v.UID]
    }
    const root = R(plist.$top.root)
    if (!isDict(root)) return {}
    const pa = R(root.postalAddress)
    const val = (d: PlistValue | undefined, k: string): string | null => {
      if (!isDict(d)) return null
      const v = R(d[k])
      return v === undefined || v === null || v === '$null' || v === '' ? null : String(v)
    }
    info = { city: val(pa, '_city'), state: val(pa, '_state'), country: val(pa, '_country'),
             cc: val(root, 'countryCode') }
    const mi = R(root.mapItem)
    if (isDict(mi) && mi.sortedPlaceInfos !== undefined && mi.sortedPlaceInfos !== null) {
      const list = R(mi.sortedPlaceInfos)
      if (!isDict(list)) throw new Error('bad place list')
      const items = R(list['NS.objects'])
      if (!Array.isArray(items)) throw new Error('bad place list')
      for (const x of items) {
        const d = R(x)
        if (!isDict(d)) throw new Error('bad place')
        const area = R(d.area)
        places.push({ type: R(d.placeType) ?? null, name: String(R(d.name)),
                      area: typeof area === 'number' && area ? area : 0 })
      }
    }
  } catch {
    return {} // odd or old blobs just go unnamed
  }

  const types = new Set(places.map((p) => p.type))
  const onland = [...LAND].some((t) => types.has(t))
  info.water = types.has(7) && !onland
  info.onland = onland
  const towns: Record<string, number> = {}
  const localities: Record<string, number> = {}
  for (const { type, name, area } of places) {
    if ((type === 4 || type === 6 || type === 11) && area < (type === 4 ? 4e9 : 5e8) && !/\d/.test(name)) {
      localities[name] = Math.max(area, localities[name] ?? 0)
      if (type === 4 || type === 11) towns[name] = localities[name]
    }
  }
  info.towns = towns
  info.localities = localities
  info.poi = smallest(places.filter((p) => p.type === 8 && p.area > 0 && p.area < 5e7 && !DESIGNATION.test(p.name))
    .map((p) => [p.area, p.name]))
  info.island = smallest(places.filter((p) => p.type === 11 && p.area > 0 && p.area < 5e8).map((p) => [p.area, p.name]))
  if (!info.city) info.city = smallest(places.filter((p) => p.type === 4 && p.area > 0).map((p) => [p.area, p.name]))
  return info
}
