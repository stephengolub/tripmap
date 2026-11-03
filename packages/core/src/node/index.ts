// Node-only entry for @tripmap/core (`@tripmap/core/node`). Never imported by
// src/index.ts, so the browser bundle cannot pull in node:sqlite or node:fs.

export type { Photo, PhotosErrorCode } from './photos.ts'
export { PhotosError, readGeotaggedPhotos } from './photos.ts'
export type { CachePaths, NodeServices, ServicesOptions } from './services.ts'
export { DEFAULT_USER_AGENT, cachePaths, createServices, defaultCacheDir } from './services.ts'
export type { NetOptions, Piece } from './net.ts'
export { HttpError, Net, OVERPASS } from './net.ts'
export type { Feature } from './geodata.ts'
export { Geo, NE_COUNTRIES, NE_LAND, ensureNaturalEarth, loadGeo, naturalEarthUrl, readFeatures } from './geodata.ts'
export { draftFromLibrary, photosForRange } from './draft-node.ts'
export { rasterizeSvg } from './rasterize.ts'
