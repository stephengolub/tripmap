import { describe, expect, it } from 'vitest'
import { draftCommand, makeListenerSession, type RandomSource } from './command'

// Fills every request with the same byte, so the outputs are predictable.
const fixed =
  (byte: number): RandomSource =>
  (array) =>
    array.fill(byte)

describe('makeListenerSession', () => {
  it('derives the port and token from the random source', () => {
    expect(makeListenerSession(fixed(0))).toEqual({ port: 49152, token: '0000000000000000' })
    expect(makeListenerSession(fixed(0xff))).toEqual({ port: 65535, token: 'ffffffffffffffff' })
    expect(makeListenerSession(fixed(0xab))).toEqual({
      port: 49152 + (0xabab % 16384),
      token: 'abababababababab',
    })
  })

  it('stays in the dynamic port range with a 16-hex token on real randomness', () => {
    for (let i = 0; i < 200; i++) {
      const { port, token } = makeListenerSession()
      expect(Number.isInteger(port)).toBe(true)
      expect(port).toBeGreaterThanOrEqual(49152)
      expect(port).toBeLessThanOrEqual(65535)
      expect(token).toMatch(/^[0-9a-f]{16}$/)
    }
  })
})

describe('draftCommand', () => {
  it('builds the exact npx command', () => {
    const session = { port: 50123, token: '0123456789abcdef' }
    expect(draftCommand('2030-01-02', '2030-01-09', session, '1.2.3')).toBe(
      'npx --yes tripmap@1.2.3 draft --from 2030-01-02 --to 2030-01-09 --port 50123 --token 0123456789abcdef',
    )
  })

  it('defaults to the CLI version baked in at build time', () => {
    const cmd = draftCommand('2030-01-02', '2030-01-09', { port: 50000, token: 'ffffffffffffffff' })
    expect(__TRIPMAP_VERSION__).toMatch(/^\d+\.\d+\.\d+/)
    expect(cmd).toMatch(
      /^npx --yes tripmap@\d+\.\d+\.\d+\S* draft --from 2030-01-02 --to 2030-01-09 --port 50000 --token f{16}$/,
    )
    expect(cmd).toContain(`tripmap@${__TRIPMAP_VERSION__} `)
  })
})
