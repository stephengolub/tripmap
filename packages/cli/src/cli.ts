#!/usr/bin/env node
// The `tripmap` command: argument parsing with node:util parseArgs, then dispatch. Subcommands
// not wired in yet report that they are not implemented.

import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { runDraft, type DraftDeps } from './draft.ts'
import { startServe } from './serve.ts'

export const DEFAULT_PORT = 8787

export const USAGE = `usage: tripmap <command> [options]

commands:
  trips   [--since DATE] [--away-km N] [--min-photos N] [--library PATH]
          list trips found in your Photos library
  draft   --from DATE --to DATE [-o FILE] [--title TEXT] [--library PATH] [--port P --token T]
          detect a trip's route from photo GPS and write an editable YAML (stdout without -o)
  render  TRIP [--photo FILE] [--size N] [--out DIR] [--day-trips]
          draw a trip YAML as transparent PNG overlay(s)
  serve   [--port P] [--library PATH]
          run the local web app on 127.0.0.1 (default port ${DEFAULT_PORT})

  --version  print the version
  --help     print this help`

export type Command =
  | { cmd: 'help' }
  | { cmd: 'version' }
  | { cmd: 'trips'; library: string; since?: string; awayKm: number; minPhotos: number }
  | {
      cmd: 'draft'
      library: string
      from: string
      to: string
      output?: string
      title?: string
      listen?: { port: number; token: string }
    }
  | { cmd: 'render'; trip: string; photo?: string; size: number; out?: string; dayTrips: boolean }
  | { cmd: 'serve'; port: number; library: string }

/** A bad command line. `main` prints the message and the usage, then exits with code 2. */
export class UsageError extends Error {
  readonly exitCode = 2
}

/** The package version, read from package.json next to dist/ so there is one source of truth. */
export function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  return pkg.version
}

/** `TRIPMAP_LIBRARY`, else the default macOS Photos library. Same rule as the Python CLI. */
export function defaultLibrary(env: NodeJS.ProcessEnv = process.env): string {
  return env.TRIPMAP_LIBRARY || join(homedir(), 'Pictures', 'Photos Library.photoslibrary')
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function date(flag: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new UsageError(`${flag} must be a date as YYYY-MM-DD, got "${value}"`)
  }
  return value
}

function number(flag: string, value: string | undefined, fallback: number, opts: { int?: boolean; min?: number; max?: number } = {}): number {
  if (value === undefined) return fallback
  const n = Number(value)
  const ok = value.trim() !== '' && Number.isFinite(n) && (!opts.int || Number.isInteger(n))
    && (opts.min === undefined || n >= opts.min) && (opts.max === undefined || n <= opts.max)
  if (!ok) throw new UsageError(`${flag} must be ${opts.int ? 'a whole number' : 'a number'}${
    opts.min !== undefined && opts.max !== undefined ? ` from ${opts.min} to ${opts.max}` : ''}, got "${value}"`)
  return n
}

function port(value: string | undefined, fallback: number): number {
  return number('--port', value, fallback, { int: true, min: 1, max: 65535 })
}

/** Run parseArgs, turning its errors (unknown flag, missing value) into UsageErrors. */
function strict<T>(run: () => T): T {
  try {
    return run()
  } catch (err) {
    throw new UsageError((err as Error).message)
  }
}

