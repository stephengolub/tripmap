import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HostedPanel from './HostedPanel'
import { pollListener, TimeoutError } from './poll'

vi.mock('./poll', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./poll')>()),
  pollListener: vi.fn(),
}))

const poll = vi.mocked(pollListener)

// Invented coordinates; not from any real trip.
const YAML =
  'title: Synthetic\nstops:\n  - {name: A, at: [10.0, 20.0], kind: major}\n  - {name: B, at: [10.5, 20.5], kind: major}\nlegs:\n  - {date: 2030-01-02, mode: drive, via: [A, B]}\n'

const COMMAND =
  /^npx --yes tripmap@\d+\.\d+\.\d+\S* draft --from 2030-01-01 --to 2030-01-05 --port (\d+) --token ([0-9a-f]{16})$/

async function submitDates() {
  await userEvent.type(screen.getByLabelText('From'), '2030-01-01')
  await userEvent.type(screen.getByLabelText('To'), '2030-01-05')
  await userEvent.click(screen.getByRole('button', { name: 'Make command' }))
}

beforeEach(() => {
  poll.mockReset()
  localStorage.clear()
})

describe('HostedPanel', () => {
  it('shows no command and does not poll before the dates are submitted', () => {
    render(<HostedPanel onLoaded={vi.fn()} />)
    expect(screen.queryByTestId('draft-command')).not.toBeInTheDocument()
    expect(poll).not.toHaveBeenCalled()
  })

  it('shows the command and starts polling its listener after the form submits', async () => {
    poll.mockReturnValue(new Promise(() => {}))
    render(<HostedPanel onLoaded={vi.fn()} />)
    await submitDates()

    const command =
      (await screen.findByTestId('draft-command')).textContent ?? ''
    const match = COMMAND.exec(command)
    expect(match).not.toBeNull()
    expect(screen.getByText('Waiting for your terminal...')).toBeInTheDocument()
    expect(screen.getByText(/local network.*Answer yes\./)).toBeInTheDocument()

    expect(poll).toHaveBeenCalledTimes(1)
    const opts = poll.mock.calls[0][0]
    expect(opts.port).toBe(Number(match![1]))
    expect(opts.token).toBe(match![2])
    expect(opts.port).toBeGreaterThanOrEqual(49152)
    expect(opts.port).toBeLessThanOrEqual(65535)
  })

  it('copies the command to the clipboard', async () => {
    poll.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    render(<HostedPanel onLoaded={vi.fn()} />)
    await user.type(screen.getByLabelText('From'), '2030-01-01')
    await user.type(screen.getByLabelText('To'), '2030-01-05')
    await user.click(screen.getByRole('button', { name: 'Make command' }))
    await user.click(
      await screen.findByRole('button', { name: 'Copy command' }),
    )
    expect(writeText).toHaveBeenCalledWith(
      screen.getByTestId('draft-command').textContent,
    )
    expect(await screen.findByText('Copied.')).toBeInTheDocument()
  })

  it('loads the trip the listener returns', async () => {
    poll.mockResolvedValue(YAML)
    const onLoaded = vi.fn()
    render(<HostedPanel onLoaded={onLoaded} />)
    await submitDates()

    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1))
    const [filename, trip] = onLoaded.mock.calls[0]
    expect(filename).toBe('tripmap-2030-01-01_2030-01-05.yaml')
    expect(trip.stops.map((s: { name: string }) => s.name)).toEqual(['A', 'B'])
    expect(await screen.findByText('Synthetic')).toBeInTheDocument()
    expect(
      screen.queryByText('Waiting for your terminal...'),
    ).not.toBeInTheDocument()
  })

  it('says so when the poll times out', async () => {
    poll.mockRejectedValue(new TimeoutError())
    render(<HostedPanel onLoaded={vi.fn()} />)
    await submitDates()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Stopped waiting after 10 minutes/,
    )
  })

  it('loads a pasted synthetic YAML', async () => {
    const onLoaded = vi.fn()
    render(<HostedPanel onLoaded={onLoaded} />)
    await userEvent.click(screen.getByText('Or paste the trip YAML'))
    const box = screen.getByLabelText('Paste the trip YAML')
    await userEvent.click(box)
    await userEvent.paste(YAML)
    await userEvent.click(
      screen.getByRole('button', { name: 'Load pasted YAML' }),
    )

    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1))
    const [filename, trip] = onLoaded.mock.calls[0]
    expect(filename).toBe('tripmap.yaml')
    expect(trip.title).toBe('Synthetic')
    expect(trip.legs[0]).toMatchObject({
      mode: 'drive',
      via: ['A', 'B'],
      enabled: true,
    })
    expect(box).toHaveValue('')
    expect(poll).not.toHaveBeenCalled()
  })

  it('shows the error for a pasted file that is not a trip', async () => {
    const onLoaded = vi.fn()
    render(<HostedPanel onLoaded={onLoaded} />)
    await userEvent.click(screen.getByText('Or paste the trip YAML'))
    await userEvent.click(screen.getByLabelText('Paste the trip YAML'))
    await userEvent.paste('stops: [')
    await userEvent.click(
      screen.getByRole('button', { name: 'Load pasted YAML' }),
    )
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onLoaded).not.toHaveBeenCalled()
  })

  it('shows the prerequisites and the data privacy notice at the top, before any controls', () => {
    render(<HostedPanel onLoaded={vi.fn()} />)
    const prereqs = screen.getByRole('heading', { name: 'Before you start' })
    const privacy = screen.getByRole('heading', { name: 'Data privacy' })
    const dates = screen.getByLabelText('From')
    // Document order: prerequisites, then privacy, then the date controls.
    expect(
      prereqs.compareDocumentPosition(privacy) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      privacy.compareDocumentPosition(dates) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      screen.getByText(/Node\.js 22\.5 or newer, with/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Your photos never leave your Mac/),
    ).toBeInTheDocument()
  })

  it('keeps the controls open until a route loads, then folds them and shows the trip name', async () => {
    poll.mockResolvedValue(YAML)
    const { container } = render(<HostedPanel onLoaded={vi.fn()} />)
    const folds = () =>
      Array.from(container.querySelectorAll<HTMLDetailsElement>('details.fold'))
    // The date fold starts open; the paste fold always starts closed.
    expect(folds()[0].open).toBe(true)

    await submitDates()
    await waitFor(() =>
      expect(screen.getByText('Loaded Synthetic')).toBeInTheDocument(),
    )
    // The date form and the command fold away; the paste box stays closed until opened.
    const [dateFold, commandFold] = folds()
    expect(dateFold.open).toBe(false)
    expect(commandFold.open).toBe(false)
    expect(folds()[folds().length - 1].open).toBe(false)
  })

  it('dismisses the prerequisites and remembers it across a reload', async () => {
    const first = render(<HostedPanel onLoaded={vi.fn()} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0])
    expect(
      screen.queryByRole('heading', { name: 'Before you start' }),
    ).toBeNull()
    expect(
      screen.getByRole('heading', { name: 'Data privacy' }),
    ).toBeInTheDocument()
    expect(
      JSON.parse(localStorage.getItem('tripmap:dismissed-notices') ?? '[]'),
    ).toEqual(['prerequisites'])
    first.unmount()

    render(<HostedPanel onLoaded={vi.fn()} />)
    expect(
      screen.queryByRole('heading', { name: 'Before you start' }),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Show prerequisites again' }),
    ).toBeInTheDocument()
  })

  it('brings a dismissed notice back, and clears it from storage', async () => {
    localStorage.setItem(
      'tripmap:dismissed-notices',
      JSON.stringify(['privacy']),
    )
    render(<HostedPanel onLoaded={vi.fn()} />)
    expect(screen.queryByRole('heading', { name: 'Data privacy' })).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'Show data privacy again' }),
    )
    expect(
      screen.getByRole('heading', { name: 'Data privacy' }),
    ).toBeInTheDocument()
    expect(localStorage.getItem('tripmap:dismissed-notices')).toBe('[]')
    expect(
      screen.queryByRole('button', { name: 'Show data privacy again' }),
    ).toBeNull()
  })

  it('dismissing a notice does not touch the trip recovery cache', async () => {
    localStorage.setItem('tripmap:recovery', '{"v":1}')
    render(<HostedPanel onLoaded={vi.fn()} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[1])
    expect(localStorage.getItem('tripmap:recovery')).toBe('{"v":1}')
  })
})
