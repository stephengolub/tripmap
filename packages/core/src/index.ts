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
export type { HopContext, RouteNode } from './trains.ts'
export { byTrain, isAirport, nodeLL, routeNode } from './trains.ts'
export { classifyHop } from './modes.ts'
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
export type { DraftLeg, LegInput } from './legs.ts'
export {
  buildLegs, daySequence, hideLayoverStops, isDayTrip, markLayovers, mergeHops, spreadTrains, tidySequence,
} from './legs.ts'
export type { DraftOptions } from './draft.ts'
export { TripError, defaultTitle, draft } from './draft.ts'
export type { Box, Feature, PolygonCoords, Ring } from './geodata.ts'
export { Geo, NE_COUNTRIES, NE_LAND, naturalEarthUrl } from './geodata.ts'
export { FetchExhaustedError, fetchWithRetry, isRetryableStatus, type RetryOptions } from './retry.ts'
export type { BasemapGeo, BasemapResult, Geometry } from './basemap.ts'
export { countriesAlong, densify, pickBasemap, CORRIDOR_KM, type BasemapOptions } from './basemap.ts'
export type { BadgeKind, LabelBox, LandGeo, LegRoute, OsrmRouteResponse, RoadPiece, RouteServices } from './render/index.ts'
export {
  Canvas, Labeler, NAVY, PIN, SIDES, STAR, TripRenderError, addOsrmPieces, badgeSvg, boatPath, buildSvg, drawnLegs, fmt0, landCut, lineD,
  pinSvg, polyD, rasterizeSvgInBrowser, resolver, routeLegs, seaRoute, smoothD, starPoints, textW,
} from './render/index.ts'
