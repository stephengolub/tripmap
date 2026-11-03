import { describe, expect, it } from 'vitest'
import type { Trip } from '../types/trip'
import { validateTrip } from './validate'

const trip: Trip = {
  stops: [
    { name: 'Dublin', kind: 'major', at: [53.3498, -6.2603] },
    { name: 'Galway', kind: 'major', at: [53.2707, -9.0568] },
  ],
  legs: [
    { date: '2026-05-01', mode: 'drive', via: ['Dublin', [53.4, -7.5], 'Galway'], enabled: true },
    { date: '2026-05-02', mode: 'drive', via: ['Galway', 'Dublin'], enabled: true },
  ],
}

describe('validateTrip', () => {
  it('returns no errors for a valid trip', () => {
    expect(validateTrip(trip)).toEqual([])
  })

  it('reports an unknown name with its leg and via index', () => {
    const bad: Trip = {
      ...trip,
      legs: [trip.legs[0], { ...trip.legs[1], via: ['Galway', 'Atlantis'] }],
    }
    expect(validateTrip(bad)).toEqual([{ legIndex: 1, viaIndex: 1, message: 'No stop named Atlantis' }])
  })

  it('ignores unknown names on a disabled leg', () => {
    const off: Trip = {
      ...trip,
      legs: [trip.legs[0], { ...trip.legs[1], via: ['Atlantis'], enabled: false }],
    }
    expect(validateTrip(off)).toEqual([])
  })
})
