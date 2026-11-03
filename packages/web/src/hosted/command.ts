// The hosted page has no API. It asks the user to run the CLI with a one-shot listener on
// a random port, guarded by a random token, and then polls that listener for the trip.

export type RandomSource = (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>

export interface ListenerSession {
  port: number
  token: string
}

const PORT_MIN = 49152
const PORT_SPAN = 65536 - PORT_MIN // 16384, which divides 2^16, so the pick stays uniform

// Bound so the default works: an unbound crypto.getRandomValues throws "Illegal invocation".
const cryptoRandom: RandomSource = (array) => crypto.getRandomValues(array)

export function makeListenerSession(random: RandomSource = cryptoRandom): ListenerSession {
  const portBytes = random(new Uint8Array(2))
  const port = PORT_MIN + (((portBytes[0] << 8) | portBytes[1]) % PORT_SPAN)
  const tokenBytes = random(new Uint8Array(8))
  const token = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return { port, token }
}

export function draftCommand(
  from: string,
  to: string,
  session: ListenerSession,
  version: string = __TRIPMAP_VERSION__,
): string {
  return `npx --yes tripmap@${version} draft --from ${from} --to ${to} --port ${session.port} --token ${session.token}`
}
