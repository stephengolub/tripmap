// Natural Earth land, minor islands and countries, plus the point lookups the draft and
// the basemap make against them. Port of parts and class Geo in src/tripmap/__init__.py.
// Pure: runs in Node and the browser. Loading the files is node/geodata.ts.
//
// Distances match shapely: planar distance in degrees, times 111 * cos(lat). A geodesic
// distance (turf's pointToLineDistance) would shift results near the SEA_KM threshold, so
// the geometry is done here instead. A bounding-box scan stands in for shapely's STRtree.

import { SEA_KM } from './constants.ts'

export type Ring = number[][] // [lon, lat] pairs, GeoJSON order
export type PolygonCoords = Ring[] // exterior first, then holes
export type Feature = { geometry: { type: string; coordinates: unknown } | null }

// One polygon per part: a MultiPolygon splits into its polygons (Python's parts()).
function polygonsOf(f: Feature): PolygonCoords[] {
  const g = f.geometry
  if (!g) return []
  if (g.type === 'Polygon') return [g.coordinates as PolygonCoords]
  if (g.type === 'MultiPolygon') return g.coordinates as PolygonCoords[]
  return []
}

export type Box = [number, number, number, number] // minLon, minLat, maxLon, maxLat

export function boxOf(rings: Ring[]): Box {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < b[0]) b[0] = x
      if (y < b[1]) b[1] = y
      if (x > b[2]) b[2] = x
      if (y > b[3]) b[3] = y
    }
  }
  return b
}

const inBox = (b: Box, x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]
const boxDist = (b: Box, x: number, y: number) =>
  Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]))

// Even-odd ray cast.
function inRing(r: Ring, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function inPolygon(p: PolygonCoords, x: number, y: number): boolean {
  if (!inRing(p[0], x, y)) return false
  for (let h = 1; h < p.length; h++) if (inRing(p[h], x, y)) return false
  return true
}

// Planar distance from (x, y) to the ring's edges, in degrees.
function ringDist(r: Ring, x: number, y: number): number {
  let best = Infinity
  for (let i = 0; i + 1 < r.length; i++) {
    const [ax, ay] = r[i], [bx, by] = r[i + 1]
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
    if (d < best) best = d
  }
  return best
}

// shapely's polygon.distance(point): 0 inside, else the nearest edge of any ring.
function polygonDist(p: PolygonCoords, x: number, y: number): number {
  if (inPolygon(p, x, y)) return 0
  let best = Infinity
  for (const r of p) best = Math.min(best, ringDist(r, x, y))
  return best
}

const degToKm = (deg: number, lat: number) => deg * 111 * Math.cos((lat * Math.PI) / 180)

export class Geo {
  private readonly land: PolygonCoords[]
  private readonly boxes: Box[]
  private readonly loadCountries: () => Feature[]
  private countries: { polys: PolygonCoords[]; box: Box }[] | null = null

  // land: features of ne_10m_land then ne_10m_minor_islands, in that order. The landmass
  // index is the position of a polygon part in that flattened list, as in Python.
  constructor(land: Feature[], loadCountries: () => Feature[] = () => []) {
    this.loadCountries = loadCountries
    this.land = land.flatMap(polygonsOf)
    this.boxes = this.land.map(boxOf)
  }

  get size(): number {
    return this.land.length
  }

  // Landmass polygons in index order, as [lon, lat] coordinates (Geo.land in Python).
  get landPolygons(): readonly PolygonCoords[] {
    return this.land
  }

  // Each country's polygon parts and bounding box (Geo.countries in Python).
  get countryPolygons(): readonly { polys: PolygonCoords[]; box: Box }[] {
    this.countries ??= this.loadCountries().map((f) => {
      const polys = polygonsOf(f)
      return { polys, box: boxOf(polys.map((p) => p[0])) }
    })
    return this.countries
  }

  // Lowest-index land polygon containing the point (STRtree query, predicate intersects).
  classifyStrict(lat: number, lon: number): number | null {
    for (let i = 0; i < this.land.length; i++) {
      if (inBox(this.boxes[i], lon, lat) && inPolygon(this.land[i], lon, lat)) return i
    }
    return null
  }

  // Nearest land polygon and its distance in degrees (STRtree query_nearest). Candidates
  // are visited by bounding-box distance, a lower bound, so the scan stops early.
  private nearestWithDist(lat: number, lon: number): [number, number] {
    const order = this.boxes.map((b, i) => [boxDist(b, lon, lat), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    let best = -1, bestDist = Infinity
    for (const [lower, i] of order) {
      if (lower > bestDist) break
      const d = polygonDist(this.land[i], lon, lat)
      if (d < bestDist || (d === bestDist && i < best)) {
        best = i
        bestDist = d
      }
    }
    return [best, bestDist]
  }

  nearest(lat: number, lon: number): number {
    return this.nearestWithDist(lat, lon)[0]
  }

  // (landmass index or null, at sea). Off land but within SEA_KM of a coast still counts
  // as that landmass: GPS jitter on a beach is not a boat trip.
  classify(lat: number, lon: number): { landmass: number | null; atSea: boolean } {
    const hit = this.classifyStrict(lat, lon)
    if (hit !== null) return { landmass: hit, atSea: false }
    const [i, d] = this.nearestWithDist(lat, lon)
    if (degToKm(d, lat) > SEA_KM) return { landmass: null, atSea: true }
    return { landmass: i, atSea: false }
  }

  // Distance to the nearest landmass's outer coastline, in km (holes are not coast).
  coastKm(lat: number, lon: number): number {
    const i = this.nearest(lat, lon)
    return degToKm(ringDist(this.land[i][0], lon, lat), lat)
  }

  // Indices of the countries containing any of the points, in first-seen order.
  countriesAt(pts: [number, number][]): number[] {
    const countries = this.countryPolygons
    const found: number[] = []
    for (const [lat, lon] of pts) {
      countries.forEach((c, i) => {
        if (!found.includes(i) && inBox(c.box, lon, lat) && c.polys.some((p) => inPolygon(p, lon, lat))) found.push(i)
      })
    }
    return found
  }
}

