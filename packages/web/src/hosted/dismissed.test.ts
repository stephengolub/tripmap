import { describe, expect, it } from 'vitest'
import { loadDismissed, saveDismissed } from './dismissed'

function memory(initial: string | null = null): Storage {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v
    },
    removeItem: () => {
      value = null
    },
    key: () => null,
    clear: () => {
      value = null
    },
    get length() {
      return value === null ? 0 : 1
    },
  } as Storage
}

describe('dismissed notices', () => {
  it('starts with nothing dismissed', () => {
    expect(loadDismissed(memory()).size).toBe(0)
  })

  it('round-trips the dismissed set', () => {
    const store = memory()
    saveDismissed(new Set(['privacy']), store)
    expect([...loadDismissed(store)]).toEqual(['privacy'])
  })

  it('ignores unreadable and unknown entries', () => {
    expect(loadDismissed(memory('{not json')).size).toBe(0)
    expect(loadDismissed(memory('{"privacy":true}')).size).toBe(0)
    expect([...loadDismissed(memory('["privacy","bogus"]'))]).toEqual([
      'privacy',
    ])
  })

  it('does not throw when storage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
    } as unknown as Storage
    expect(loadDismissed(broken).size).toBe(0)
    expect(() =>
      saveDismissed(new Set(['prerequisites']), broken),
    ).not.toThrow()
  })
})
