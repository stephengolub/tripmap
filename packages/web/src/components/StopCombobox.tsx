import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { haversineKm, sortByDistance } from '../trip/geo'
import type { ViaEntry } from '../trip/reducer'
import type { LatLon, Stop } from '../types/trip'
import './StopCombobox.css'

export const ROUTE_POINT_LABEL = 'Route point on map'

type Props = {
  value: ViaEntry
  stops: readonly Stop[]
  // The previous via entry's resolved point; options sort nearest-first from it.
  previous: LatLon | null
  onChange: (value: ViaEntry) => void
  // Chosen "Route point on map": the caller puts the map in point mode and
  // inserts the next click as a [lat, lon] entry.
  onPickOnMap?: () => void
  // Inline validation message for this entry, e.g. "No stop named X".
  error?: string
  label?: string
}

type Option = { kind: 'stop'; stop: Stop } | { kind: 'point' }

export function formatVia(value: ViaEntry): string {
  return typeof value === 'string' ? value : `${value[0].toFixed(4)}, ${value[1].toFixed(4)}`
}

function nightsText(nights: number | undefined): string | null {
  if (!nights) return null
  return nights === 1 ? '1 night' : `${nights} nights`
}

// The via dropdown: filters stops by name as you type and lists them
// nearest-first from the previous via point.
export default function StopCombobox({ value, stops, previous, onChange, onPickOnMap, error, label }: Props) {
  const baseId = useId()
  const listId = `${baseId}-list`
  const errorId = `${baseId}-error`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(-1)

  const options: Option[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = stops.filter((s) => s.name.toLowerCase().includes(q))
    const sorted: Option[] = sortByDistance(matches, previous).map((stop) => ({ kind: 'stop', stop }))
    if (onPickOnMap) sorted.push({ kind: 'point' })
    return sorted
  }, [stops, previous, query, onPickOnMap])

  function openList() {
    setOpen(true)
    setQuery('')
    setHighlight(-1)
  }

  function close() {
    setOpen(false)
    setQuery('')
    setHighlight(-1)
  }

  function choose(option: Option) {
    close()
    if (option.kind === 'point') onPickOnMap?.()
    else onChange(option.stop.name)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) openList()
      setHighlight((h) => Math.min(h + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      // No highlight: take the first stop that matches what was typed.
      const option = options[highlight] ?? (query.trim() ? options.find((o) => o.kind === 'stop') : undefined)
      if (option) choose(option)
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        close()
      }
    }
  }

  const activeId = open && highlight >= 0 ? `${baseId}-opt-${highlight}` : undefined

  return (
    <div className={`stop-combobox${error ? ' stop-combobox-invalid' : ''}`}>
      <input
        type="text"
        role="combobox"
        aria-label={label ?? 'Stop'}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={open ? query : formatVia(value)}
        placeholder={formatVia(value)}
        onFocus={openList}
        onClick={() => !open && openList()}
        onBlur={close}
        onChange={(e) => {
          setOpen(true)
          setQuery(e.target.value)
          setHighlight(-1)
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listId} role="listbox" className="stop-combobox-list">
          {options.map((option, i) => {
            const id = `${baseId}-opt-${i}`
            // mousedown, not click: it fires before the input's blur closes the list.
            const pick = (e: { preventDefault(): void }) => {
              e.preventDefault()
              choose(option)
            }
            if (option.kind === 'point') {
              return (
                <li
                  key="point"
                  id={id}
                  role="option"
                  aria-selected={i === highlight}
                  className="stop-combobox-option stop-combobox-point"
                  onMouseDown={pick}
                >
                  {ROUTE_POINT_LABEL}
                </li>
              )
            }
            const { stop } = option
            const nights = nightsText(stop.nights)
            return (
              <li
                key={stop.name}
                id={id}
                role="option"
                aria-selected={i === highlight}
                className="stop-combobox-option"
                onMouseDown={pick}
              >
                <span className="stop-combobox-name">{stop.name}</span>
                <span className="stop-combobox-meta">
                  {stop.kind}
                  {nights ? ` · ${nights}` : ''}
                  {previous ? ` · ${Math.round(haversineKm(previous, stop.at))} km` : ''}
                </span>
              </li>
            )
          })}
          {options.every((o) => o.kind === 'point') && (
            <li className="stop-combobox-empty" aria-disabled="true">
              No matching stops
            </li>
          )}
        </ul>
      )}
      {error && (
        <p id={errorId} className="stop-combobox-error">
          {error}
        </p>
      )}
    </div>
  )
}
