import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Trip } from '../src/types.ts'
import { dumpTripYaml, parseTripYaml, pyFixed } from '../src/yaml.ts'

// Invented trip: made-up names, coordinates and dates. The fixture is the output of
// Python's dump_trip_yaml for the same trip, so this is a byte-for-byte parity check.
// The coordinates include exact binary ties (1.03125, 1.0625, -2.4375) to pin
// Python's half-to-even rounding.
export const synthetic: Trip = {
  title: 'Synthetic – Testland',
  basemap: 'auto',
  stops: [
    { name: 'Alpha Port', kind: 'major', at: [1.03125, -2.5], label: 'auto', nights: 2 },
    { name: 'Bêta "Cove"', kind: 'minor', at: [1.5, -2.00005], label: 'ne', photos: 7, when: 'Feb 4' },
    { name: 'Gamma Field', kind: 'hidden', at: [-0.25, 3.75], label: 'auto', nights: 1, note: 'layover' },
  ],
  legs: [
    { date: '2001-02-03', mode: 'flight', day_trip: false, via: ['Gamma Field', 'Alpha Port'], enabled: false },
    {
      date: '2001-02-04',
      mode: 'drive',
      day_trip: true,
      via: ['Alpha Port', [1.2345, -2.1235], 'Bêta "Cove"', 'Alpha Port'],
      enabled: true,
    },
    { date: '2001-02-05', mode: 'boat', day_trip: false, via: ['Alpha Port', [1.0625, -2.4375], 'Bêta "Cove"'], enabled: true },
  ],
}

const fixture = readFileSync(new URL('./fixtures/synthetic.yaml', import.meta.url), 'utf8')

describe('dumpTripYaml', () => {
  it('matches the Python output for the synthetic trip', () => {
    const text = dumpTripYaml(synthetic, {
      photoCount: 42,
      start: '2001-02-03',
      end: '2001-02-05',
      filename: 'synthetic.yaml',
    })
    expect(text).toBe(fixture)
  })

  it('uses the plain header and leaves out the layover note when every leg is enabled', () => {
    const trip: Trip = { ...synthetic, legs: synthetic.legs.filter((l) => l.enabled) }
    const text = dumpTripYaml(trip)
    expect(text.startsWith('# tripmap trip. Edit freely, then:\n#   tripmap render trip.yaml ')).toBe(true)
    expect(text).not.toContain('commented out')
    expect(text).not.toContain('  # - {')
  })

  it('writes a missing label as auto and one night without a plural', () => {
    const trip: Trip = {
      ...synthetic,
      stops: [{ name: 'Solo', kind: 'major', at: [0, 0], nights: 1 }],
    }
    expect(dumpTripYaml(trip)).toContain('  - {name: "Solo", kind: major, at: [0.0000, 0.0000], label: auto}  # 1 night\n')
  })
})

describe('pyFixed', () => {
  it('rounds exact ties half to even like Python', () => {
    expect(pyFixed(1.03125, 4)).toBe('1.0312')
    expect(pyFixed(1.0625, 3)).toBe('1.062')
    expect(pyFixed(-2.4375, 3)).toBe('-2.438')
    expect(pyFixed(0.5, 0)).toBe('0')
    expect(pyFixed(1.5, 0)).toBe('2')
  })

  it('rounds non-ties to nearest and keeps the sign of negative zero', () => {
    expect(pyFixed(1.2345, 3)).toBe('1.234') // 1.2345 is just below the tie in binary
    expect(pyFixed(-0.00001, 4)).toBe('-0.0000')
    expect(pyFixed(-0, 4)).toBe('-0.0000')
    expect(pyFixed(12.34567, 4)).toBe('12.3457')
  })
})

