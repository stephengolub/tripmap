// `tripmap draft`: detect the route, write the YAML (to -o or stdout), and, with --port and
// --token, hand it to the hosted page through the one-shot listener. The YAML always reaches
// stdout when the listener cannot start, so the page's paste box still works.

import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { startListener, type Listener, type ListenerOptions } from './listener.ts'

export interface DraftRequest {
  library: string
  from: string
  to: string
  title?: string
  /** The output file's name, for the "tripmap render" hint in the YAML header. */
  filename: string
  /** Progress messages: counts and status only. */
  log: (line: string) => void
}

export interface DraftResult {
  yaml: string
  /** The Python CLI's summary lines (stop names, leg counts). */
  summary: string[]
}

export type DraftFn = (req: DraftRequest) => Promise<DraftResult>

export interface DraftCommand {
  library: string
  from: string
  to: string
  output?: string
  title?: string
  listen?: { port: number; token: string }
}

export interface DraftDeps {
  draft?: DraftFn
  startListener?: (opts: ListenerOptions) => Promise<Listener>
  stdout?: (text: string) => void
  stderr?: (text: string) => void
}

/** The real draft, from the Photos library. Loaded lazily so `--help` never touches core. */
const draftFromPhotos: DraftFn = async (req) => (await import('./photos-draft.ts')).draftFromPhotos(req)

// Errors meant for the user: too few photos, no library, no Full Disk Access.
const USER_ERRORS = new Set(['TripError', 'PhotosError'])

/** Run `draft` and return the exit code. */
export async function runDraft(cmd: DraftCommand, deps: DraftDeps = {}): Promise<number> {
  const out = deps.stdout ?? ((text: string) => void process.stdout.write(text))
  const err = deps.stderr ?? ((text: string) => void process.stderr.write(text))

  let result: DraftResult
  try {
    result = await (deps.draft ?? draftFromPhotos)({
      library: cmd.library, from: cmd.from, to: cmd.to, title: cmd.title,
      filename: cmd.output ? basename(cmd.output) : 'trip.yaml',
      log: (line) => err(`${line}\n`),
    })
  } catch (e) {
    if (e instanceof Error && USER_ERRORS.has(e.name)) {
      err(`tripmap: ${e.message}\n`)
      return 1
    }
    throw e
  }

  // stdout carries only YAML unless it is a plain `-o` run, which prints the Python summary there.
  const summary = cmd.output && !cmd.listen ? out : err
  if (cmd.output) {
    writeFileSync(cmd.output, result.yaml)
    summary(`Wrote ${cmd.output}\n`)
  } else {
    out(result.yaml)
  }
  for (const line of result.summary) summary(`${line}\n`)
  if (cmd.output) summary(`Next: review ${cmd.output}, then tripmap render ${cmd.output} --photo <background photo>\n`)
  if (!cmd.listen) return 0

  const { port, token } = cmd.listen
  let listener: Listener
  try {
    listener = await (deps.startListener ?? startListener)({ port, token, trip: result.yaml })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    err(`tripmap: cannot listen on 127.0.0.1:${port} (${code === 'EADDRINUSE' ? 'port is busy' : code ?? (e as Error).message}); paste the YAML into the page instead\n`)
    if (cmd.output) out(result.yaml)
    return 1
  }
  err(`Waiting for the page to pick this up on 127.0.0.1:${listener.port}\n`)
  if ((await listener.done) === 'served') return 0
  err('tripmap: the page did not pick up the trip in time; paste the YAML into the page instead\n')
  if (cmd.output) out(result.yaml)
  return 1
}
