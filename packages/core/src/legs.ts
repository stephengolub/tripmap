// Per-day route sequences and legs: steps 4 and 5 of build_trip in
// src/tripmap/__init__.py. Each day becomes a sequence of route nodes (stops, sea photos,
// shore and way hints), each hop gets a mode, and runs of one mode become one leg.
// Flights at the very start and end are then switched off as layovers. Browser-safe.

import { WAYPOINT_KM } from './constants.ts'
import { km } from './geo.ts'
import { classifyHop } from './modes.ts'
import type { DraftStop, Point } from './stops.ts'
import { nodeLL, routeNode, type HopContext, type RouteNode } from './trains.ts'
import type { LatLon, Mode } from './types.ts'

/** A leg while drafting: route nodes rather than names, so stops keep their identity. */
export interface DraftLeg {
  date: string
  mode: Mode
  via: RouteNode[]
  day_trip: boolean
  /** False for the layover flights at the ends (written commented out). */
  enabled: boolean
}

export interface LegInput {
  /** Local dates with photos, sorted, and each date's photos in order. */
  dates: string[]
  byDay: Map<string, Point[]>
  /** Local date to the base slept at the night after it. */
  nights: Map<string, DraftStop>
}

const ll = (p: { lat: number; lon: number }): LatLon => [p.lat, p.lon]

/** One day's route nodes, from the base slept at the night before (or where the previous
 *  day ended) to the base slept at that night. Way hints are kept only every WAYPOINT_KM,
 *  sea photos within 1.5 km of the previous one merge, and consecutive photos at one stop
 *  become one node whose t0/raw0 is the arrival and t/raw the departure. */
export function daySequence(
  day: readonly Point[], startBase: DraftStop | null, endBase: DraftStop | null, carry: RouteNode | null,
): RouteNode[] {
  const seq: RouteNode[] = []
  const last = () => seq[seq.length - 1]
  if (startBase) seq.push(routeNode('stop', startBase.at[0], startBase.at[1], { ref: startBase }))
  else if (carry) seq.push(routeNode(carry.kind, carry.lat, carry.lon, { t: carry.t, ref: carry.ref, sea: carry.sea }))
  day.forEach((p, i) => {
    const ref = p.cluster?.ref
    const sw = (i > 0 && day[i - 1].sea !== p.sea) || (i + 1 < day.length && day[i + 1].sea !== p.sea)
    let node: RouteNode
    if (ref) {
      node = routeNode('stop', ref.at[0], ref.at[1], { t: p.t, ref, raw: ll(p) })
    } else if (p.sea) {
      node = routeNode('sea', p.lat, p.lon, { t: p.t, sea: true })
      if (seq.length && last().kind === 'sea' && km(nodeLL(last()), nodeLL(node)) < 1.5) return
    } else {
      if (seq.length && !sw && km(nodeLL(last()), ll(p)) < WAYPOINT_KM) {
        if (last().ref !== null) last().raw = ll(p) // a stray photo in town, e.g. at the station on the way out
        return
      }
      node = routeNode(sw ? 'shore' : 'way', p.lat, p.lon, { t: p.t, raw: ll(p) })
    }
    if (seq.length && node.ref !== null && last().ref === node.ref) {
      const prev = last()
      prev.t = node.t
      prev.raw = node.raw
      if (prev.t0 === null) {
        prev.t0 = node.t
        prev.raw0 = node.raw
      }
      return
    }
    seq.push(node)
  })
  if (endBase && !(seq.length && last().ref === endBase)) {
    seq.push(routeNode('stop', endBase.at[0], endBase.at[1], { ref: endBase }))
  }
  return seq
}

/** No dangling way hints at the very start or end of the trip, and none within 3 km of
 *  the node after it. */
export function tidySequence(seq: RouteNode[], firstDay: boolean, lastDay: boolean): RouteNode[] {
  let s = seq.slice()
  if (firstDay) while (s.length && s[0].kind === 'way') s.shift()
  if (lastDay) while (s.length && s[s.length - 1].kind === 'way') s.pop()
  s = s.filter((n, i) => n.kind !== 'way' || i + 1 >= s.length || km(nodeLL(n), nodeLL(s[i + 1])) > 3)
  return s
}

/** Photos taken from the train are only route hints: when a way hint sits between a train
 *  hop and a drive hop, both ride the train. Repeats until nothing changes. Mutates modes. */
