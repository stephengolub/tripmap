// Name votes over a group of photos. A port of town_vote and vote in
// src/tripmap/__init__.py. Browser-safe: no Node imports.

import type { PlaceInfo } from './places.ts'

/** The fields a vote reads; any photo point with a decoded place fits. */
export interface Voter {
  lat: number
  lon: number
  place: PlaceInfo
}

/** Python's round(x, 3) as a cell key: ~100 m spots. */
const cell = (p: Voter): string => `${Math.round(p.lat * 1000)},${Math.round(p.lon * 1000)}`

/**
 * The locality name shared by the most photos, counted as distinct ~100 m spots rather
 * than photos, so one hotel can't outvote a town walk. Ties go to the bigger area, or the
 * smaller one with `preferSmall`; a remaining tie goes to the name seen first, as Python's
 * `max` does.
 */
export function townVote(
  photos: readonly Voter[],
  preferSmall = false,
  key: 'localities' | 'towns' = 'localities',
): string | null {
  const cells = new Map<string, Set<string>>()
  const area = new Map<string, number>()
  for (const p of photos) {
    for (const [n, a] of Object.entries(p.place[key] ?? {})) {
      let s = cells.get(n)
      if (!s) cells.set(n, (s = new Set()))
      s.add(cell(p))
      area.set(n, Math.max(a, area.get(n) ?? 0))
    }
  }
  let best: string | null = null
  let bestVotes = -1
  let bestArea = 0
  for (const [n, s] of cells) {
    const a = preferSmall ? -area.get(n)! : area.get(n)!
    if (s.size > bestVotes || (s.size === bestVotes && a > bestArea)) {
      best = n
      bestVotes = s.size
      bestArea = a
    }
  }
  return best
}

/** The value of `key` held by the most photos (counts photos); ties go to the first seen. */
export function vote(photos: readonly Voter[], key: 'city' | 'state' | 'country' | 'cc' | 'poi' | 'island'): string | null {
  const c = new Map<string, number>()
  for (const p of photos) {
    const v = p.place[key]
    if (v) c.set(v, (c.get(v) ?? 0) + 1)
  }
  let best: string | null = null
  let n = 0
  for (const [v, k] of c) if (k > n) [best, n] = [v, k]
  return best
}
