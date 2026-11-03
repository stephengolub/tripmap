// The travel mode of one hop. Port of classify_hop in src/tripmap/__init__.py; the rule
// order is the Python's and matters (train first, the landmass check last).

import { km } from './geo.ts'
import { byTrain, nodeLL, type HopContext, type RouteNode } from './trains.ts'
import type { Mode } from './types.ts'

export async function classifyHop(a: RouteNode, b: RouteNode, ctx: HopContext): Promise<Mode> {
  const geo = ctx.services
  const dist = km(nodeLL(a), nodeLL(b))
  if (await byTrain(a, b, ctx)) return 'train'
  if (a.t && b.t && dist > 200 && dist / Math.max((b.t - a.t) / 3600, 0.1) > 130) return 'flight'
  if (dist > 900) return 'flight'
  if (a.sea && b.sea) return 'boat'
  const coastal = [a, b].every((n) => n.sea || geo.coastKm(n.lat, n.lon) < 5)
  if (a.sea || b.sea) return coastal ? 'boat' : 'drive'
  if (dist > 25 && !(await geo.drivable(nodeLL(a), nodeLL(b)))) {
    return coastal ? 'boat' : dist > 300 ? 'flight' : 'drive'
  }
  const ma = geo.classifyStrict(a.lat, a.lon), mb = geo.classifyStrict(b.lat, b.lon)
  if (ma !== null && mb !== null && ma !== mb) return dist > 80 ? 'flight' : 'boat' // different islands/continents
  return 'drive'
}
