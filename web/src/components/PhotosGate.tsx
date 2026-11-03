import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { getPhotosStatus } from '../api/client'

type GateState = { phase: 'checking' } | { phase: 'ok' } | { phase: 'failed'; message: string }

// Renders its children only once the server confirms it can read the Photos library.
// Checks once on mount and again on "Check again"; never polls.
export default function PhotosGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ phase: 'checking' })

  const check = useCallback(async () => {
    setState({ phase: 'checking' })
    try {
      const status = await getPhotosStatus()
      if (status.ok) {
        setState({ phase: 'ok' })
      } else {
        setState({
          phase: 'failed',
          message: status.message || 'The server could not read the Photos library.',
        })
      }
    } catch (err) {
      setState({
        phase: 'failed',
        message: err instanceof Error ? err.message : 'Could not check Photos access.',
      })
    }
  }, [])

  // StrictMode runs mount effects twice in dev; the ref keeps it to one request.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void check()
  }, [check])

  if (state.phase === 'ok') return <>{children}</>

  if (state.phase === 'checking') {
    return (
      <p className="gate-status" role="status">
        Checking Photos access...
      </p>
    )
  }

  return (
    <div className="gate-failed" role="alert">
      <p>{state.message}</p>
      <button type="button" onClick={() => void check()}>
        Check again
      </button>
    </div>
  )
}
