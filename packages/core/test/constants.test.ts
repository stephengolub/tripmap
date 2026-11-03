import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as C from '../src/constants.ts'

// The Python package is removed in phase 10; until then the two must agree.
const PY = new URL('../../../src/tripmap/__init__.py', import.meta.url)
const havePy = existsSync(PY)
if (!havePy) console.warn('src/tripmap/__init__.py is gone; skipping the Python constants comparison')

describe.skipIf(!havePy)('constants match the Python source', () => {
  const src = havePy ? readFileSync(PY, 'utf8') : ''
  const pyValue = (name: string) => {
    const m = src.match(new RegExp(`^${name} = (.+?)\\s*(#.*)?$`, 'm'))
    if (!m) throw new Error(`${name} not found in the Python source`)
    return m[1]
  }

  for (const name of ['STOP_RADIUS_KM', 'STOP_MIN_SECONDS', 'STOP_MIN_PHOTOS', 'BASE_MERGE_KM',
    'NEAR_BASE_KM', 'WAYPOINT_KM', 'SEA_KM', 'STATION_KM'] as const) {
    it(name, () => expect(C[name]).toBe(Number(pyValue(name))))
  }

  it('TRAIN_KMH', () => {
    const m = pyValue('TRAIN_KMH').match(/^\((\d+), (\d+)\)$/)
    expect(m).not.toBeNull()
    expect(C.TRAIN_KMH).toEqual([Number(m![1]), Number(m![2])])
  })

  it('STATION_NAME', () => {
    const m = src.match(/^STATION_NAME = re\.compile\(((?:\s*r"[^"]*")+),\s*re\.I\)/m)
    expect(m).not.toBeNull()
    const pattern = [...m![1].matchAll(/r"([^"]*)"/g)].map((p) => p[1]).join('')
    expect(C.STATION_NAME.source).toBe(pattern)
    expect(C.STATION_NAME.flags).toContain('i')
  })
})

describe('STATION_NAME', () => {
  it('matches station names case-insensitively', () => {
    for (const s of ['Central Railway Station', 'HAUPTBAHNHOF', 'Stazione Centrale', 'Estación de tren Norte', 'ESTACIÓN DE TREN'])
      expect(C.STATION_NAME.test(s)).toBe(true)
  })
  it('ignores non-station names', () => {
    for (const s of ['Bus station', 'Terminal 2', 'Hbfx']) expect(C.STATION_NAME.test(s)).toBe(false)
  })
})
