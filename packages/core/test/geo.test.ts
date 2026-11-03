import { describe, expect, it } from 'vitest'
import { fmt1, km, midpoint, smoothPath, thin, type XY } from '../src/geo.ts'

describe('km', () => {
  it('one degree of longitude at the equator is 111.19 km', () => {
    const d = km([0, 0], [0, 1])
    expect(Math.abs(d - 111.19) / 111.19).toBeLessThan(0.001)
  })
  it('is zero for the same point and symmetric', () => {
    expect(km([10, 20], [10, 20])).toBe(0)
    expect(km([10, 20], [11, 22])).toBeCloseTo(km([11, 22], [10, 20]), 9)
  })
})

describe('thin', () => {
  it('keeps both endpoints and drops points closer than the step', () => {
    const pts: XY[] = [[0, 0], [0.5, 0], [1, 0], [2.5, 0], [2.7, 0]]
    expect(thin(pts, 1)).toEqual([[0, 0], [1, 0], [2.5, 0], [2.7, 0]])
  })
  it('keeps the last point even when it is within the step', () => {
    const out = thin([[0, 0], [0.1, 0], [0.2, 0]], 5)
    expect(out[0]).toEqual([0, 0])
    expect(out[out.length - 1]).toEqual([0.2, 0])
  })
})

describe('midpoint', () => {
  it('uses length along a bent line, not vertex count', () => {
    // Three short vertices then one long leg: total 12, halfway is 4 up the long leg.
    const [mid, total] = midpoint([[0, 0], [1, 0], [2, 0], [2, 10]])
    expect(total).toBe(12)
    expect(mid[0]).toBeCloseTo(2, 9)
    expect(mid[1]).toBeCloseTo(4, 9)
  })
  it('falls back to the first point for a zero-length line', () => {
    expect(midpoint([[3, 4], [3, 4]])).toEqual([[3, 4], 0])
  })
})

describe('smoothPath', () => {
  it('matches the Python smooth_d output', () => {
    // Expected string computed with smooth_d in src/tripmap/__init__.py.
    expect(smoothPath([[0, 0], [10, 0], [10, 10]]))
      .toBe('M0.0,0.0 C1.7,0.0 8.3,-1.7 10.0,0.0 C11.7,1.7 10.0,8.3 10.0,10.0')
  })
  it('rounds exact ties to even like Python', () => {
    expect([0.25, 0.75, 1.25, -0.25, -0.75, 0.35].map(fmt1)).toEqual(['0.2', '0.8', '1.2', '-0.2', '-0.8', '0.3'])
  })
})
