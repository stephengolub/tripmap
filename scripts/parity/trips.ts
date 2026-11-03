// The parity trips and where their outputs live. Shared by run.ts and compare.ts.
// Trip dates are personal data, so they live outside the repo in
// ~/.cache/tripmap/parity/trips.json: {"<trip>": {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}}.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PARITY_DIR = join(homedir(), '.cache', 'tripmap', 'parity')
export const BASELINE_DIR = join(homedir(), '.cache', 'tripmap', 'regression-baseline')

const TRIPS_FILE = join(PARITY_DIR, 'trips.json')
if (!existsSync(TRIPS_FILE)) throw new Error(`missing ${TRIPS_FILE}; see the comment in scripts/parity/trips.ts`)

export const TRIPS: Record<string, { from: string; to: string }> = JSON.parse(readFileSync(TRIPS_FILE, 'utf8'))
