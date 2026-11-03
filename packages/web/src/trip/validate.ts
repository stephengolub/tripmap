// Pre-render checks on the trip document. Only enabled legs count: a
// disabled leg is written commented out, so the renderer never reads it.

import type { Trip } from '../types/trip'
import { resolveVia } from './geo'

export type ValidationError = {
  legIndex: number
  viaIndex: number
  message: string
}

// One error per `via` name that matches no stop. Empty means renderable.
export function validateTrip(trip: Pick<Trip, 'stops' | 'legs'>): ValidationError[] {
  const errors: ValidationError[] = []
  trip.legs.forEach((leg, legIndex) => {
    if (!leg.enabled) return
    leg.via.forEach((via, viaIndex) => {
      if (typeof via === 'string' && resolveVia(trip, via) === null) {
        errors.push({ legIndex, viaIndex, message: `No stop named ${via}` })
      }
    })
  })
  return errors
}