/** Turn argv (without node and the script path) into a command, or throw a UsageError. */
export function parseCliArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Command {
  const [cmd, ...rest] = argv
  if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'help') return { cmd: 'help' }
  if (cmd === '--version' || cmd === '-V') return { cmd: 'version' }
  if (rest.includes('--help') || rest.includes('-h')) return { cmd: 'help' }

  switch (cmd) {
    case 'trips': {
      const { values } = strict(() => parseArgs({ args: rest, strict: true, options: {
        since: { type: 'string' },
        'away-km': { type: 'string' },
        'min-photos': { type: 'string' },
        library: { type: 'string' },
      } }))
      return {
        cmd: 'trips',
        library: values.library ?? defaultLibrary(env),
        since: date('--since', values.since),
        awayKm: number('--away-km', values['away-km'], 150, { min: 0 }),
        minPhotos: number('--min-photos', values['min-photos'], 30, { int: true, min: 1 }),
      }
    }
    case 'draft': {
      const { values } = strict(() => parseArgs({ args: rest, strict: true, options: {
        from: { type: 'string' },
        to: { type: 'string' },
        output: { type: 'string', short: 'o' },
        title: { type: 'string' },
        library: { type: 'string' },
        port: { type: 'string' },
        token: { type: 'string' },
      } }))
      const from = date('--from', values.from)
      const to = date('--to', values.to)
      if (from === undefined) throw new UsageError('draft needs --from DATE')
      if (to === undefined) throw new UsageError('draft needs --to DATE')
      if (to < from) throw new UsageError('--to is before --from')
      if ((values.port === undefined) !== (values.token === undefined)) {
        throw new UsageError('--port and --token go together')
      }
      const command: Command = {
        cmd: 'draft',
        library: values.library ?? defaultLibrary(env),
        from,
        to,
        output: values.output,
        title: values.title,
      }
      if (values.token !== undefined) {
        if (!/^[0-9a-f]{16}$/i.test(values.token)) throw new UsageError('--token must be 16 hex characters')
        command.listen = { port: port(values.port, 0), token: values.token }
      }
      return command
    }
    case 'render': {
      const { values, positionals } = strict(() => parseArgs({ args: rest, strict: true, allowPositionals: true, options: {
        photo: { type: 'string' },
        size: { type: 'string' },
        out: { type: 'string' },
        'day-trips': { type: 'boolean', default: false },
      } }))
      if (positionals.length !== 1) throw new UsageError('render needs exactly one TRIP file')
      return {
        cmd: 'render',
        trip: positionals[0]!,
        photo: values.photo,
        size: number('--size', values.size, 4000, { int: true, min: 100, max: 20000 }),
        out: values.out,
        dayTrips: values['day-trips'] ?? false,
      }
    }
    case 'serve': {
      const { values } = strict(() => parseArgs({ args: rest, strict: true, options: {
        port: { type: 'string' },
        library: { type: 'string' },
      } }))
      return { cmd: 'serve', port: port(values.port, DEFAULT_PORT), library: values.library ?? defaultLibrary(env) }
    }
    default:
      throw new UsageError(`unknown command "${cmd}"`)
  }
}

/** Run the command line and return the exit code. `deps` lets tests stub the draft and listener. */
export async function main(argv: string[], deps: DraftDeps = {}): Promise<number> {
  let command: Command
  try {
    command = parseCliArgs(argv)
  } catch (err) {
    if (!(err instanceof UsageError)) throw err
    console.error(`tripmap: ${err.message}\n\n${USAGE}`)
    return err.exitCode
  }
  switch (command.cmd) {
    case 'help':
      console.log(USAGE)
      return 0
    case 'version':
      console.log(version())
      return 0
    case 'draft':
      return runDraft(command, deps)
    case 'serve':
      return runServe(command.port, command.library)
    default:
      console.error(`tripmap: "${command.cmd}" is not implemented yet`)
      return 1
  }
}

/** Run the local server until interrupted. */
async function runServe(portNumber: number, library: string): Promise<number> {
  let serving
  try {
    serving = await startServe({ port: portNumber, library })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    console.error(`tripmap: cannot listen on 127.0.0.1:${portNumber} (${code === 'EADDRINUSE' ? 'port is busy' : code ?? (e as Error).message})`)
    return 1
  }
  console.error(`Serving tripmap on http://127.0.0.1:${serving.port} (Ctrl-C to stop)`)
  await new Promise<void>((resolve) => {
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => resolve())
  })
  await serving.close()
  return 0
}

/** True when this module is the program being run (directly or through the npm bin symlink). */
function isEntryPoint(): boolean {
  const script = process.argv[1]
  if (!script) return false
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2))
}
