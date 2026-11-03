// Detection thresholds. Same values as the top of src/tripmap/__init__.py;
// test/constants.test.ts checks they stay in step until the Python is retired.

export const STOP_RADIUS_KM = 0.8     // photos within this of each other form one cluster
export const STOP_MIN_SECONDS = 480   // a cluster this long (and 2+ photos) is a stop
export const STOP_MIN_PHOTOS = 5      // ...or this many photos regardless of duration
export const BASE_MERGE_KM = 10       // overnight spots this close are the same base
export const NEAR_BASE_KM = 3         // stops this close to a base are just "in town"
export const WAYPOINT_KM = 12         // spacing of in-between photo points kept as route hints
export const SEA_KM = 0.6             // a photo this far off the coastline was taken on the water
export const TRAIN_KMH: readonly [number, number] = [140, 330]  // land-to-land speeds no car manages, but a train does
export const STATION_KM = 0.4         // a departure/arrival photo this close to a station counts as at the station
export const STATION_NAME = /\b(rail(way)? station|train station|bahnhof|hauptbahnhof|hbf|stazione|termini|estaci[oó]n de tren)\b/iu
