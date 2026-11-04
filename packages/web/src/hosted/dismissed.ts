// Which hosted-page notices the user has dismissed. Stored in localStorage under its own key,
// separate from the trip recovery cache: dismissing a notice never touches a trip.
import { useCallback, useState } from 'react'

export type NoticeId = 'prerequisites' | 'privacy'

const KEY = 'tripmap:dismissed-notices'
const NOTICES: NoticeId[] = ['prerequisites', 'privacy']

// Unreadable or unknown entries are ignored; storage that throws (private mode, disabled) means
// nothing is remembered, and the notices simply show again.
export function loadDismissed(storage: Storage = localStorage): Set<NoticeId> {
  try {
    const raw = storage.getItem(KEY)
    if (raw === null) return new Set()
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return new Set()
    return new Set(
      data.filter((id): id is NoticeId => NOTICES.includes(id as NoticeId)),
    )
  } catch {
    return new Set()
  }
}

export function saveDismissed(
  dismissed: Set<NoticeId>,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(KEY, JSON.stringify([...dismissed]))
  } catch {
    // Not remembered; the notice will show again next visit.
  }
}

// The dismissed set, read once from storage and written through on every change.
export function useDismissedNotices(): [
  Set<NoticeId>,
  (id: NoticeId, dismissed: boolean) => void,
] {
  const [dismissed, setDismissed] = useState(loadDismissed)
  const set = useCallback((id: NoticeId, value: boolean) => {
    setDismissed((prev) => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      saveDismissed(next)
      return next
    })
  }, [])
  return [dismissed, set]
}
