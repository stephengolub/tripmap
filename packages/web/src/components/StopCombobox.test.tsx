import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { LatLon, Stop } from '../types/trip'
import StopCombobox, { ROUTE_POINT_LABEL } from './StopCombobox'

const DUBLIN: LatLon = [53.3498, -6.2603]

const stops: Stop[] = [
  { name: 'Dublin', kind: 'major', at: DUBLIN, nights: 3 },
  { name: 'Galway', kind: 'major', at: [53.2707, -9.0568], nights: 1 },
  { name: 'Kilkenny', kind: 'minor', at: [52.6541, -7.2448] },
]

function setup(props: Partial<Parameters<typeof StopCombobox>[0]> = {}) {
  const onChange = vi.fn()
  render(<StopCombobox value="Dublin" stops={stops} previous={DUBLIN} onChange={onChange} {...props} />)
  return { onChange, input: screen.getByRole('combobox') }
}

function optionNames(): string[] {
  return within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((o) => o.textContent ?? '')
}

describe('StopCombobox', () => {
  it('filters case-insensitively as you type', async () => {
    const { input } = setup()
    await userEvent.type(input, 'gal')
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Galway')
    expect(options[0]).toHaveTextContent('major')
    expect(options[0]).toHaveTextContent('1 night')
  })

  it('selects the highlighted option with ArrowDown then Enter', async () => {
    const { input, onChange } = setup()
    await userEvent.type(input, 'gal')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('Galway')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('lists stops nearest first from the previous point', async () => {
    const { input } = setup()
    await userEvent.click(input)
    const names = optionNames()
    // Kilkenny is ~100 km from Dublin, Galway ~190 km.
    expect(names[0]).toContain('Dublin')
    expect(names[1]).toContain('Kilkenny')
    expect(names[2]).toContain('Galway')
  })

  it('reorders when the previous point changes', async () => {
    const { input } = setup({ previous: [53.27, -9.05] })
    await userEvent.click(input)
    expect(optionNames()[0]).toContain('Galway')
  })

  it('closes on Escape without changing the value', async () => {
    const { input, onChange } = setup()
    await userEvent.type(input, 'gal')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveValue('Dublin')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('offers "Route point on map" and calls onPickOnMap', async () => {
    const onPickOnMap = vi.fn()
    const { input, onChange } = setup({ onPickOnMap })
    await userEvent.click(input)
    await userEvent.click(screen.getByRole('option', { name: ROUTE_POINT_LABEL }))
    expect(onPickOnMap).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('wires the ARIA combobox to its listbox and active option', async () => {
    const { input } = setup()
    expect(input).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(input)
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
    await userEvent.keyboard('{ArrowDown}')
    const first = within(screen.getByRole('listbox')).getAllByRole('option')[0]
    expect(input).toHaveAttribute('aria-activedescendant', first.id)
    expect(first).toHaveAttribute('aria-selected', 'true')
  })

  it('shows a point value as coordinates and an inline error', () => {
    setup({ value: [53.1, -6.5], error: 'No stop named X' })
    expect(screen.getByRole('combobox')).toHaveValue('53.1000, -6.5000')
    expect(screen.getByText('No stop named X')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true')
  })
})
