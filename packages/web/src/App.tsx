import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { draftTrip, exportYaml, importYaml } from './api/client'
import DateForm from './components/DateForm'
import Editor from './components/Editor'
import PhotosGate from './components/PhotosGate'
import HostedPanel from './hosted/HostedPanel'
import { MODE } from './mode'
import { clearRecovery, loadRecovery, saveRecovery } from './recovery'
import type { Stats, Trip } from './types/trip'
import './App.css'

// One open trip. `base` is the last drafted, opened or saved version; `current` is what the
// editor shows. The whole session is mirrored to localStorage (see recovery.ts) so a refresh
// keeps the filename and edits. Nothing is saved on the server.
type Session = {
  filename: string
  base: Trip
  current: Trip
  stats: Stats | null
  // Trip the editor starts from. Differs from `base` only after a recovery.
  editorStart: Trip
  // Bumped per draft, open or recovery so the editor starts over.
  loadId: number
  // Set when this session was restored after a refresh; shows the recovery banner.
  restoredAt: string | null
}

function initialSession(): Session | null {
  const saved = loadRecovery()
  if (!saved) return null
  return {
    filename: saved.filename,
    base: saved.base,
    current: saved.current,
    stats: null,
    editorStart: saved.current,
    loadId: 1,
    restoredAt: saved.savedAt,
  }
}

function App() {
  const [session, setSession] = useState<Session | null>(initialSession)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const dirty = session !== null && JSON.stringify(session.current) !== JSON.stringify(session.base)

  // Mirror every change to localStorage; an empty session clears the cache.
  useEffect(() => {
    if (session) saveRecovery({ filename: session.filename, base: session.base, current: session.current })
    else clearRecovery()
  }, [session])

  function startSession(filename: string, trip: Trip, stats: Stats | null) {
    setSession((prev) => ({
      filename,
      base: trip,
      current: trip,
      stats,
      editorStart: trip,
      loadId: (prev?.loadId ?? 0) + 1,
      restoredAt: null,
    }))
  }

  async function handleDraft(start: string, end: string) {
    const res = await draftTrip(start, end)
    startSession(`tripmap-${start}_${end}.yaml`, res.trip, res.stats)
  }

  async function handleOpen(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    // Clear it so opening the same file again still fires a change.
    input.value = ''
    if (!file) return
    if (dirty && !window.confirm('Replace the current trip? Your unsaved edits will be lost.')) return
    setFileError(null)
    try {
      const res = await importYaml(await readText(file))
      startSession(file.name, res.trip, null)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Could not open that file.')
    }
  }

  async function handleSave() {
    if (!session) return
    setFileError(null)
    try {
      const text = await exportYaml(session.current)
      download(new Blob([text], { type: 'application/yaml' }), session.filename)
      setSession((s) => s && { ...s, base: s.current })
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Could not save the trip.')
    }
  }

  function handleDiscard() {
    if (dirty && !window.confirm('Discard this trip and its unsaved edits?')) return
    setSession(null)
  }

  const onEditorChange = useCallback(
    (t: Trip) => setSession((s) => (s && JSON.stringify(s.current) !== JSON.stringify(t) ? { ...s, current: t } : s)),
    [],
  )

  return (
    <main className="app">
      <h1>tripmap</h1>
      <div className="file-toolbar" role="toolbar" aria-label="File">
        <button type="button" onClick={() => fileInput.current?.click()}>
          Open YAML
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".yaml,.yml,text/yaml,application/yaml"
          aria-label="Open YAML file"
          className="visually-hidden"
          tabIndex={-1}
          onChange={(e) => void handleOpen(e)}
        />
        <button type="button" onClick={() => void handleSave()} disabled={!session}>
          Save YAML
        </button>
        {session && (
          <span className="file-name" data-testid="file-name">
            {session.filename}
            {dirty && <span className="file-dirty"> (unsaved changes)</span>}
          </span>
        )}
        {session && (
          <button type="button" onClick={handleDiscard}>
            Close trip
          </button>
        )}
        {fileError && (
          <span className="file-error" role="alert">
            {fileError}
          </span>
        )}
      </div>
      {session?.restoredAt && (
        <RecoveryBanner
          filename={session.filename}
          dirty={dirty}
          onDismiss={() => setSession((s) => s && { ...s, restoredAt: null })}
        />
      )}
      {MODE === 'hosted' ? (
        // No server here: the trip comes from the user's terminal (or a paste).
        <HostedPanel onLoaded={(filename, trip) => startSession(filename, trip, null)} />
      ) : (
        // Only drafting reads Photos; an opened YAML trip edits and renders without it.
        <PhotosGate>
          <DateForm onSubmit={handleDraft} />
        </PhotosGate>
      )}
      {session && (
        <>
          {session.stats && <DraftSummary stats={session.stats} />}
          <Editor key={session.loadId} initial={session.editorStart} onChange={onEditorChange} />
        </>
      )}
    </main>
  )
}

function RecoveryBanner({ filename, dirty, onDismiss }: { filename: string; dirty: boolean; onDismiss: () => void }) {
  return (
    <section className="recovery-banner" role="status" aria-label="Recovered session">
      <p>
        Restored <strong>{filename}</strong> from your last session
        {dirty ? ', with its unsaved edits.' : '.'}
      </p>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </section>
  )
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsText(file)
  })
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// What draft found, above the editor.
function DraftSummary({ stats }: { stats: Stats }) {
  const stops =
    stats.overnight_names.length + stats.quick_names.length + stats.hidden_names.length
  const legs = Object.values(stats.leg_counts).reduce((sum, n) => sum + (n ?? 0), 0)
  return (
    <section data-testid="draft-summary" className="draft-summary">
      <p>
        Drafted {stops} {stops === 1 ? 'stop' : 'stops'} and {legs} {legs === 1 ? 'leg' : 'legs'}{' '}
        from {stats.photo_count} photos.
      </p>
    </section>
  )
}

export default App
