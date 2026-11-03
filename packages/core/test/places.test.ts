import { readFileSync } from 'node:fs'
import { parseBuffer } from 'bplist-parser'
import { describe, expect, it } from 'vitest'
import { parseBplist, Uid, type PlistValue } from '../src/bplist.ts'
import { decodePlaceNames } from '../src/places.ts'

// Invented names only; regenerate with test/fixtures/make-place-synthetic.mjs.
const fixture = new Uint8Array(readFileSync(new URL('./fixtures/place-synthetic.bplist', import.meta.url)))

describe('decodePlaceNames', () => {
  const info = decodePlaceNames(fixture)

  it('matches the Python apple_place output for the fixture', () => {
    expect(info).toEqual({
      cc: 'TL', city: 'Testville', country: 'Testland', state: 'Test County',
      island: 'Test Isle', poi: 'Example Point', onland: true, water: false,
      localities: { 'Test Isle': 4e7, Testham: 2e6, Testville: 3e7 },
      towns: { 'Test Isle': 4e7, Testville: 3e7 },
    })
  })

  it('reads the POI', () => {
    expect(info.poi).toBe('Example Point')
  })

  it('never reads type 17 (street) names', () => {
    expect(JSON.stringify(info)).not.toContain('Guesthouse Lane')
  })

  it('skips designation names for the POI even when they are smaller', () => {
    expect(JSON.stringify(info)).not.toContain('Testmoor SAC')
  })

  it('keeps water bodies out of the localities', () => {
    expect(info.localities).not.toHaveProperty('Test Bay')
  })

  it('returns {} for garbage, truncated and empty input', () => {
    expect(decodePlaceNames(new TextEncoder().encode('not a plist at all, just bytes'))).toEqual({})
    expect(decodePlaceNames(fixture.slice(0, fixture.length - 10))).toEqual({})
    expect(decodePlaceNames(new Uint8Array(0))).toEqual({})
  })

  it('returns {} for null', () => {
    expect(decodePlaceNames(null)).toEqual({})
  })
})

describe('parseBplist', () => {
  // The browser-safe reader must agree with the bplist-parser package.
  const normalize = (v: unknown): unknown => {
    if (v instanceof Uid || (v && typeof v === 'object' && 'UID' in v)) return { uid: (v as Uid).UID }
    if (Array.isArray(v)) return v.map(normalize)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]))
    return v
  }

  it('agrees with bplist-parser on the fixture', () => {
    const ours: PlistValue = parseBplist(fixture)
    const theirs = parseBuffer(Buffer.from(fixture))[0]
    expect(normalize(ours)).toEqual(normalize(theirs))
  })
})
