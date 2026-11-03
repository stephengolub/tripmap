// The trip document. Same field names as the trip YAML (docs/trip-format.md),
// plus `enabled` on each leg (docs/api.md). Mirrors build_trip in src/tripmap/__init__.py.

export type LatLon = [number, number]

export type Mode = 'drive' | 'train' | 'boat' | 'flight'

export type StopKind = 'major' | 'minor' | 'hidden'

export type Basemap = 'auto' | 'island' | 'country' | 'region'

export type LabelSide = 'auto' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'none'

export type Stop = {
  name: string
  kind: StopKind
  at: LatLon
  label?: LabelSide
  // Draft adds these for the YAML comments; the renderer ignores them.
  nights?: number
  photos?: number
  when?: string // e.g. "May 5"
  note?: string // e.g. "layover"
}

// A stop name, or a [lat, lon] route hint.
export type ViaEntry = string | LatLon

export type Leg = {
  date: string // YYYY-MM-DD
  mode: Mode
  day_trip: boolean
  via: ViaEntry[]
  enabled: boolean
}

export type Trip = {
  title?: string
  basemap: Basemap
  stops: Stop[]
  legs: Leg[]
}

// What draft reports beside the trip.
export type Stats = {
  photo_count: number
  overnight_names: string[]
  quick_names: string[]
  hidden_names: string[]
  leg_counts: Partial<Record<Mode, number>>
}
