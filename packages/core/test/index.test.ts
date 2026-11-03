import { describe, expect, it } from 'vitest'
import { dumpTripYaml, parseTripYaml } from '@tripmap/core'
import type { Trip } from '@tripmap/core'

// The package entry point re-exports the YAML I/O. Invented trip.
describe('@tripmap/core entry', () => {
  it('exposes dumpTripYaml and parseTripYaml', () => {
    const trip: Trip = {
      title: 'Entry check',
      basemap: 'auto',
      stops: [
        { name: 'One', kind: 'major', at: [1.5, -2.5], label: 'auto' },
        { name: 'Two', kind: 'minor', at: [1.25, -2.25], label: 'auto' },
      ],
      legs: [{ date: '2001-02-03', mode: 'drive', day_trip: false, via: ['One', 'Two'], enabled: true }],
    }
    expect(parseTripYaml(dumpTripYaml(trip))).toEqual(trip)
  })
})
