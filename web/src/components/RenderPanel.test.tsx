import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderTrip } from '../api/client'
import type { Trip } from '../types/trip'
import RenderPanel from './RenderPanel'

vi.mock('../api/client', () => ({ renderTrip: vi.fn() }))

const trip: Trip = {
  stops: [
    { name: 'Bologna', kind: 'major', at: [44.4949, 11.3426] },
    { name: 'Rome', kind: 'major', at: [41.9028, 12.4964] },
  ],
  legs: [{ date: '2024-05-03', mode: 'train', via: ['Bologna', 'Rome'], enabled: true }],
}

describe('RenderPanel', () => {
  const createObjectURL = vi.fn()
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    vi.mocked(renderTrip).mockReset()
    createObjectURL.mockReset()
    revokeObjectURL.mockReset()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the trip and shows the PNG with a download link', async () => {
    const png = new Blob(['png'], { type: 'image/png' })
    vi.mocked(renderTrip).mockResolvedValue(png)
    createObjectURL.mockReturnValue('blob:render-1')
    const onRendered = vi.fn()
    render(<RenderPanel trip={trip} onRendered={onRendered} />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Show day trips' }))
    await userEvent.click(screen.getByRole('button', { name: 'Render' }))

    expect(await screen.findByRole('img', { name: 'Rendered route map' })).toHaveAttribute(
      'src',
      'blob:render-1',
    )
    expect(screen.getByRole('link', { name: 'Download PNG' })).toHaveAttribute('href', 'blob:render-1')
    expect(renderTrip).toHaveBeenCalledWith(trip, { size: 1600, with_day_trips: true })
    expect(createObjectURL).toHaveBeenCalledWith(png)
    expect(onRendered).toHaveBeenCalledWith(png)
  })

  it('revokes the previous URL when a new render replaces it', async () => {
    vi.mocked(renderTrip).mockResolvedValue(new Blob(['png']))
    createObjectURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
    render(<RenderPanel trip={trip} />)

    await userEvent.click(screen.getByRole('button', { name: 'Render' }))
    await screen.findByRole('img')
    expect(revokeObjectURL).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Render' }))
    await vi.waitFor(() =>
      expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:second'),
    )
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first')
  })

  it('shows the server error', async () => {
    vi.mocked(renderTrip).mockRejectedValue(new Error('Chrome was not found.'))
    render(<RenderPanel trip={trip} />)
    await userEvent.click(screen.getByRole('button', { name: 'Render' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Chrome was not found.')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('disables Render when the trip has a validation error', () => {
    const broken: Trip = {
      ...trip,
      legs: [{ ...trip.legs[0], via: ['Bologna', 'Napoli'] }],
    }
    render(<RenderPanel trip={broken} />)
    expect(screen.getByRole('button', { name: 'Render' })).toBeDisabled()
  })
})