export function spreadTrains(seq: readonly RouteNode[], modes: Mode[]): Mode[] {
  for (let pass = 0; pass < modes.length; pass++) {
    let changed = false
    for (let i = 0; i + 1 < modes.length; i++) {
      const pair = new Set([modes[i], modes[i + 1]])
      if (seq[i + 1].kind === 'way' && pair.size === 2 && pair.has('train') && pair.has('drive')) {
        modes[i] = modes[i + 1] = 'train'
        changed = true
      }
    }
    if (!changed) break
  }
  return modes
}

/** Consecutive hops of one mode become one leg. */
export function mergeHops(date: string, seq: readonly RouteNode[], modes: readonly Mode[]): DraftLeg[] {
  const legs: DraftLeg[] = []
  modes.forEach((m, i) => {
    const prev = legs[legs.length - 1]
    if (prev && prev.mode === m) prev.via.push(seq[i + 1])
    else legs.push({ date, mode: m, via: [seq[i], seq[i + 1]], day_trip: false, enabled: true })
  })
  return legs
}

/** A loop from the overnight base back to it, all driving, reaching more than 15 km out. */
export function isDayTrip(
  legs: readonly DraftLeg[], startBase: DraftStop | null, endBase: DraftStop | null, day: readonly Point[],
): boolean {
  if (!startBase || startBase !== endBase || !legs.length) return false
  if (!legs.every((l) => l.mode === 'drive')) return false
  return Math.max(...day.map((p) => km(startBase.at, ll(p)))) > 15
}

/** Every day's legs, in order. */
export async function buildLegs(input: LegInput, ctx: HopContext): Promise<DraftLeg[]> {
  const { dates, byDay, nights } = input
  const legs: DraftLeg[] = []
  let prevNight: string | null = null
  for (const d of dates) {
    const startBase = prevNight ? nights.get(prevNight) ?? null : null
    const endBase = nights.get(d) ?? null
    const day = byDay.get(d)!
    const carry = legs.length ? legs[legs.length - 1].via.at(-1)! : null
    const seq = tidySequence(daySequence(day, startBase, endBase, carry), d === dates[0], d === dates[dates.length - 1])
    prevNight = d
    const modes: Mode[] = []
    for (let i = 0; i + 1 < seq.length; i++) modes.push(await classifyHop(seq[i], seq[i + 1], ctx))
    spreadTrains(seq, modes)
    const dayLegs = mergeHops(d, seq, modes)
    const loop = isDayTrip(dayLegs, startBase, endBase, day)
    for (const l of dayLegs) l.day_trip = loop
    legs.push(...dayLegs)
  }
  return legs
}

/** Arrival and departure flights at either end are usually layovers: they, and the drives
 *  beside them, get enabled = false. At the start, a run of flights and drives is switched
 *  off up to the first flight, so long as a flight comes within two legs. At the end, the
 *  last flight and everything after it are off, looking back past at most two drives. Mutates. */
export function markLayovers(legs: DraftLeg[]): DraftLeg[] {
  for (const l of legs) l.enabled = true
  let i = 0
  while (i < legs.length && (legs[i].mode === 'flight' || legs[i].mode === 'drive')
    && legs.slice(i, i + 2).some((x) => x.mode === 'flight')) {
    if (legs[i].mode === 'flight') {
      for (const x of legs.slice(0, i + 1)) x.enabled = false
      break
    }
    i++
  }
  let j = legs.length - 1
  while (j >= 0 && j > i) {
    if (legs[j].mode === 'flight') {
      for (const x of legs.slice(j)) x.enabled = false
      break
    }
    if (legs[j].mode !== 'drive' || j < legs.length - 2) break
    j--
  }
  return legs
}

/** Stops that only the switched-off legs pass through become hidden, noted "layover".
 *  Returns the stops any leg uses, so the caller can drop the rest. Mutates the stops. */
export function hideLayoverStops(legs: readonly DraftLeg[]): Set<DraftStop> {
  const refs = (ls: readonly DraftLeg[]) => new Set(ls.flatMap((l) => l.via.flatMap((n) => (n.ref ? [n.ref as DraftStop] : []))))
  const used = refs(legs)
  const active = refs(legs.filter((l) => l.enabled))
  for (const s of used) {
    if (!active.has(s)) {
      s.kind = 'hidden'
      s.note = 'layover'
    }
  }
  return used
}
