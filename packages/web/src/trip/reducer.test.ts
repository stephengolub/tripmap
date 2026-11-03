import { describe, expect, it } from 'vitest'
import type { Trip } from '../types/trip'
import { tripOf, tripReducer, type TripAction, type TripState } from './reducer'

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

function sample(): TripState {
  const trip: Trip = {
    title: 'Ireland',
    stops: [
      { name: 'Dublin', kind: 'major', at: [53.3498, -6.2603], nights: 3 },
      { name: 'Galway', kind: 'major', at: [53.2707, -9.0568], nights: 3 },
      { name: 'Cliffs', kind: 'minor', at: [52.9715, -9.4309] },
      { name: 'Unused', kind: 'hidden', at: [52.0, -8.0] },
    ],
    legs: [
      { date: '2026-05-01', mode: 'drive', via: ['Dublin', [53.4, -7.5], 'Galway'], enabled: true },
      { date: '2026-05-02', mode: 'drive', day_trip: true, via: ['Galway', 'Cliffs', 'Galway'], enabled: true },
    ],
  }
  return deepFreeze(trip)
}

describe('tripReducer', () => {
  it('renameStop renames the stop and every via reference', () => {
    const state = sample()
    const next = tripReducer(state, { type: 'renameStop', from: 'Galway', to: 'Gaillimh' })
    expect(next.stops.map((s) => s.name)).toEqual(['Dublin', 'Gaillimh', 'Cliffs', 'Unused'])
    expect(next.legs[0].via).toEqual(['Dublin', [53.4, -7.5], 'Gaillimh'])
    expect(next.legs[1].via).toEqual(['Gaillimh', 'Cliffs', 'Gaillimh'])
    expect(next.error).toBeUndefined()
  })

  it('renameStop refuses a name that is already taken', () => {
    const state = sample()
    const next = tripReducer(state, { type: 'renameStop', from: 'Galway', to: 'Dublin' })
    expect(next.error).toBe('A stop named Dublin already exists')
    expect(next.stops).toBe(state.stops)
  })

  it('removeStop refuses while a leg references the stop', () => {
    const state = sample()
    const next = tripReducer(state, { type: 'removeStop', name: 'Cliffs' })
    expect(next.error).toBe("Can't remove Cliffs: leg 2 still uses it")
    expect(next.stops).toHaveLength(4)
  })

  it('removeStop removes an unreferenced stop and clears an earlier error', () => {
    const refused = tripReducer(sample(), { type: 'removeStop', name: 'Galway' })
    expect(refused.error).toMatch(/legs 1, 2/)
    const next = tripReducer(refused, { type: 'removeStop', name: 'Unused' })
    expect(next.stops.map((s) => s.name)).toEqual(['Dublin', 'Galway', 'Cliffs'])
    expect(next.error).toBeUndefined()
  })

  it('moveStop changes only `at`', () => {
    const state = sample()
    const next = tripReducer(state, { type: 'moveStop', name: 'Cliffs', at: [52.97, -9.43] })
    expect(next.stops[2]).toEqual({ name: 'Cliffs', kind: 'minor', at: [52.97, -9.43] })
    expect(next.stops[0]).toBe(state.stops[0])
    expect(next.stops[1]).toBe(state.stops[1])
    expect(next.legs).toBe(state.legs)
  })

  it('addStop appends and keeps names unique', () => {
    const once = tripReducer(sample(), {
      type: 'addStop',
      stop: { name: 'New stop', kind: 'minor', at: [53, -8] },
    })
    const twice = tripReducer(once, {
      type: 'addStop',
      stop: { name: 'New stop', kind: 'minor', at: [53.1, -8] },
    })
    expect(twice.stops.slice(-2).map((s) => s.name)).toEqual(['New stop', 'New stop 2'])
  })

  it('setLegMode sets the mode of one leg', () => {
    const state = sample()
    const next = tripReducer(state, { type: 'setLegMode', legIndex: 0, mode: 'train' })
    expect(next.legs[0].mode).toBe('train')
    expect(next.legs[1]).toBe(state.legs[1])
  })

  it('setLegEnabled and setLegDayTrip toggle their flags', () => {
    let next = tripReducer(sample(), { type: 'setLegEnabled', legIndex: 1, enabled: false })
    next = tripReducer(next, { type: 'setLegDayTrip', legIndex: 1, dayTrip: false })
    expect(next.legs[1].enabled).toBe(false)
    expect(next.legs[1].day_trip).toBe(false)
  })

  it('insertVia inserts at the given index', () => {
    const next = tripReducer(sample(), { type: 'insertVia', legIndex: 1, viaIndex: 1, value: 'Dublin' })
    expect(next.legs[1].via).toEqual(['Galway', 'Dublin', 'Cliffs', 'Galway'])
    const atEnd = tripReducer(sample(), { type: 'insertVia', legIndex: 1, viaIndex: 3, value: [53, -9] })
    expect(atEnd.legs[1].via).toEqual(['Galway', 'Cliffs', 'Galway', [53, -9]])
  })

  it('insertVia refuses an index past the end', () => {
    const next = tripReducer(sample(), { type: 'insertVia', legIndex: 1, viaIndex: 9, value: 'Dublin' })
    expect(next.error).toBeDefined()
    expect(next.legs[1].via).toHaveLength(3)
  })

  it('removeVia removes the entry at the given index', () => {
    const next = tripReducer(sample(), { type: 'removeVia', legIndex: 0, viaIndex: 1 })
    expect(next.legs[0].via).toEqual(['Dublin', 'Galway'])
  })

  it('setVia replaces one entry', () => {
    const next = tripReducer(sample(), { type: 'setVia', legIndex: 1, viaIndex: 1, value: 'Dublin' })
    expect(next.legs[1].via).toEqual(['Galway', 'Dublin', 'Galway'])
  })

  it('moveVia reorders entries', () => {
    const next = tripReducer(sample(), { type: 'moveVia', legIndex: 0, from: 0, to: 2 })
    expect(next.legs[0].via).toEqual([[53.4, -7.5], 'Galway', 'Dublin'])
  })

  it('addLeg and removeLeg', () => {
    const added = tripReducer(sample(), { type: 'addLeg' })
    expect(added.legs).toHaveLength(3)
    expect(added.legs[2]).toEqual({ date: '2026-05-02', mode: 'drive', via: [], enabled: true })
    const removed = tripReducer(added, { type: 'removeLeg', legIndex: 0 })
    expect(removed.legs.map((l) => l.date)).toEqual(['2026-05-02', '2026-05-02'])
  })

  it('never mutates the input state', () => {
    const state = sample()
    const snapshot = JSON.parse(JSON.stringify(state))
    const actions = [
      { type: 'renameStop', from: 'Dublin', to: 'Baile Átha Cliath' },
      { type: 'moveStop', name: 'Dublin', at: [1, 2] },
      { type: 'addStop', stop: { name: 'X', kind: 'minor', at: [1, 2] } },
      { type: 'removeStop', name: 'Unused' },
      { type: 'removeStop', name: 'Dublin' },
      { type: 'setStopKind', name: 'Cliffs', kind: 'major' },
      { type: 'setLegMode', legIndex: 0, mode: 'boat' },
      { type: 'setLegEnabled', legIndex: 0, enabled: false },
      { type: 'setLegDayTrip', legIndex: 0, dayTrip: true },
      { type: 'setVia', legIndex: 0, viaIndex: 0, value: 'Cliffs' },
      { type: 'insertVia', legIndex: 0, viaIndex: 0, value: 'Cliffs' },
      { type: 'removeVia', legIndex: 0, viaIndex: 0 },
      { type: 'moveVia', legIndex: 0, from: 0, to: 1 },
      { type: 'addLeg', legIndex: 0 },
      { type: 'removeLeg', legIndex: 0 },
    ] satisfies TripAction[]
    for (const action of actions) {
      const next = tripReducer(state, action)
      expect(next).not.toBe(state)
    }
    expect(state).toEqual(snapshot)
  })

  it('tripOf drops the editor-only error field', () => {
    const refused = tripReducer(sample(), { type: 'removeStop', name: 'Dublin' })
    expect(refused.error).toBeDefined()
    expect('error' in tripOf(refused)).toBe(false)
  })
})
