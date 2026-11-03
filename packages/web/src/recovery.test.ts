import { beforeEach, describe, expect, it } from 'vitest'
import { clearRecovery, loadRecovery, saveRecovery } from './recovery'
import type { Trip } from './types/trip'

const base: Trip = {
  stops: [{ name: 'Dublin', kind: 'major', at: [53.35, -6.26] }],
  legs: [{ date: '2026-05-02', mode: 'drive', via: ['Dublin'], enabled: true }],
}
const edited: Trip = { ...base, title: 'Edited' }

beforeEach(() => localStorage.clear())

describe('recovery cache', () => {
  it('round-trips the filename, base and edited trip', () => {
    expect(saveRecovery({ filename: 'ireland.yaml', base, current: edited })).toBe(true)
    const got = loadRecovery()
    expect(got?.filename).toBe('ireland.yaml')
    expect(got?.base).toEqual(base)
    expect(got?.current).toEqual(edited)
    expect(typeof got?.savedAt).toBe('string')
  })

  it('returns null when nothing is saved', () => {
    expect(loadRecovery()).toBeNull()
  })

  it('clears the entry', () => {
    saveRecovery({ filename: 'a.yaml', base, current: base })
    clearRecovery()
    expect(loadRecovery()).toBeNull()
  })

  it('drops unreadable JSON instead of crashing', () => {
    localStorage.setItem('tripmap:recovery', '{not json')
    expect(loadRecovery()).toBeNull()
    expect(localStorage.getItem('tripmap:recovery')).toBeNull()
  })

  it('drops an entry with a missing trip or the wrong version', () => {
    localStorage.setItem('tripmap:recovery', JSON.stringify({ v: 1, filename: 'a.yaml', base, current: { title: 'x' } }))
    expect(loadRecovery()).toBeNull()
    localStorage.setItem('tripmap:recovery', JSON.stringify({ v: 99, filename: 'a.yaml', base, current: base }))
    expect(loadRecovery()).toBeNull()
  })

  it('reports a failed write instead of throwing', () => {
    const full = {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
    } as unknown as Storage
    expect(saveRecovery({ filename: 'a.yaml', base, current: base }, full)).toBe(false)
  })
})
