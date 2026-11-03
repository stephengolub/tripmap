// Public entry for @tripmap/core. Runs in Node and the browser; Node-only code lives
// in the node subdirectory (`@tripmap/core/node`) and is never re-exported here.

export type { Basemap, LabelSide, LatLon, Leg, Mode, Stats, Stop, StopKind, Trip, ViaEntry } from './types.ts'
export type { DumpOptions } from './yaml.ts'
export { dumpTripYaml, parseTripYaml } from './yaml.ts'
export type { PlaceInfo } from './places.ts'
export { decodePlaceNames } from './places.ts'
export type { Services, Stations } from './services.ts'
export { stationsFrom, trainRoute } from './services.ts'
export { FakeServices, NO_STATIONS } from './testing.ts'
export {
  BASE_MERGE_KM, NEAR_BASE_KM, SEA_KM, STATION_KM, STATION_NAME, STOP_MIN_PHOTOS, STOP_MIN_SECONDS,
  STOP_RADIUS_KM, TRAIN_KMH, WAYPOINT_KM,
} from './constants.ts'
export type { XY } from './geo.ts'
export { fmt1, km, midpoint, smoothPath, thin } from './geo.ts'
export type { Voter } from './voting.ts'
export { townVote, vote } from './voting.ts'
export type { Cluster, DraftStop, Log, Nights, PhotoPoint, Point } from './stops.ts'
export {
  buildClusters, classifyPoints, markCoastalSea, mergeBases, nameBases, nearBase, nightsFromPhotos, quickStops,
} from './stops.ts'
export type { BuildStopsOptions, StopsResult } from './draft-stops.ts'
export { buildStops } from './draft-stops.ts'
