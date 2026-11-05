import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftTrip, exportYaml, getPhotosStatus, importYaml } from './api/client'
import App from './App'
import { loadRecovery, saveRecovery } from './recovery'
import type { Trip } from './types/trip'

vi.mock('./api/client', () => ({
  getPhotosStatus: vi.fn(),
  draftTrip: vi.fn(),
  suggestMode: vi.fn(),
  importYaml: vi.fn(),
  exportYaml: vi.fn(),
  renderTrip: vi.fn(),
}))

const status = vi.mocked(getPhotosStatus)
const draft = vi.mocked(draftTrip)
const imp = vi.mocked(importYaml)
const exp = vi.mocked(exportYaml)

beforeEach(() => {
  localStorage.clear()
  status.mockReset()
  draft.mockReset()
  imp.mockReset()
  exp.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const italy: Trip = {
  title: 'Italy',
  stops: [
    { name: 'Bologna', kind: 'major', at: [44.49, 11.34] },
    { name: 'Rome', kind: 'major', at: [41.9, 12.5] },
    { name: 'Florence', kind: 'major', at: [43.77, 11.25] },
  ],
  legs: [
    { date: '2024-05-03', mode: 'train', via: ['Bologna', 'Rome'], enabled: true },
    { date: '2024-05-05', mode: 'train', via: ['Rome', 'Florence'], enabled: true },
  ],
}

const ireland: Trip = {
  title: 'Ireland',
  stops: [
    { name: 'Dublin', kind: 'major', at: [53.35, -6.26] },
    { name: 'Galway', kind: 'major', at: [53.27, -9.06] },
  ],
  legs: [{ date: '2026-05-02', mode: 'drive', via: ['Dublin', 'Galway'], enabled: true }],
}

function stopNames() {
  const list = screen.getByRole('region', { name: 'Stops' })
  return within(list)
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('aria-label'))
}

function yamlFile(text = 'stops: []') {
  return new File([text], 'trip.yaml', { type: 'text/yaml' })
}

describe('App file toolbar', () => {
  it('Open YAML replaces the stop list with the imported trip', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    imp.mockResolvedValueOnce({ trip: ireland }).mockResolvedValueOnce({ trip: italy })
    const user = userEvent.setup()
    render(<App />)

    await user.upload(screen.getByLabelText('Open YAML file'), yamlFile('title: Ireland'))
    // the file is read asynchronously (FileReader), so wait for the import call
    await waitFor(() => expect(imp).toHaveBeenCalledWith('title: Ireland'))
    await screen.findByRole('region', { name: 'Stops' })
    expect(stopNames()).toEqual(['Dublin', 'Galway'])

    // No edits yet, so the second open replaces without asking.
    const confirm = vi.spyOn(window, 'confirm')
    await user.upload(screen.getByLabelText('Open YAML file'), yamlFile())
    await screen.findByRole('listitem', { name: 'Florence' })
    expect(stopNames()).toEqual(['Bologna', 'Rome', 'Florence'])
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks before replacing unsaved edits, and keeps them on cancel', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    imp.mockResolvedValueOnce({ trip: ireland }).mockResolvedValue({ trip: italy })
    const user = userEvent.setup()
    render(<App />)

    await user.upload(screen.getByLabelText('Open YAML file'), yamlFile())
    await screen.findByRole('listitem', { name: 'Galway' })
    await user.click(screen.getByRole('button', { name: /remove leg 1 stop 2/i }))

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.upload(screen.getByLabelText('Open YAML file'), yamlFile())
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(imp).toHaveBeenCalledTimes(1)
    expect(stopNames()).toEqual(['Dublin', 'Galway'])

    confirm.mockReturnValue(true)
    await user.upload(screen.getByLabelText('Open YAML file'), yamlFile())
    await screen.findByRole('listitem', { name: 'Florence' })
    expect(stopNames()).toEqual(['Bologna', 'Rome', 'Florence'])
  })

  it('shows an import error and keeps the current trip', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    imp.mockResolvedValueOnce({ trip: ireland }).mockRejectedValueOnce(new Error('Bad YAML on line 3.'))
    const user = userEvent.setup()
    render(<App />)

    await user.upload(screen.getByLabelText('Open YAML file'), yamlFile())
    await screen.findByRole('listitem', { name: 'Galway' })
    await user.upload(screen.getByLabelText('Open YAML file'), yamlFile())
    expect(await screen.findByText('Bad YAML on line 3.')).toBeInTheDocument()
    expect(stopNames()).toEqual(['Dublin', 'Galway'])
  })

  it('opens YAML even when Photos is not readable', async () => {
    status.mockResolvedValue({ ok: false, library: '/lib', geotagged_assets: 0, message: 'No access.' })
    imp.mockResolvedValue({ trip: italy })
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('No access.')).toBeInTheDocument()
    await user.upload(screen.getByLabelText('Open YAML file'), yamlFile())
    await screen.findByRole('listitem', { name: 'Florence' })
  })

  it('Save YAML posts the edited trip and downloads trip.yaml', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    imp.mockResolvedValue({ trip: ireland })
    exp.mockResolvedValue('title: Ireland\n')
    const create = vi.fn(() => 'blob:yaml')
    const revoke = vi.fn()
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('trip.yaml')
      expect(this.getAttribute('href')).toBe('blob:yaml')
    })
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('button', { name: 'Save YAML' })).toBeDisabled()
    await user.upload(screen.getByLabelText('Open YAML file'), yamlFile())
    await screen.findByRole('listitem', { name: 'Galway' })
    await user.click(screen.getByRole('button', { name: 'Save YAML' }))

    expect(exp).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ireland', stops: ireland.stops }))
    expect(click).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:yaml')
  })
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

