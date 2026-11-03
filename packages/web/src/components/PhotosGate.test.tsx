import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPhotosStatus } from '../api/client'
import PhotosGate from './PhotosGate'

vi.mock('../api/client', () => ({ getPhotosStatus: vi.fn() }))

const status = vi.mocked(getPhotosStatus)

beforeEach(() => {
  status.mockReset()
})

describe('PhotosGate', () => {
  it('shows the checking text first', () => {
    status.mockReturnValue(new Promise(() => {}))
    render(<PhotosGate>inside</PhotosGate>)
    expect(screen.getByText('Checking Photos access...')).toBeInTheDocument()
    expect(screen.queryByText('inside')).not.toBeInTheDocument()
  })

  it('renders the children when the status is ok', async () => {
    status.mockResolvedValue({ ok: true, library: '/lib', geotagged_assets: 10 })
    render(<PhotosGate>inside</PhotosGate>)
    expect(await screen.findByText('inside')).toBeInTheDocument()
    expect(status).toHaveBeenCalledTimes(1)
  })

  it('shows the message and a working Check again button when not ok', async () => {
    status.mockResolvedValueOnce({
      ok: false,
      library: '/lib',
      reason: 'permission_denied',
      message: 'Grant Full Disk Access.',
    })
    status.mockResolvedValueOnce({ ok: true, library: '/lib', geotagged_assets: 10 })
    render(<PhotosGate>inside</PhotosGate>)

    expect(await screen.findByText('Grant Full Disk Access.')).toBeInTheDocument()
    expect(screen.queryByText('inside')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(status).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('inside')).toBeInTheDocument()
  })

  it('shows the error when the server cannot be reached', async () => {
    status.mockRejectedValue(new Error('Could not reach the tripmap server.'))
    render(<PhotosGate>inside</PhotosGate>)
    expect(await screen.findByText('Could not reach the tripmap server.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
  })
})
