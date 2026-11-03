import { useState } from 'react'
import { draftTrip } from './api/client'
import DateForm from './components/DateForm'
import Editor from './components/Editor'
import PhotosGate from './components/PhotosGate'
import type { Stats, Trip } from './types/trip'
import './App.css'

// The trip lives here, in memory only. Nothing is saved to the server or to storage.
function App() {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  // Bumped per draft so the editor starts over from the new trip.
  const [draftId, setDraftId] = useState(0)

  async function handleDraft(start: string, end: string) {
    const res = await draftTrip(start, end)
    setTrip(res.trip)
    setStats(res.stats)
    setDraftId((n) => n + 1)
  }

  return (
    <main className="app">
      <h1>tripmap</h1>
      <PhotosGate>
        <DateForm onSubmit={handleDraft} />
        {trip && stats && (
          <>
            <DraftSummary stats={stats} />
            <Editor key={draftId} initial={trip} />
          </>
        )}
      </PhotosGate>
    </main>
  )
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
