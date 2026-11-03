import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { validateTrip } from '../trip/validate'
import type { Trip } from '../types/trip'
import LegList from './LegList'

const trip: Trip = {
  stops: [
    { name: 'Dublin', kind: 'major', at: [53.3498, -6.2603], nights: 3 },
    { name: 'Galway', kind: 'major', at: [53.2707, -9.0568], nights: 3 },
    { name: 'Cliffs', kind: 'minor', at: [52.9715, -9.4309] },
  ],
  legs: [
    { date: '2026-05-01', mode: 'drive', via: ['Dublin', 'Galway'], enabled: true },
    { date: '2026-05-02', mode: 'drive', day_trip: true, via: ['Galway', 'Cliffs', 'Galway'], enabled: true },
  ],
}

describe('LegList', () => {
  it('renders one card per leg with its via list', () => {
    render(<LegList trip={trip} onAction={vi.fn()} />)
    expect(screen.getByRole('listitem', { name: 'Leg 1' })).toHaveTextContent('2026-05-01')
    expect(screen.getAllByRole('combobox', { name: /^Leg 2 stop/ })).toHaveLength(3)
    expect(screen.getAllByRole('checkbox', { name: 'Day trip' })[1]).toBeChecked()
  })

  it('dispatches setLegMode when the mode select changes', async () => {
    const onAction = vi.fn()
    render(<LegList trip={trip} onAction={onAction} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Leg 1 mode' }), 'train')
    expect(onAction).toHaveBeenCalledWith({ type: 'setLegMode', legIndex: 0, mode: 'train' })
  })

  it('dispatches via and leg edits', async () => {
    const onAction = vi.fn()
    render(<LegList trip={trip} onAction={onAction} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Leg 2 stop 2' }))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'removeVia', legIndex: 1, viaIndex: 1 })
    await userEvent.click(screen.getAllByRole('button', { name: 'Add stop to leg' })[0])
    expect(onAction).toHaveBeenLastCalledWith({ type: 'insertVia', legIndex: 0, viaIndex: 2, value: '' })
    await userEvent.click(screen.getAllByRole('checkbox', { name: 'Enabled' })[0])
    expect(onAction).toHaveBeenLastCalledWith({ type: 'setLegEnabled', legIndex: 0, enabled: false })
    await userEvent.click(screen.getByRole('button', { name: 'Remove leg 1' }))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'removeLeg', legIndex: 0 })
  })

  it('shows the suggestion without changing the select', async () => {
    const onAction = vi.fn()
    const suggest = vi.fn().mockResolvedValue({ mode: 'train', reason: 'A rail line runs along the route.' })
    render(<LegList trip={trip} onAction={onAction} suggest={suggest} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Suggest mode' })[0])
    expect(suggest).toHaveBeenCalledWith([53.3498, -6.2603], [53.2707, -9.0568])
    expect(await screen.findByText('Suggested: train. A rail line runs along the route.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Leg 1 mode' })).toHaveValue('drive')
    expect(onAction).not.toHaveBeenCalled()
  })

  it('shows the inline validation error on the bad entry', () => {
    const bad: Trip = { ...trip, legs: [{ ...trip.legs[0], via: ['Dublin', 'Atlantis'] }] }
    render(<LegList trip={bad} onAction={vi.fn()} errors={validateTrip(bad)} />)
    expect(screen.getByText('No stop named Atlantis')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Leg 1 stop 2' })).toHaveAttribute('aria-invalid', 'true')
  })
})
