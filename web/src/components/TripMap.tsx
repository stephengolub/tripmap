import { divIcon, latLngBounds, type LeafletMouseEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { framingPoints, resolveVia } from '../trip/geo'
import type { TripAction } from '../trip/reducer'
import type { LatLon, Stop, Trip } from '../types/trip'
import './TripMap.css'

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// Same palette as the rendered PNG: red pins for overnights, gold stars for quick stops.
const PIN_ICON = divIcon({
  className: 'trip-marker trip-marker-major',
  html: '<svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="#d62828" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#fff"/></svg>',
  iconSize: [24, 32],
  iconAnchor: [12, 32],
  tooltipAnchor: [0, -28],
})

const STAR_ICON = divIcon({
  className: 'trip-marker trip-marker-minor',
  html: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 1.5l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.6 5.6 21.1 7 14l-5.3-5 7.2-.9z" fill="#f2b705" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  tooltipAnchor: [0, -10],
})

const DASHED_MODES = new Set(['boat', 'flight'])

// World view when the trip has no stops yet.
const DEFAULT_CENTER: LatLon = [30, 0]
const DEFAULT_ZOOM = 2

type Props = {
  trip: Pick<Trip, 'stops' | 'legs'>
  onAction: (action: TripAction) => void
  // In add mode the next map click creates a minor stop there.
  addMode: boolean
  // Called after add mode places a stop, with the new stop's position.
  onStopAdded?: (at: LatLon) => void
  // Map clicks outside add mode, e.g. placing a route point from the leg list.
  onMapClick?: (at: LatLon) => void
  // Changing this value refits the map to the visible stops. Drags and edits don't refit.
  frameKey?: number
}

// Refits the map when frameKey changes (and once on mount). Stops are read from a ref,
// so moving a pin doesn't trigger a refit.
function FitToStops({ stops, frameKey }: { stops: Stop[]; frameKey: number }) {
  const map = useMap()
  const stopsRef = useRef(stops)
  stopsRef.current = stops
  useEffect(() => {
    const points = framingPoints(stopsRef.current)
    if (points.length === 0) return
    map.fitBounds(latLngBounds(points), { padding: [40, 40], maxZoom: 14 })
  }, [map, frameKey])
  return null
}

function ClickHandler({ addMode, onAction, onStopAdded, onMapClick }: Omit<Props, 'trip'>) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      const at: LatLon = [e.latlng.lat, e.latlng.lng]
      if (addMode) {
        onAction({ type: 'addStop', stop: { name: 'New stop', kind: 'minor', at } })
        onStopAdded?.(at)
      } else {
        onMapClick?.(at)
      }
    },
  })
  return null
}

function StopMarker({ stop, onAction }: { stop: Stop; onAction: Props['onAction'] }) {
  const handlers = useMemo(
    () => ({
      dragend(e: { target: { getLatLng(): { lat: number; lng: number } } }) {
        const { lat, lng } = e.target.getLatLng()
        onAction({ type: 'moveStop', name: stop.name, at: [lat, lng] })
      },
    }),
    [onAction, stop.name],
  )
  return (
    <Marker
      position={stop.at}
      icon={stop.kind === 'major' ? PIN_ICON : STAR_ICON}
      draggable
      eventHandlers={handlers}
      title={stop.name}
      alt={stop.name}
    >
      <Tooltip>{stop.name}</Tooltip>
    </Marker>
  )
}

// The editor's map. Lines are straight segments between a leg's resolved
// via points; the road, rail and sea routes are drawn by the render step.
export default function TripMap({ trip, onAction, addMode, onStopAdded, onMapClick, frameKey = 0 }: Props) {

  const lines = trip.legs
    .map((leg, i) => ({
      key: i,
      dashed: DASHED_MODES.has(leg.mode),
      enabled: leg.enabled,
      points: leg.via.map((v) => resolveVia(trip, v)).filter((p): p is LatLon => p !== null),
    }))
    .filter((line) => line.enabled && line.points.length >= 2)

  return (
    <div className={`trip-map${addMode ? ' trip-map-adding' : ''}`}>
      <MapContainer className="trip-map-canvas" center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} scrollWheelZoom>
        <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
        <FitToStops stops={trip.stops} frameKey={frameKey} />
        <ClickHandler addMode={addMode} onAction={onAction} onStopAdded={onStopAdded} onMapClick={onMapClick} />
        {lines.map((line) => (
          <Polyline
            key={line.key}
            positions={line.points}
            pathOptions={{ color: '#1d3557', weight: 3, opacity: 0.85, dashArray: line.dashed ? '8 8' : undefined }}
          />
        ))}
        {trip.stops
          .filter((s) => s.kind !== 'hidden')
          .map((s) => (
            <StopMarker key={s.name} stop={s} onAction={onAction} />
          ))}
      </MapContainer>
      <p className="trip-map-note">
        {addMode ? 'Click the map to place a new stop. ' : ''}
        Lines are a straight-line preview; the real routes come from the render step.
      </p>
    </div>
  )
}
