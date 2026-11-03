import * as L from 'leaflet'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Trip } from '../types/trip'
import TripMap from './TripMap'

const trip: Trip = {
  stops: [
    { name: 'Dublin', kind: 'major', at: [53.3498, -6.2603], nights: 3 },
    { name: 'Galway', kind: 'minor', at: [53.2707, -9.0568] },
  ],
  legs: [{ date: '2026-05-01', mode: 'drive', via: ['Dublin', 'Galway'], enabled: true }],
}

describe('TripMap', () => {
  it('uses OSM tiles and renders one marker per visible stop', () => {
    const { container } = render(<TripMap trip={trip} onAction={vi.fn()} addMode={false} />)

    const tiles = container.querySelectorAll<HTMLImageElement>('img.leaflet-tile')
    expect(tiles.length).toBeGreaterThan(0)
    for (const tile of tiles) expect(tile.src).toContain('tile.openstreetmap.org')

    expect(container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(2)
    expect(container.querySelector('.leaflet-control-attribution')).toHaveTextContent('OpenStreetMap contributors')
    expect(container).toHaveTextContent('straight-line preview')
  })

  it('draws no marker for a hidden stop', () => {
    const hidden: Trip = { ...trip, stops: [...trip.stops, { name: 'LHR', kind: 'hidden', at: [51.47, -0.45] }] }
    const { container } = render(<TripMap trip={hidden} onAction={vi.fn()} addMode={false} />)
    expect(container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(2)
  })
})

describe('TripMap framing', () => {
  const fit = () => vi.spyOn(L.Map.prototype, 'fitBounds')

  it('fits the map to the visible stops on mount', () => {
    const spy = fit()
    render(<TripMap trip={trip} onAction={vi.fn()} addMode={false} />)
    expect(spy).toHaveBeenCalledTimes(1)
    const bounds = spy.mock.calls[0][0] as L.LatLngBounds
    expect(bounds.getSouth()).toBeCloseTo(53.2707)
    expect(bounds.getNorth()).toBeCloseTo(53.3498)
    spy.mockRestore()
  })

  it('refits to the current stops when frameKey changes', () => {
    const spy = fit()
    const { rerender } = render(<TripMap trip={trip} onAction={vi.fn()} addMode={false} frameKey={0} />)
    const after: Trip = { ...trip, stops: [trip.stops[0]] }
    rerender(<TripMap trip={after} onAction={vi.fn()} addMode={false} frameKey={1} />)
    expect(spy).toHaveBeenCalledTimes(2)
    const bounds = spy.mock.calls[1][0] as L.LatLngBounds
    expect(bounds.getSouth()).toBeCloseTo(53.3498)
    spy.mockRestore()
  })

  it('does not refit when stops change without a new frameKey', () => {
    const spy = fit()
    const { rerender } = render(<TripMap trip={trip} onAction={vi.fn()} addMode={false} frameKey={0} />)
    rerender(<TripMap trip={{ ...trip, stops: [trip.stops[0]] }} onAction={vi.fn()} addMode={false} frameKey={0} />)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
