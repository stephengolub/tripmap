import { useEffect, useRef, useState } from 'react'
import { importYaml } from '../api/client'
import DateForm from '../components/DateForm'
import type { Trip } from '../types/trip'
import {
  draftCommand,
  makeListenerSession,
  type ListenerSession,
} from './command'
import DataPrivacy from './DataPrivacy'
import { useDismissedNotices } from './dismissed'
import Prerequisites from './Prerequisites'
import { pollListener, TimeoutError } from './poll'
import './HostedPanel.css'

type Props = {
  // Called with the trip once it arrives from the terminal or the paste box.
  onLoaded: (filename: string, trip: Trip) => void
}

type Draft = {
  from: string
  to: string
  session: ListenerSession
  command: string
}

type Status =
  | { phase: 'idle' }
  | { phase: 'waiting' }
  | { phase: 'loaded'; title: string }
  | { phase: 'failed'; message: string }

const filenameFor = (draft: Draft | null) =>
  draft ? `tripmap-${draft.from}_${draft.to}.yaml` : 'tripmap.yaml'

// The hosted page has no server. It hands the user a command to run in their own terminal,
// then polls that command's one-shot listener for the trip. Pasting the YAML is the fallback.
export default function HostedPanel({ onLoaded }: Props) {
  const [dismissed, setNotice] = useDismissedNotices()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [status, setStatus] = useState<Status>({ phase: 'idle' })
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const poll = useRef<AbortController | null>(null)

  // Stop polling when the panel goes away.
  useEffect(() => () => poll.current?.abort(), [])

  function stopPolling() {
    poll.current?.abort()
    poll.current = null
  }

  async function load(text: string, filename: string): Promise<Trip> {
    const { trip } = await importYaml(text)
    stopPolling()
    onLoaded(filename, trip)
    setStatus({ phase: 'loaded', title: trip.title || filename })
    return trip
  }

  async function handleDates(from: string, to: string) {
    stopPolling()
    const session = makeListenerSession()
    const next = {
      from,
      to,
      session,
      command: draftCommand(from, to, session),
    }
    setDraft(next)
    setCopied('idle')
    setStatus({ phase: 'waiting' })

    // Not awaited: the form is free again at once, and the poll runs in the background.
    const controller = new AbortController()
    poll.current = controller
    pollListener({ ...session, signal: controller.signal })
      .then((text) =>
        controller.signal.aborted ? undefined : load(text, filenameFor(next)),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const message =
          err instanceof TimeoutError
            ? 'Stopped waiting after 10 minutes. Run the command again, or paste the YAML below.'
            : err instanceof Error
              ? err.message
              : 'Could not read the trip from your terminal.'
        setStatus({ phase: 'failed', message })
      })
  }

  async function handleCopy() {
    if (!draft) return
    try {
      await navigator.clipboard.writeText(draft.command)
      setCopied('copied')
    } catch {
      setCopied('failed')
    }
  }

  async function handlePaste() {
    setPasteError(null)
    try {
      await load(pasted, filenameFor(draft))
      setPasted('')
    } catch (err) {
      setPasteError(
        err instanceof Error ? err.message : 'That is not a trip file.',
      )
    }
  }

  // Once a route is loaded, the working controls fold away so the trip is what the page shows.
  const hasRoute = status.phase === 'loaded'
  const loadedTitle = status.phase === 'loaded' ? status.title : ''

  return (
    <section
      className="hosted-panel"
      aria-label="Draft from your Photos library"
    >
      {!dismissed.has('prerequisites') && (
        <Prerequisites onDismiss={() => setNotice('prerequisites', true)} />
      )}
      {!dismissed.has('privacy') && (
        <DataPrivacy onDismiss={() => setNotice('privacy', true)} />
      )}
      {dismissed.size > 0 && (
        <p className="notice-restore">
          {dismissed.has('prerequisites') && (
            <button
              type="button"
              onClick={() => setNotice('prerequisites', false)}
            >
              Show prerequisites again
            </button>
          )}
          {dismissed.has('privacy') && (
            <button type="button" onClick={() => setNotice('privacy', false)}>
              Show data privacy again
            </button>
          )}
        </p>
      )}

      <details className="fold" open={!hasRoute}>
        <summary>
          <span className="fold-title">Draft a trip from Photos</span>
          {hasRoute && <span className="fold-meta">Loaded {loadedTitle}</span>}
        </summary>
        <div className="fold-body">
          <p>
            Pick the trip's dates. The page then gives you a command to run in
            Terminal on the Mac that has your Photos library.
          </p>
          <DateForm onSubmit={handleDates} submitLabel="Make command" />
        </div>
      </details>

      {draft && (
        <details className="fold" open={!hasRoute}>
          <summary>
            <span className="fold-title">Command for your terminal</span>
          </summary>
          <div className="fold-body">
            <div className="hosted-command">
              <pre data-testid="draft-command">{draft.command}</pre>
              <button type="button" onClick={() => void handleCopy()}>
                Copy command
              </button>
              {copied === 'copied' && (
                <span className="hosted-note">Copied.</span>
              )}
              {copied === 'failed' && (
                <span className="hosted-note">
                  Could not copy. Select the command and copy it.
                </span>
              )}
              <p className="hosted-note">
                Chrome may ask whether this page can access devices on your
                local network. Answer yes.
              </p>
            </div>
          </div>
        </details>
      )}

      {status.phase === 'waiting' && (
        <div className="draft-progress" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>Waiting for your terminal...</span>
        </div>
      )}
      {status.phase === 'loaded' && (
        <p className="hosted-loaded" role="status">
          Loaded <strong>{status.title}</strong>.
        </p>
      )}
      {status.phase === 'failed' && (
        <p className="draft-error" role="alert">
          {status.message}
        </p>
      )}

      <details className="fold">
        <summary>
          <span className="fold-title">Or paste the trip YAML</span>
        </summary>
        <div className="fold-body">
          <div className="hosted-paste">
            <label htmlFor="hosted-paste">Paste the trip YAML</label>
            <textarea
              id="hosted-paste"
              rows={6}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => void handlePaste()}
              disabled={!pasted.trim()}
            >
              Load pasted YAML
            </button>
            {pasteError && (
              <p className="draft-error" role="alert">
                {pasteError}
              </p>
            )}
          </div>
        </div>
      </details>
    </section>
  )
}
