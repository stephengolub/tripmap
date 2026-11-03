import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Wrap the real DatabaseSync so the test can see every path it is asked to open.
const opened: string[] = []
vi.mock('node:sqlite', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:sqlite')>()
  class SpyDatabaseSync extends real.DatabaseSync {
    constructor(path: string, ...rest: unknown[]) {
      opened.push(path)
      super(path, ...(rest as []))
    }
  }
  return { ...real, DatabaseSync: SpyDatabaseSync }
})

const { DatabaseSync } = await import('node:sqlite')
const { APPLE_EPOCH, PhotosError, countGeotaggedPhotos, localIsoFromTs, readGeotaggedPhotos } = await import('../src/node/photos.ts')

// Invented library: synthetic coordinates and an arbitrary date, nothing from Photos.
let lib: string
let live: string
const created = Date.UTC(2001, 1, 3, 10, 0, 0) / 1000 - APPLE_EPOCH

beforeEach(() => {
  lib = mkdtempSync(join(tmpdir(), 'tripmap-test-lib-'))
  mkdirSync(join(lib, 'database'))
  live = join(lib, 'database', 'Photos.sqlite')
  const db = new DatabaseSync(live)
  db.exec(`
    CREATE TABLE ZASSET (Z_PK INTEGER PRIMARY KEY, ZDATECREATED REAL, ZLATITUDE REAL, ZLONGITUDE REAL,
                         ZTRASHEDSTATE INTEGER, ZADDITIONALATTRIBUTES INTEGER);
    CREATE TABLE ZADDITIONALASSETATTRIBUTES (Z_PK INTEGER PRIMARY KEY, ZTIMEZONEOFFSET INTEGER,
                                             ZREVERSELOCATIONDATA BLOB);`)
  const ins = db.prepare('INSERT INTO ZASSET VALUES (?, ?, ?, ?, ?, ?)')
  ins.run(1, created, 1.5, -2.5, 0, 1) // kept
  ins.run(2, created + 60, 1.6, -2.4, 1, null) // trashed
  ins.run(3, created + 120, 0, 0, 0, null) // 0,0
  db.prepare('INSERT INTO ZADDITIONALASSETATTRIBUTES VALUES (?, ?, ?)').run(1, 3600, new Uint8Array([1, 2, 3]))
  db.close()
  opened.length = 0
})

afterEach(() => rmSync(lib, { recursive: true, force: true }))

describe('countGeotaggedPhotos', () => {
  it('counts only non-trashed, non-0,0 photos, from a temp copy', () => {
    expect(countGeotaggedPhotos(lib)).toBe(1)
    expect(opened).not.toContain(live)
  })

  it('throws not_found for a missing library', () => {
    expect(() => countGeotaggedPhotos(join(lib, 'nope'))).toThrow(expect.objectContaining({ code: 'not_found' }))
  })
})

describe('readGeotaggedPhotos', () => {
  it('returns only non-trashed, non-0,0 photos with local time from the offset', () => {
    const photos = readGeotaggedPhotos(lib, 0, 4e12)
    expect(photos).toHaveLength(1)
    const [p] = photos
    expect(p.ts).toBe(created + APPLE_EPOCH)
    expect(p.localIso).toBe('2001-02-03T11:00:00')
    expect([p.lat, p.lon]).toEqual([1.5, -2.5])
    expect(Array.from(p.blob!)).toEqual([1, 2, 3])
  })

  it('applies the date range', () => {
    const t = (created + APPLE_EPOCH) * 1000
    expect(readGeotaggedPhotos(lib, t + 1000, t + 5000)).toHaveLength(0)
    expect(readGeotaggedPhotos(lib, t - 1000, t + 1000)).toHaveLength(1)
  })

  it('opens only a temp copy, never the live database, and cleans it up', () => {
    readGeotaggedPhotos(lib, 0, 4e12)
    expect(opened).toHaveLength(1)
    expect(opened[0]).not.toBe(live)
    expect(opened[0].startsWith(lib)).toBe(false)
    expect(opened[0].endsWith('Photos.sqlite')).toBe(true)
    // Check this call's own temp dir; counting every tripmap-* dir races other test files.
    expect(existsSync(dirname(opened[0]))).toBe(false)
  })

  it('throws not_found for a missing library', () => {
    let err: unknown
    try {
      readGeotaggedPhotos(join(lib, 'nope'), 0, 1)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(PhotosError)
    expect((err as InstanceType<typeof PhotosError>).code).toBe('not_found')
    expect(opened).toHaveLength(0)
  })

  it('throws unreadable for a file that is not a database', async () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(live, 'not sqlite at all, just bytes')
    expect(() => readGeotaggedPhotos(lib, 0, 1)).toThrow(expect.objectContaining({ code: 'unreadable' }))
  })
})

describe('localIsoFromTs', () => {
  it('matches Python isoformat, with microseconds only when nonzero', () => {
    expect(localIsoFromTs(0, -3600)).toBe('1969-12-31T23:00:00')
    expect(localIsoFromTs(1.25, 0)).toBe('1970-01-01T00:00:01.250000')
  })
})
