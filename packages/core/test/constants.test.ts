import { describe, expect, it } from 'vitest'
import * as C from '../src/constants.ts'

// Values as they were in src/tripmap/__init__.py when the Python version was retired (the last
// Python commit is 9fc7c66^). The Python source is no longer in the tree, so these literals are
// the guard: a change to a rule constant has to change this file too, on purpose.
describe('constants match the retired Python source', () => {
  it.each([
    ['STOP_RADIUS_KM', 0.8],
    ['STOP_MIN_SECONDS', 480],
    ['STOP_MIN_PHOTOS', 5],
    ['BASE_MERGE_KM', 10],
    ['NEAR_BASE_KM', 3],
    ['WAYPOINT_KM', 12],
    ['SEA_KM', 0.6],
    ['STATION_KM', 0.4],
  ] as const)('%s', (name, value) => expect(C[name]).toBe(value))

  it('TRAIN_KMH', () => expect(C.TRAIN_KMH).toEqual([140, 330]))

  it('STATION_NAME', () => {
    const pattern = 'rail(way)? station|train station|bahnhof|hauptbahnhof|hbf|stazione|termini|estaci[oó]n de tren'
    expect(C.STATION_NAME.source).toBe(`\\b(${pattern})\\b`)
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
