// Node-only entry for @tripmap/core (`@tripmap/core/node`). Never imported by
// src/index.ts, so the browser bundle cannot pull in node:sqlite or node:fs.

export type { Photo, PhotosErrorCode } from './photos.ts'
export { PhotosError, readGeotaggedPhotos } from './photos.ts'
