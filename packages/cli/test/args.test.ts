import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PORT, defaultLibrary, parseCliArgs, UsageError } from '../src/cli.ts'

const env = {} as NodeJS.ProcessEnv
const LIBRARY = join(homedir(), 'Pictures', 'Photos Library.photoslibrary')
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

function usageError(argv: string[]): UsageError {
  try {
    parseCliArgs(argv, env)
  } catch (err) {
    expect(err).toBeInstanceOf(UsageError)
    return err as UsageError
  }
  throw new Error(`expected a usage error for ${argv.join(' ')}`)
}

describe('defaultLibrary', () => {
  it('uses TRIPMAP_LIBRARY when set, else the Photos default', () => {
    expect(defaultLibrary({ TRIPMAP_LIBRARY: '/tmp/Other.photoslibrary' })).toBe('/tmp/Other.photoslibrary')
    expect(defaultLibrary({})).toBe(LIBRARY)
  })
})

describe('trips', () => {
  it('has the Python defaults', () => {
    expect(parseCliArgs(['trips'], env)).toEqual({ cmd: 'trips', library: LIBRARY, since: undefined, awayKm: 150, minPhotos: 30 })
  })
  it('reads every option', () => {
    expect(parseCliArgs(['trips', '--since', '2020-01-01', '--away-km', '80.5', '--min-photos', '10', '--library', '/x'], env))
      .toEqual({ cmd: 'trips', library: '/x', since: '2020-01-01', awayKm: 80.5, minPhotos: 10 })
  })
  it('rejects a bad number or date', () => {
    expect(usageError(['trips', '--min-photos', 'many']).exitCode).toBe(2)
    expect(usageError(['trips', '--since', '1/2/2020']).exitCode).toBe(2)
  })
})

describe('draft', () => {
  it('writes to stdout by default and reads the library from the environment', () => {
    expect(parseCliArgs(['draft', '--from', '2020-01-01', '--to', '2020-01-05'], { TRIPMAP_LIBRARY: '/lib' })).toEqual({
      cmd: 'draft', library: '/lib', from: '2020-01-01', to: '2020-01-05', output: undefined, title: undefined,
    })
  })
  it('reads -o, --title, --library and the listener pair', () => {
    expect(parseCliArgs(['draft', '--from', '2020-01-01', '--to', '2020-01-05', '-o', 'out.yaml', '--title', 'A trip',
      '--library', '/l', '--port', '50000', '--token', '0123456789abcdef'], env)).toEqual({
      cmd: 'draft', library: '/l', from: '2020-01-01', to: '2020-01-05', output: 'out.yaml', title: 'A trip',
      listen: { port: 50000, token: '0123456789abcdef' },
    })
  })
  it('requires --from and --to', () => {
    expect(usageError(['draft', '--to', '2020-01-05']).message).toMatch(/--from/)
    expect(usageError(['draft', '--from', '2020-01-05']).message).toMatch(/--to/)
  })
  it('rejects an end before the start, a lone --port, and a malformed token', () => {
    usageError(['draft', '--from', '2020-01-05', '--to', '2020-01-01'])
    usageError(['draft', '--from', '2020-01-01', '--to', '2020-01-05', '--port', '50000'])
    usageError(['draft', '--from', '2020-01-01', '--to', '2020-01-05', '--port', '50000', '--token', 'nothex'])
    usageError(['draft', '--from', '2020-01-01', '--to', '2020-01-05', '--port', '70000', '--token', '0123456789abcdef'])
  })
  it('exits with code 2 when --from is missing', () => {
    const run = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', CLI, 'draft', '--to', '2020-01-05'], { encoding: 'utf8' })
    expect(run.status).toBe(2)
    expect(run.stderr).toMatch(/draft needs --from/)
    expect(run.stdout).toBe('')
  })
})

describe('render', () => {
  it('has the Python defaults', () => {
    expect(parseCliArgs(['render', 'trip.yaml'], env)).toEqual({
      cmd: 'render', trip: 'trip.yaml', photo: undefined, size: 4000, out: undefined, dayTrips: false, frame: 'basemap',
    })
  })
  it('reads --frame route, and rejects any other frame', () => {
    expect(parseCliArgs(['render', 'trip.yaml', '--frame', 'route'], env)).toMatchObject({ cmd: 'render', frame: 'route' })
    expect(usageError(['render', 'trip.yaml', '--frame', 'wide']).message).toMatch(/--frame must be basemap or route/)
  })
  it('reads every option', () => {
    expect(parseCliArgs(['render', 'trip.yaml', '--photo', 'bg.jpg', '--size', '2000', '--out', 'maps', '--day-trips'], env)).toEqual({
      cmd: 'render', trip: 'trip.yaml', photo: 'bg.jpg', size: 2000, out: 'maps', dayTrips: true, frame: 'basemap',
    })
  })
  it('needs exactly one trip file', () => {
    usageError(['render'])
    usageError(['render', 'a.yaml', 'b.yaml'])
  })
})

describe('serve', () => {
  it('defaults to port 8787', () => {
    expect(DEFAULT_PORT).toBe(8787)
    expect(parseCliArgs(['serve'], env)).toEqual({ cmd: 'serve', port: 8787, library: LIBRARY })
    expect(parseCliArgs(['serve', '--port', '9000', '--library', '/x'], env)).toEqual({ cmd: 'serve', port: 9000, library: '/x' })
  })
})

describe('top level', () => {
  it('handles help, version, unknown commands and unknown flags', () => {
    expect(parseCliArgs([], env)).toEqual({ cmd: 'help' })
    expect(parseCliArgs(['draft', '--help'], env)).toEqual({ cmd: 'help' })
    expect(parseCliArgs(['--version'], env)).toEqual({ cmd: 'version' })
    usageError(['fly'])
    usageError(['serve', '--bogus'])
  })
})
