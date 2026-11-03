// Public entry for @tripmap/core. Runs in Node and the browser; Node-only code lives
// under src/node/ and is never re-exported here.

export type { Basemap, LabelSide, LatLon, Leg, Mode, Stats, Stop, StopKind, Trip, ViaEntry } from './types.ts'
export type { DumpOptions } from './yaml.ts'
export { dumpTripYaml, parseTripYaml } from './yaml.ts'