// What survives a trip through YAML: coordinates already rounded, labels set, every leg
// enabled, and none of the comment-only fields (nights, photos, when, note).
const roundTrippable: Trip = {
  title: synthetic.title,
  basemap: 'island',
  stops: synthetic.stops.map(({ name, kind, label }, i) => ({
    name,
    kind,
    at: ([[1.0312, -2.5], [1.5, -2], [-0.25, 3.75]] as const)[i].slice() as [number, number],
    label: label ?? 'auto',
  })),
  legs: [
    { date: '2001-02-04', mode: 'drive', day_trip: true, via: ['Alpha Port', [1.234, -2.123], 'Bêta "Cove"'], enabled: true },
    { date: '2001-02-05', mode: 'train', day_trip: false, via: ['Bêta "Cove"', 'Gamma Field'], enabled: true },
  ],
}

describe('parseTripYaml', () => {
  it('round-trips the synthetic trip', () => {
    expect(parseTripYaml(dumpTripYaml(roundTrippable))).toEqual(roundTrippable)
  })

  it('drops a disabled leg on re-import, because it is a comment', () => {
    const trip = parseTripYaml(fixture)
    expect(trip.legs.map((l) => l.date)).toEqual(['2001-02-04', '2001-02-05'])
    expect(trip.legs.every((l) => l.enabled)).toBe(true)
    expect(trip.stops).toHaveLength(3)
  })

  it('fills enabled, day_trip and basemap when absent', () => {
    const trip = parseTripYaml('stops:\n  - {name: A, kind: major, at: [1, 2]}\nlegs:\n  - {date: "2001-02-04", mode: boat, via: [A, A]}\n')
    expect(trip.basemap).toBe('auto')
    expect(trip.legs[0]).toEqual({ date: '2001-02-04', mode: 'boat', day_trip: false, via: ['A', 'A'], enabled: true })
  })

  it('keeps an explicit enabled: false', () => {
    const trip = parseTripYaml('stops: [{name: A, kind: major, at: [1, 2]}]\nlegs: [{date: "2001-02-04", mode: drive, via: [A], enabled: false}]\n')
    expect(trip.legs[0].enabled).toBe(false)
  })

  it('turns YAML timestamps into YYYY-MM-DD strings', () => {
    const trip = parseTripYaml(
      'stops: [{name: A, kind: major, at: [1, 2]}]\nlegs:\n' +
        '  - {date: 2001-02-04, mode: drive, via: [A]}\n' +
        '  - {date: !!timestamp 2001-02-05, mode: drive, via: [A]}\n' +
        '  - {date: 2001-02-06T10:30:00Z, mode: drive, via: [A]}\n',
    )
    expect(trip.legs.map((l) => l.date)).toEqual(['2001-02-04', '2001-02-05', '2001-02-06'])
  })

  it('reads one-letter labels as labels, not booleans', () => {
    const trip = parseTripYaml('stops: [{name: A, kind: major, at: [1, 2], label: n}]\nlegs: [{date: "2001-02-04", mode: drive, via: [A]}]\n')
    expect(trip.stops[0].label).toBe('n')
  })

  it('throws on invalid YAML, a non-mapping document, and missing or empty stops or legs', () => {
    expect(() => parseTripYaml('stops: [unclosed')).toThrow(/Not valid YAML/)
    expect(() => parseTripYaml('- just\n- a list\n')).toThrow(/not a trip document/)
    expect(() => parseTripYaml('just a string')).toThrow(/not a trip document/)
    expect(() => parseTripYaml('legs: [{date: "2001-02-04", mode: drive, via: [A]}]\n')).toThrow(/no stops/)
    expect(() => parseTripYaml('stops: []\nlegs: [{date: "2001-02-04", mode: drive, via: [A]}]\n')).toThrow(/no stops/)
    expect(() => parseTripYaml('stops: [{name: A, kind: major, at: [1, 2]}]\n')).toThrow(/no legs/)
    expect(() => parseTripYaml('stops: [{name: A, kind: major, at: [1, 2]}]\nlegs: [just-a-string]\n')).toThrow(/must be a mapping/)
  })
})
