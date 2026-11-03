// Node-only: reads geotagged photos from a macOS Photos library. Port of `load_photos`.
// The live Photos.sqlite is never opened; it is copied (with -wal/-shm) to a temp dir first.

import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const APPLE_EPOCH = 978307200

// ts is UTC epoch seconds (as in the Python version); localIso is the naive local time
// (Python's `local.replace(tzinfo=None).isoformat()`); blob is ZREVERSELOCATIONDATA.
export type Photo = { ts: number; localIso: string; lat: number; lon: number; blob: Uint8Array | null }

export type PhotosErrorCode = 'not_found' | 'permission_denied' | 'unreadable'

export class PhotosError extends Error {
  readonly code: PhotosErrorCode
  constructor(code: PhotosErrorCode, message: string) {
    super(message)
    this.name = 'PhotosError'
    this.code = code
  }
}

export const FDA_MESSAGE =
  'macOS blocked reading the Photos library. Grant Full Disk Access to the app running ' +
  'tripmap (your terminal) in System Settings > Privacy & Security > Full Disk Access, then restart it.'

const GEOTAGGED = `
    z.ZTRASHEDSTATE = 0
    AND z.ZLATITUDE BETWEEN -90 AND 90 AND z.ZLONGITUDE BETWEEN -180 AND 180
    AND NOT (z.ZLATITUDE = 0 AND z.ZLONGITUDE = 0)`

const SQL = `
  SELECT z.ZDATECREATED + ${APPLE_EPOCH} AS ts, z.ZLATITUDE AS lat, z.ZLONGITUDE AS lon,
         a.ZTIMEZONEOFFSET AS off, a.ZREVERSELOCATIONDATA AS blob
  FROM ZASSET z LEFT JOIN ZADDITIONALASSETATTRIBUTES a ON a.Z_PK = z.ZADDITIONALATTRIBUTES
  WHERE ${GEOTAGGED}
    AND z.ZDATECREATED + ${APPLE_EPOCH} BETWEEN ? AND ?
  ORDER BY 1`

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

// Python's naive datetime.isoformat(): microseconds only when nonzero.
export function localIsoFromTs(ts: number, offsetSec: number): string {
  const shifted = ts + offsetSec
  let whole = Math.floor(shifted)
  let micro = Math.round((shifted - whole) * 1e6)
  if (micro === 1_000_000) {
    whole += 1
    micro = 0
  }
  const d = new Date(whole * 1000)
  const base =
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  return micro ? `${base}.${pad(micro, 6)}` : base
}

function fsCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code
}

const COUNT_SQL = `SELECT COUNT(*) AS n FROM ZASSET z WHERE ${GEOTAGGED}`

/** Run `query` against a temp copy of the library's Photos.sqlite (with -wal/-shm), then delete
 *  the copy. Errors become PhotosErrors with the API's reason codes. */
function withDatabaseCopy<T>(library: string, query: (con: DatabaseSync) => T): T {
  const db = join(library, 'database', 'Photos.sqlite')
  const notFound = () =>
    new PhotosError('not_found', 'No Photos library found (missing database/Photos.sqlite).')
  try {
    if (!statSync(db).isFile()) throw notFound()
  } catch (e) {
    if (e instanceof PhotosError) throw e
    if (fsCode(e) === 'EACCES' || fsCode(e) === 'EPERM') throw new PhotosError('permission_denied', FDA_MESSAGE)
    throw notFound()
  }

  const tmp = mkdtempSync(join(tmpdir(), 'tripmap-'))
  try {
    try {
      for (const suf of ['', '-wal', '-shm']) {
        if (existsSync(db + suf)) copyFileSync(db + suf, join(tmp, 'Photos.sqlite' + suf))
      }
    } catch (e) {
      if (fsCode(e) === 'EACCES' || fsCode(e) === 'EPERM') throw new PhotosError('permission_denied', FDA_MESSAGE)
      if (fsCode(e) === 'ENOENT') throw notFound()
      throw new PhotosError('unreadable', `The Photos database could not be copied (${fsCode(e) ?? 'error'}).`)
    }
    try {
      const con = new DatabaseSync(join(tmp, 'Photos.sqlite'))
      try {
        return query(con)
      } finally {
        con.close()
      }
    } catch (e) {
      throw new PhotosError('unreadable', `The Photos database copy could not be read (${(e as Error)?.name ?? 'Error'}).`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// fromMs/toMs bound ZDATECREATED (UTC). Python's defaults were t0=0, t1=4e9 seconds.
export function readGeotaggedPhotos(library: string, fromMs: number = 0, toMs: number = 4e12): Photo[] {
  const rows = withDatabaseCopy(library, (con) =>
    con.prepare(SQL).all(fromMs / 1000, toMs / 1000) as Record<string, unknown>[])
  return rows.map((r) => {
    const ts = Number(r.ts)
    const blob = r.blob == null ? null : new Uint8Array(r.blob as Uint8Array)
    return { ts, localIso: localIsoFromTs(ts, Number(r.off ?? 0) || 0), lat: Number(r.lat), lon: Number(r.lon), blob }
  })
}

/** How many geotagged photos the library holds: the count behind `/api/photos/status`. */
export function countGeotaggedPhotos(library: string): number {
  return withDatabaseCopy(library, (con) => Number((con.prepare(COUNT_SQL).get() as { n: unknown }).n))
}
