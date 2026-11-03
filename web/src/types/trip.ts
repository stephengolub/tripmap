// The trip document the browser owns. Same field names as the trip YAML
// (docs/trip-format.md), plus `enabled` on each leg (docs/api.md).

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
  // Draft adds these; the renderer ignores them.
  nights?: number
  photos?: number
}

export type Leg = {
  date: string // YYYY-MM-DD
  mode: Mode
  day_trip?: boolean
  // Stop names and [lat, lon] route hints, in travel order.
  via: (string | LatLon)[]
  enabled: boolean
}

export type Trip = {
  title?: string
  basemap?: Basemap
  stops: Stop[]
  legs: Leg[]
}

// The `stats` that POST /api/trips/draft returns beside the trip.
export type Stats = {
  photo_count: number
  overnight_names: string[]
  quick_names: string[]
  hidden_names: string[]
  leg_counts: Partial<Record<Mode, number>>
}
