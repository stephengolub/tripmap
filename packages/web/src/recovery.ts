// Recovery cache: the open trip's filename and its edits, kept in localStorage so a
// page refresh doesn't lose them. The server never sees this; it is browser-only.
import type { Trip } from './types/trip'

const KEY = 'tripmap:recovery'
const VERSION = 1

export type Recovery = {
  filename: string
  // The trip as last drafted, opened or saved; `current` is what the editor shows.
  base: Trip
  current: Trip
  savedAt: string // ISO time of the write
}

type Stored = Recovery & { v: typeof VERSION }

function isTrip(value: unknown): value is Trip {
  if (typeof value !== 'object' || value === null) return false
  const t = value as Partial<Trip>
  return Array.isArray(t.stops) && Array.isArray(t.legs)
}

// Returns false if the write failed (quota, storage disabled); the app still works, it just can't recover.
export function saveRecovery(
  entry: Pick<Recovery, 'filename' | 'base' | 'current'>,
  storage: Storage = localStorage,
): boolean {
  const stored: Stored = { v: VERSION, ...entry, savedAt: new Date().toISOString() }
  try {
    storage.setItem(KEY, JSON.stringify(stored))
    return true
  } catch {
    return false
  }
}

// Returns the saved session, or null. A malformed or other-version entry is removed.
export function loadRecovery(storage: Storage = localStorage): Recovery | null {
  const raw = storage.getItem(KEY)
  if (raw === null) return null
  try {
    const data = JSON.parse(raw) as Partial<Stored>
    if (data.v === VERSION && typeof data.filename === 'string' && isTrip(data.base) && isTrip(data.current)) {
      return { filename: data.filename, base: data.base, current: data.current, savedAt: String(data.savedAt) }
    }
  } catch {
    // fall through: unreadable JSON is treated like a malformed entry
  }
  storage.removeItem(KEY)
  return null
}

export function clearRecovery(storage: Storage = localStorage): void {
  storage.removeItem(KEY)
}
