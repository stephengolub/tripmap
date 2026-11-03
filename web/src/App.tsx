import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import { draftTrip, exportYaml, importYaml } from './api/client'
import DateForm from './components/DateForm'
import Editor from './components/Editor'
import PhotosGate from './components/PhotosGate'
import type { Stats, Trip } from './types/trip'
import './App.css'

// The trip lives here, in memory only. Nothing is saved to the server or to storage.
function App() {
  // The trip as drafted or opened; the editor starts from it.
  const [trip, setTrip] = useState<Trip | null>(null)
  // The trip as edited, reported by the editor after every change.
  const [current, setCurrent] = useState<Trip | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  // Bumped per draft or import so the editor starts over from the new trip.
  const [loadId, setLoadId] = useState(0)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const dirty = trip !== null && current !== null && JSON.stringify(current) !== JSON.stringify(trip)

  function load(next: Trip, nextStats: Stats | null) {
    setTrip(next)
    setCurrent(next)
    setStats(nextStats)
    setLoadId((n) => n + 1)
  }

  async function handleDraft(start: string, end: string) {
    const res = await draftTrip(start, end)
    load(res.trip, res.stats)
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
      load(res.trip, null)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Could not open that file.')
    }
  }

  async function handleSave() {
    if (!current) return
    setFileError(null)
    try {
      const text = await exportYaml(current)
      download(new Blob([text], { type: 'application/yaml' }), 'trip.yaml')
      setTrip(current)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Could not save the trip.')
    }
  }

  const onEditorChange = useCallback((t: Trip) => setCurrent(t), [])

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
        <button type="button" onClick={() => void handleSave()} disabled={!current}>
          Save YAML
        </button>
        {fileError && (
          <span className="file-error" role="alert">
            {fileError}
          </span>
        )}
      </div>
      {/* Only drafting reads Photos; an opened YAML trip edits and renders without it. */}
      <PhotosGate>
        <DateForm onSubmit={handleDraft} />
      </PhotosGate>
      {trip && (
        <>
          {stats && <DraftSummary stats={stats} />}
          <Editor key={loadId} initial={trip} onChange={onEditorChange} />
        </>
      )}
    </main>
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
