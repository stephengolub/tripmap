import { describe, expect, it } from 'vitest'
import type { PlaceInfo } from '../src/places.ts'
import { townVote, vote, type Voter } from '../src/voting.ts'

// Invented coordinates and names; nothing here comes from a real trip.
const at = (lat: number, lon: number, place: PlaceInfo): Voter => ({ lat, lon, place })

describe('townVote', () => {
  it('a town walk over three spots beats twenty photos at one outlying hotel', () => {
    const hotel = Array.from({ length: 20 }, () =>
      at(10.5, 20.5, { localities: { Outskirts: 5e6 } }))
    const walk = [
      at(10.0, 20.0, { localities: { Midtown: 2e7 } }),
      at(10.002, 20.0, { localities: { Midtown: 2e7 } }),
      at(10.004, 20.0, { localities: { Midtown: 2e7 } }),
    ]
    expect(townVote([...hotel, ...walk])).toBe('Midtown')
  })

  it('photos in the same ~100 m cell count once', () => {
    const pts = [
      at(1.0001, 2.0001, { localities: { A: 1 } }),
      at(1.0002, 2.0002, { localities: { A: 1 } }),
      at(1.1, 2.1, { localities: { B: 1 } }),
      at(1.2, 2.2, { localities: { B: 1 } }),
    ]
    expect(townVote(pts)).toBe('B')
  })

  it('a tie goes to the bigger area, or the smaller with preferSmall', () => {
    const pts = [at(1, 2, { localities: { Big: 9e7, Small: 1e6 } })]
    expect(townVote(pts)).toBe('Big')
    expect(townVote(pts, true)).toBe('Small')
  })

  it('a full tie goes to the name seen first', () => {
    const pts = [at(1, 2, { localities: { First: 5 } }), at(3, 4, { localities: { Second: 5 } })]
    expect(townVote(pts)).toBe('First')
  })

  it('reads the towns key when asked and returns null with no votes', () => {
    const pts = [at(1, 2, { localities: { Quarter: 1 }, towns: { Burgh: 1 } })]
    expect(townVote(pts, false, 'towns')).toBe('Burgh')
    expect(townVote([at(1, 2, {})])).toBeNull()
    expect(townVote([])).toBeNull()
  })
})

describe('vote', () => {
  it('counts photos, not cells', () => {
    const pts = [
      ...Array.from({ length: 3 }, () => at(5, 5, { poi: 'Hall' })),
      at(6, 6, { poi: 'Tower' }), at(7, 7, { poi: 'Tower' }),
    ]
    expect(vote(pts, 'poi')).toBe('Hall')
  })
  it('ties go to the first seen and empty values are ignored', () => {
    const pts = [at(1, 1, { cc: 'XA' }), at(2, 2, { cc: 'XB' }), at(3, 3, { cc: null }), at(4, 4, {})]
    expect(vote(pts, 'cc')).toBe('XA')
    expect(vote([at(1, 1, {})], 'city')).toBeNull()
  })
})
