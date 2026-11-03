import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { draftTrip, getPhotosStatus } from './api/client'
import App from './App'

vi.mock('./api/client', () => ({ getPhotosStatus: vi.fn(), draftTrip: vi.fn(), suggestMode: vi.fn() }))

const status = vi.mocked(getPhotosStatus)
const draft = vi.mocked(draftTrip)

beforeEach(() => {
  status.mockReset()
  draft.mockReset()
})

describe('App', () => {
  it('checks Photos, shows the form, drafts, and shows the counts', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    draft.mockResolvedValue({
      trip: {
        title: 'Sample',
        basemap: 'auto',
        stops: [
          { name: 'Dublin', kind: 'major', at: [53.35, -6.26], label: 'auto' },
          { name: 'Galway', kind: 'major', at: [53.27, -9.06], label: 'auto' },
          { name: 'Cliffs', kind: 'minor', at: [52.97, -9.43], label: 'auto' },
        ],
        legs: [
          { date: '2026-05-02', mode: 'drive', day_trip: false, via: ['Dublin', 'Galway'], enabled: true },
          { date: '2026-05-03', mode: 'drive', day_trip: true, via: ['Galway', 'Cliffs', 'Galway'], enabled: true },
        ],
      },
      stats: {
        photo_count: 121,
        overnight_names: ['Dublin', 'Galway'],
        quick_names: ['Cliffs'],
        hidden_names: [],
        leg_counts: { drive: 2 },
      },
    })
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByText('Checking Photos access...')).toBeInTheDocument()
    const from = await screen.findByLabelText('From')
    const submit = screen.getByRole('button', { name: 'Detect route' })
    expect(submit).toBeDisabled()

    await user.type(from, '2026-05-01')
    await user.type(screen.getByLabelText('To'), '2026-05-04')
    expect(submit).toBeEnabled()
    await user.click(submit)

    expect(draft).toHaveBeenCalledWith('2026-05-01', '2026-05-04')
    const summary = await screen.findByTestId('draft-summary')
    expect(summary).toHaveTextContent('3 stops and 2 legs')
    expect(summary).toHaveTextContent('121 photos')
  })

  it('shows the draft error and keeps the form usable', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    draft.mockRejectedValue(new Error('Too few photos between those dates.'))
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('From'), '2026-05-01')
    await user.type(screen.getByLabelText('To'), '2026-05-04')
    await user.click(screen.getByRole('button', { name: 'Detect route' }))

    expect(await screen.findByText('Too few photos between those dates.')).toBeInTheDocument()
    expect(screen.queryByTestId('draft-summary')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Detect route' })).toBeEnabled()
  })

  it('shows the spinner text while the draft runs', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    draft.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('From'), '2026-05-01')
    await user.type(screen.getByLabelText('To'), '2026-05-04')
    await user.click(screen.getByRole('button', { name: 'Detect route' }))

    expect(await screen.findByText('Detecting the route can take a minute.')).toBeInTheDocument()
    expect(screen.getByText('0s')).toBeInTheDocument()
    expect(screen.getByLabelText('From')).toBeDisabled()
  })

  it('shows an unknown via name in the validation summary', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    draft.mockResolvedValue({
      trip: {
        stops: [
          { name: 'Dublin', kind: 'major', at: [53.35, -6.26] },
          { name: 'Galway', kind: 'major', at: [53.27, -9.06] },
        ],
        legs: [
          { date: '2026-05-02', mode: 'drive', via: ['Dublin', 'Atlantis', 'Galway'], enabled: true },
          { date: '2026-05-03', mode: 'boat', via: ['Galway', 'Narnia'], enabled: false },
        ],
      },
      stats: { photo_count: 40, overnight_names: ['Dublin', 'Galway'], quick_names: [], hidden_names: [], leg_counts: { drive: 1 } },
    })
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('From'), '2026-05-01')
    await user.type(screen.getByLabelText('To'), '2026-05-04')
    await user.click(screen.getByRole('button', { name: 'Detect route' }))

    const summary = await screen.findByTestId('validation-summary')
    expect(summary).toHaveTextContent('Fix 1 problem before rendering')
    expect(summary).toHaveTextContent('Leg 1, stop 2: No stop named Atlantis')
    // The disabled leg is not validated.
    expect(summary).not.toHaveTextContent('Narnia')
    // The editor is up: map tiles, leg cards and the stop list.
    expect(screen.getByRole('region', { name: 'Legs' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Stops' })).toBeInTheDocument()
    expect(document.querySelector('img.leaflet-tile[src*="tile.openstreetmap.org"]')).not.toBeNull()

    // Removing the bad entry clears the summary.
    await user.click(screen.getByRole('button', { name: /remove leg 1 stop 2/i }))
    expect(screen.getByTestId('validation-summary')).toHaveTextContent('Ready to render.')
  })
})
