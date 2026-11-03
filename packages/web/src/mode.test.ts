import { afterEach, describe, expect, it, vi } from 'vitest'

describe('mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('defaults to local with a same-origin API', async () => {
    vi.stubEnv('VITE_MODE', undefined)
    vi.resetModules()
    const { MODE, API_BASE } = await import('./mode')
    expect(MODE).toBe('local')
    expect(API_BASE).toBe('')
  })

  it('is hosted when VITE_MODE=hosted', async () => {
    vi.stubEnv('VITE_MODE', 'hosted')
    vi.resetModules()
    const { MODE } = await import('./mode')
    expect(MODE).toBe('hosted')
  })
})
