import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducer } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { tripReducer, type TripState } from '../trip/reducer'
import type { Trip } from '../types/trip'
import StopList from './StopList'

const trip: Trip = {
  stops: [
    { name: 'Dublin', kind: 'major', at: [53.3498, -6.2603], nights: 3 },
    { name: 'Galway', kind: 'major', at: [53.2707, -9.0568], nights: 3 },
    { name: 'Cliffs', kind: 'minor', at: [52.9715, -9.4309] },
  ],
  legs: [{ date: '2026-05-01', mode: 'drive', via: ['Dublin', 'Galway'], enabled: true }],
}

// StopList wired to the real reducer, the way App uses it.
function Editor() {
  const [state, dispatch] = useReducer(tripReducer, trip as TripState)
  return <StopList stops={state.stops} onAction={dispatch} error={state.error} />
}

describe('StopList', () => {
  it('shows one row per stop with a read-only coordinate', () => {
    render(<StopList stops={trip.stops} onAction={vi.fn()} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('listitem', { name: 'Galway' })).toHaveTextContent('53.27070, -9.05680')
    expect(screen.getByRole('combobox', { name: 'Kind of Cliffs' })).toHaveValue('minor')
  })

  it('dispatches renameStop when the name is committed', async () => {
    const onAction = vi.fn()
    render(<StopList stops={trip.stops} onAction={onAction} />)
    const name = screen.getByRole('textbox', { name: 'Name of Galway' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Gaillimh{Enter}')
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith({ type: 'renameStop', from: 'Galway', to: 'Gaillimh' })
  })

  it('dispatches setStopKind from the kind select', async () => {
    const onAction = vi.fn()
    render(<StopList stops={trip.stops} onAction={onAction} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kind of Cliffs' }), 'hidden')
    expect(onAction).toHaveBeenCalledWith({ type: 'setStopKind', name: 'Cliffs', kind: 'hidden' })
  })

  it('shows the refusal message when a referenced stop cannot be removed', async () => {
    render(<Editor />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Dublin' }))
    expect(screen.getByRole('alert')).toHaveTextContent("Can't remove Dublin: leg 1 still uses it")
    expect(screen.getByRole('listitem', { name: 'Dublin' })).toBeInTheDocument()
  })

  it('removes an unreferenced stop and clears the message', async () => {
    render(<Editor />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Dublin' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Cliffs' }))
    expect(screen.queryByRole('listitem', { name: 'Cliffs' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports the stop whose row takes focus, and marks that row as current', async () => {
    const onSelect = vi.fn()
    const { rerender } = render(<StopList stops={trip.stops} onAction={vi.fn()} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('textbox', { name: 'Name of Galway' }))
    expect(onSelect).toHaveBeenCalledWith('Galway')

    rerender(<StopList stops={trip.stops} onAction={vi.fn()} onSelect={onSelect} selected="Galway" />)
    expect(screen.getByRole('listitem', { name: 'Galway' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('listitem', { name: 'Dublin' })).not.toHaveAttribute('aria-current')
  })
})
