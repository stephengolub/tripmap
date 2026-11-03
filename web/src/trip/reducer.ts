// Every edit to the trip goes through tripReducer, so the editing rules are
// tested without the map. The reducer is pure: it never mutates its input.

import type { LatLon, Leg, Mode, Stop, Trip } from '../types/trip'

// The editor state is the trip itself plus the last refusal message. A
// refused action returns the trip unchanged with `error` set; any accepted
// action clears it.
export type TripState = Trip & { error?: string }

export type ViaEntry = string | LatLon

export type TripAction =
  | { type: 'renameStop'; from: string; to: string }
  | { type: 'moveStop'; name: string; at: LatLon }
  | { type: 'addStop'; stop: Stop }
  | { type: 'removeStop'; name: string }
  | { type: 'setStopKind'; name: string; kind: Stop['kind'] }
  | { type: 'setLegMode'; legIndex: number; mode: Mode }
  | { type: 'setLegEnabled'; legIndex: number; enabled: boolean }
  | { type: 'setLegDayTrip'; legIndex: number; dayTrip: boolean }
  | { type: 'setVia'; legIndex: number; viaIndex: number; value: ViaEntry }
  | { type: 'insertVia'; legIndex: number; viaIndex: number; value: ViaEntry }
  | { type: 'removeVia'; legIndex: number; viaIndex: number }
  | { type: 'moveVia'; legIndex: number; from: number; to: number }
  | { type: 'addLeg'; leg?: Partial<Leg>; legIndex?: number }
  | { type: 'removeLeg'; legIndex: number }

// Drops the editor-only `error` field, for sending the trip to the API.
export function tripOf(state: TripState): Trip {
  const { error: _error, ...trip } = state
  return trip
}

function accept(state: TripState, patch: Partial<Trip>): TripState {
  const { error: _error, ...trip } = state
  return { ...trip, ...patch }
}

function refuse(state: TripState, error: string): TripState {
  return { ...state, error }
}

function nameTaken(state: TripState, name: string): boolean {
  return state.stops.some((s) => s.name === name)
}

// "New stop", "New stop 2", "New stop 3", ... whichever is free first.
function uniqueName(state: TripState, base: string): string {
  if (!nameTaken(state, base)) return base
  let n = 2
  while (nameTaken(state, `${base} ${n}`)) n++
  return `${base} ${n}`
}

function updateLeg(state: TripState, legIndex: number, fn: (leg: Leg) => Leg): TripState {
  const leg = state.legs[legIndex]
  if (!leg) return refuse(state, `No leg ${legIndex + 1}`)
  return accept(state, { legs: state.legs.map((l, i) => (i === legIndex ? fn(l) : l)) })
}

function inRange(i: number, length: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < length
}

export function tripReducer(state: TripState, action: TripAction): TripState {
  switch (action.type) {
    case 'renameStop': {
      const to = action.to.trim()
      if (!nameTaken(state, action.from)) return refuse(state, `No stop named ${action.from}`)
      if (!to) return refuse(state, 'A stop needs a name')
      if (to === action.from) return accept(state, {})
      if (nameTaken(state, to)) return refuse(state, `A stop named ${to} already exists`)
      return accept(state, {
        stops: state.stops.map((s) => (s.name === action.from ? { ...s, name: to } : s)),
        legs: state.legs.map((leg) => ({
          ...leg,
          via: leg.via.map((v) => (v === action.from ? to : v)),
        })),
      })
    }

    case 'moveStop': {
      if (!nameTaken(state, action.name)) return refuse(state, `No stop named ${action.name}`)
      return accept(state, {
        stops: state.stops.map((s) =>
          s.name === action.name ? { ...s, at: [action.at[0], action.at[1]] } : s,
        ),
      })
    }

    case 'addStop': {
      const name = uniqueName(state, action.stop.name.trim() || 'New stop')
      return accept(state, { stops: [...state.stops, { ...action.stop, name }] })
    }

    case 'removeStop': {
      if (!nameTaken(state, action.name)) return refuse(state, `No stop named ${action.name}`)
      const users = state.legs
        .map((leg, i) => (leg.via.includes(action.name) ? i + 1 : 0))
        .filter((n) => n > 0)
      if (users.length) {
        const which = users.length === 1 ? `leg ${users[0]} still uses` : `legs ${users.join(', ')} still use`
        return refuse(state, `Can't remove ${action.name}: ${which} it`)
      }
      return accept(state, { stops: state.stops.filter((s) => s.name !== action.name) })
    }

    case 'setStopKind': {
      if (!nameTaken(state, action.name)) return refuse(state, `No stop named ${action.name}`)
      return accept(state, {
        stops: state.stops.map((s) => (s.name === action.name ? { ...s, kind: action.kind } : s)),
      })
    }

    case 'setLegMode':
      return updateLeg(state, action.legIndex, (leg) => ({ ...leg, mode: action.mode }))

    case 'setLegEnabled':
      return updateLeg(state, action.legIndex, (leg) => ({ ...leg, enabled: action.enabled }))

    case 'setLegDayTrip':
      return updateLeg(state, action.legIndex, (leg) => ({ ...leg, day_trip: action.dayTrip }))

    case 'setVia': {
      const leg = state.legs[action.legIndex]
      if (leg && !inRange(action.viaIndex, leg.via.length)) {
        return refuse(state, `No via entry ${action.viaIndex + 1}`)
      }
      return updateLeg(state, action.legIndex, (l) => ({
        ...l,
        via: l.via.map((v, i) => (i === action.viaIndex ? action.value : v)),
      }))
    }

    case 'insertVia': {
      const leg = state.legs[action.legIndex]
      if (leg && !inRange(action.viaIndex, leg.via.length + 1)) {
        return refuse(state, `Can't insert at position ${action.viaIndex + 1}`)
      }
      return updateLeg(state, action.legIndex, (l) => {
        const via = [...l.via]
        via.splice(action.viaIndex, 0, action.value)
        return { ...l, via }
      })
    }

    case 'removeVia': {
      const leg = state.legs[action.legIndex]
      if (leg && !inRange(action.viaIndex, leg.via.length)) {
        return refuse(state, `No via entry ${action.viaIndex + 1}`)
      }
      return updateLeg(state, action.legIndex, (l) => ({
        ...l,
        via: l.via.filter((_, i) => i !== action.viaIndex),
      }))
    }

    case 'moveVia': {
      const leg = state.legs[action.legIndex]
      if (leg && !(inRange(action.from, leg.via.length) && inRange(action.to, leg.via.length))) {
        return refuse(state, `Can't move via entry ${action.from + 1}`)
      }
      return updateLeg(state, action.legIndex, (l) => {
        const via = [...l.via]
        const [entry] = via.splice(action.from, 1)
        via.splice(action.to, 0, entry)
        return { ...l, via }
      })
    }

    case 'addLeg': {
      const index = action.legIndex ?? state.legs.length
      if (!inRange(index, state.legs.length + 1)) return refuse(state, `Can't add a leg there`)
      const before = state.legs[index - 1]
      const leg: Leg = {
        date: before?.date ?? '',
        mode: 'drive',
        via: [],
        enabled: true,
        ...action.leg,
      }
      const legs = [...state.legs]
      legs.splice(index, 0, leg)
      return accept(state, { legs })
    }

    case 'removeLeg': {
      if (!inRange(action.legIndex, state.legs.length)) {
        return refuse(state, `No leg ${action.legIndex + 1}`)
      }
      return accept(state, { legs: state.legs.filter((_, i) => i !== action.legIndex) })
    }
  }
}
