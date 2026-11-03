import { describe, expect, it } from 'vitest'
import { validateRange } from './DateForm'

describe('validateRange', () => {
  it('flags a missing start', () => {
    const errors = validateRange('', '2026-05-04')
    expect(errors.start).toMatch(/start date/)
    expect(errors.end).toBeNull()
  })

  it('flags a missing end', () => {
    expect(validateRange('2026-05-01', '').end).toMatch(/end date/)
  })

  it('flags an end before the start', () => {
    const errors = validateRange('2026-05-04', '2026-05-01')
    expect(errors.start).toBeNull()
    expect(errors.end).toMatch(/before the start/)
  })

  it('flags a 61-day span', () => {
    expect(validateRange('2026-01-01', '2026-03-03').end).toMatch(/60 days or less/)
  })

  it('accepts a 60-day span', () => {
    expect(validateRange('2026-01-01', '2026-03-02')).toEqual({ start: null, end: null })
  })

  it('accepts a single day', () => {
    expect(validateRange('2026-05-01', '2026-05-01')).toEqual({ start: null, end: null })
  })
})
