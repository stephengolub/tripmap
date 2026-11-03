import { describe, expect, it, vi } from 'vitest'
import type { Photo } from '../src/node/photos.ts'

// readGeotaggedPhotos is stubbed so draftFromLibrary runs without a Photos library.
const reads: [number, number][] = []
let libraryPhotos: Photo[] = []
vi.mock('../src/node/photos.ts', () => ({
  readGeotaggedPhotos: (_lib: string, from: number, to: number) => {
    reads.push([from, to])
    return libraryPhotos
  },
}))

const { TripError, defaultTitle, draft } = await import('../src/draft.ts')
const { draftFromLibrary } = await import('../src/node/draft-node.ts')
const { pyFixed, dumpTripYaml, parseTripYaml } = await import('../src/yaml.ts')
const { FakeServices } = await import('../src/testing.ts')
import type { PlaceInfo } from '../src/places.ts'
import type { PhotoPoint } from '../src/stops.ts'
import type { LatLon, Trip } from '../src/types.ts'

// Invented coordinates, dates and names; nothing here comes from a real trip. Local time
// equals UTC. Same shape as test/legs.test.ts: fly in to Alphaville, a loop day, drive on.

function shoot(at: LatLon, start: string, count: number, everyMin: number, place: PlaceInfo): PhotoPoint[] {
  const t0 = Date.parse(`${start}Z`) / 1000
  return Array.from({ length: count }, (_, i) => {
    const t = t0 + i * everyMin * 60
    return { t, local: new Date(t * 1000).toISOString().slice(0, 19), lat: at[0] + i * 1e-5, lon: at[1], place }
  })
}

const ZETA: LatLon = [31.0, 10.0]    // ~1000 km south: the flight in
const ALPHA: LatLon = [40.0, 10.0]
const LAKE: LatLon = [40.27, 10.0]
const BETA: LatLon = [40.9, 10.0]
const inAlpha: PlaceInfo = { towns: { Alphaville: 5e7 }, localities: { Alphaville: 5e7 }, cc: 'XA' }

const PHOTOS: PhotoPoint[] = [
  ...shoot(ZETA, '2030-06-01T08:00:00', 6, 5, { poi: 'Zeta Airport' }),
  ...shoot(ALPHA, '2030-06-01T18:00:00', 5, 20, inAlpha),
  ...shoot(ALPHA, '2030-06-02T08:00:00', 2, 10, inAlpha),
  ...shoot([40.135, 10.0], '2030-06-02T10:00:00', 1, 1, {}),
  ...shoot(LAKE, '2030-06-02T11:00:00', 10, 6, { poi: 'Lake Delta' }),
  ...shoot([40.135, 10.06], '2030-06-02T15:00:00', 1, 1, {}),
  ...shoot(ALPHA, '2030-06-02T19:00:00', 5, 10, inAlpha),
  ...shoot(ALPHA, '2030-06-03T08:00:00', 2, 10, inAlpha),
  ...shoot(BETA, '2030-06-03T13:00:00', 6, 5, { poi: 'Beta Square' }),
]

const services = () => FakeServices({ townCentre: async (name, _cc, near) => (name === 'Alphaville' ? ALPHA : near) })
const OPTS = { from: '2030-06-01', to: '2030-06-03' }

// What a trip looks like after a trip YAML round trip: the YAML keeps name, kind, at and
// label of each stop (at to 4 places), the enabled legs only, and [lat, lon] hints to 3.
function asYamlSeesIt(trip: Trip): Trip {
  const r = (x: number, d: number) => Number(pyFixed(x, d))
  return {
    title: trip.title, basemap: trip.basemap,
    stops: trip.stops.map((s) => ({ name: s.name, kind: s.kind, at: [r(s.at[0], 4), r(s.at[1], 4)], label: s.label })),
    legs: trip.legs.filter((l) => l.enabled).map((l) => ({
      ...l, via: l.via.map((v) => (typeof v === 'string' ? v : [r(v[0], 3), r(v[1], 3)] as LatLon)),
    })),
  }
}

describe('draft', () => {
  it('drafts the synthetic trip, and the trip survives a YAML round trip', async () => {
    const { trip, stats } = await draft(OPTS, services(), PHOTOS)
    expect(trip.title).toBe('Trip Jun 1 – Jun 3, 2030')
    expect(trip.basemap).toBe('auto')
    expect(trip.stops.map((s) => [s.name, s.kind, s.note ?? null])).toEqual([
      ['Alphaville', 'major', null],
      ['Zeta Airport', 'hidden', 'layover'],
      ['Lake Delta', 'minor', null],
      ['Beta Square', 'minor', null],
    ])
    expect(trip.stops.every((s) => !('raw' in s))).toBe(true)
    expect(trip.legs.map((l) => [l.date, l.mode, l.day_trip, l.enabled])).toEqual([
      ['2030-06-01', 'flight', false, false],
      ['2030-06-02', 'drive', true, true],
      ['2030-06-03', 'drive', false, true],
    ])
    expect(trip.legs[1].via.filter((v) => typeof v === 'string')).toEqual(['Alphaville', 'Lake Delta', 'Alphaville'])
    expect(stats).toEqual({
      photo_count: PHOTOS.length,
      overnight_names: ['Alphaville'],
      quick_names: ['Lake Delta', 'Beta Square'],
      hidden_names: ['Zeta Airport'],
      leg_counts: { drive: 2 },
    })

    const text = dumpTripYaml(trip, { photoCount: stats.photo_count, start: OPTS.from, end: OPTS.to })
    const back = parseTripYaml(text)
    expect(back).toEqual(asYamlSeesIt(trip))
    // and the round trip is stable from there on
    expect(parseTripYaml(dumpTripYaml(back))).toEqual(back)
  })

  it('uses the given title, and only the photos on the dates', async () => {
    const extra = shoot([45, 10], '2030-06-04T09:00:00', 6, 5, { poi: 'Later' })
    const { trip, stats } = await draft({ ...OPTS, title: 'Synthetic' }, services(), [...PHOTOS, ...extra])
    expect(trip.title).toBe('Synthetic')
    expect(stats.photo_count).toBe(PHOTOS.length)
  })

  it('throws TripError with fewer than two photos in range', async () => {
    await expect(draft(OPTS, services(), PHOTOS.slice(0, 1))).rejects.toThrow(TripError)
    await expect(draft({ from: '2031-01-01', to: '2031-01-02' }, services(), PHOTOS))
      .rejects.toThrow('Only 0 geotagged photos between 2031-01-01 and 2031-01-02.')
  })

  it('formats the default title like the Python', () => {
    expect(defaultTitle('2030-12-30', '2031-01-02')).toBe('Trip Dec 30 – Jan 2, 2031')
  })
})

describe('draftFromLibrary', () => {
  it('pads the read by 1.2 days before and 2.2 days after, then keeps the exact dates', async () => {
    reads.length = 0
    const photo = (p: PhotoPoint): Photo => ({ ts: p.t, localIso: p.local, lat: p.lat, lon: p.lon, blob: null })
    const outside = shoot(BETA, '2030-06-04T09:00:00', 3, 5, {}).map(photo)
    libraryPhotos = [...PHOTOS.map(photo), ...outside]
    const { stats } = await draftFromLibrary('/nonexistent/Library.photoslibrary', OPTS, services())
    expect(stats.photo_count).toBe(PHOTOS.length)
    const day = 86_400_000
    expect(reads).toEqual([[
      new Date('2030-06-01T00:00:00').getTime() - 1.2 * day,
      new Date('2030-06-03T00:00:00').getTime() + 2.2 * day,
    ]])
  })
})