describe('recovery after a refresh', () => {
  it('restores the filename, the edits and the stop list from localStorage', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    saveRecovery({ filename: 'ireland.yaml', base: ireland, current: { ...ireland, title: 'Edited' } })
    render(<App />)

    expect(screen.getByTestId('file-name')).toHaveTextContent('ireland.yaml')
    expect(screen.getByTestId('file-name')).toHaveTextContent('(unsaved changes)')
    expect(screen.getByRole('status', { name: 'Recovered session' })).toHaveTextContent(
      'Restored ireland.yaml from your last session, with its unsaved edits.',
    )
    await screen.findByRole('region', { name: 'Stops' })
    expect(stopNames()).toEqual(['Dublin', 'Galway'])
  })

  it('puts the stop list above the Add stop and Reframe toolbar, and the toolbar above the map', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    saveRecovery({ filename: 'ireland.yaml', base: ireland, current: ireland })
    const { container } = render(<App />)

    const stops = await screen.findByRole('region', { name: 'Stops' })
    const toolbar = screen.getByRole('toolbar', { name: 'Map tools' })
    const main = container.querySelector('.editor-main') as Element
    expect(stops.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toolbar.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reframe map' })).toBeInTheDocument()
  })

  it('lists the stops above the map and leg editor', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    saveRecovery({ filename: 'ireland.yaml', base: ireland, current: ireland })
    const { container } = render(<App />)

    const stops = await screen.findByRole('region', { name: 'Stops' })
    const main = container.querySelector('.editor-main')
    expect(main).not.toBeNull()
    expect(stops.compareDocumentPosition(main as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the banner without unsaved wording when the restored trip was saved', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    saveRecovery({ filename: 'ireland.yaml', base: ireland, current: ireland })
    render(<App />)

    expect(screen.getByRole('status', { name: 'Recovered session' })).toHaveTextContent(
      'Restored ireland.yaml from your last session.',
    )
    expect(screen.getByTestId('file-name')).not.toHaveTextContent('unsaved')
  })

  it('keeps the opened file name in the local cache', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    imp.mockResolvedValueOnce({ trip: ireland })
    const user = userEvent.setup()
    render(<App />)

    await user.upload(screen.getByLabelText('Open YAML file'), yamlFile())
    await screen.findByRole('region', { name: 'Stops' })
    expect(loadRecovery()?.filename).toBe('trip.yaml')
    expect(loadRecovery()?.base).toEqual(ireland)
  })

  it('Close trip clears the cache and the editor', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    saveRecovery({ filename: 'ireland.yaml', base: ireland, current: ireland })
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Close trip' }))
    expect(loadRecovery()).toBeNull()
    expect(screen.queryByTestId('file-name')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Stops' })).toBeNull()
  })
})

describe('App build modes', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  // Re-import App (and its mocked client) with VITE_MODE set, so mode.ts re-reads it.
  async function loadApp(mode: 'local' | 'hosted') {
    vi.stubEnv('VITE_MODE', mode)
    vi.resetModules()
    const client = await import('./api/client')
    vi.mocked(client.getPhotosStatus).mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    const { default: Fresh } = await import('./App')
    return { Fresh, client }
  }

  it('local mode gates the Detect form on Photos and drafts through the client', async () => {
    const { Fresh, client } = await loadApp('local')
    vi.mocked(client.draftTrip).mockResolvedValue({
      trip: ireland,
      stats: { photo_count: 5, overnight_names: ['Dublin', 'Galway'], quick_names: [], hidden_names: [], leg_counts: { drive: 1 } },
    })
    const user = userEvent.setup()
    render(<Fresh />)

    expect(screen.getByText('Checking Photos access...')).toBeInTheDocument()
    await user.type(await screen.findByLabelText('From'), '2026-05-01')
    await user.type(screen.getByLabelText('To'), '2026-05-04')
    await user.click(screen.getByRole('button', { name: 'Detect route' }))
    expect(client.draftTrip).toHaveBeenCalledWith('2026-05-01', '2026-05-04')
    expect(client.getPhotosStatus).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Make command' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open YAML' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save YAML' })).toBeInTheDocument()
  })

  it('hosted mode shows the command panel instead of the Photos gate', async () => {
    const { Fresh, client } = await loadApp('hosted')
    render(<Fresh />)

    expect(screen.getByRole('button', { name: 'Make command' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Detect route' })).toBeNull()
    expect(screen.queryByText('Checking Photos access...')).toBeNull()
    expect(client.getPhotosStatus).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Open YAML' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save YAML' })).toBeInTheDocument()

    // A pasted trip opens in the editor, like Open YAML does.
    vi.mocked(client.importYaml).mockResolvedValue({ trip: ireland })
    const user = userEvent.setup()
    await user.click(screen.getByText('Or paste the trip YAML'))
    await user.type(screen.getByLabelText('Paste the trip YAML'), 'title: Sample')
    await user.click(screen.getByRole('button', { name: 'Load pasted YAML' }))
    await screen.findByRole('listitem', { name: 'Galway' })
    expect(screen.getByTestId('file-name')).toHaveTextContent('tripmap.yaml')
  })
})
