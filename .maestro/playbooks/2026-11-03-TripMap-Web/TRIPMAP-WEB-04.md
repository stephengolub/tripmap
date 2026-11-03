# TripMap Web Phase 04: The map editor

Goal: after a draft, the user edits the route on an OpenStreetMap map and in a leg list with dropdowns. Every edit goes through one pure reducer, so the logic is tested without the map.

## Shared context (read first; every task starts with a fresh context)

Repo: `/Users/sgolub/code/tripmap`, branch `main`. Python project managed by uv (`pyproject.toml`, `uv.lock`). Run Python with `uv run ...`. Tests: `uv run pytest` (offline, must stay green).

What exists:
- `src/tripmap/__init__.py`: the whole CLI. `cmd_draft` reads the Photos library (through a temp copy, never the live DB) and detects a trip's route; `build_svg` draws it; `screenshot` rasterizes the SVG with headless Chrome via `find_chrome()`. Trip files are YAML; the format is in `docs/trip-format.md` and the detection rules are in `docs/how-draft-works.md`. Read those two docs before changing detection or the trip format.
- `examples/` holds real trip data. `italy.yaml`, `ireland.yaml`, `pnw.yaml` are regression references. Stephen approved committing them. Do not add new personal data to the repo.

Architecture decided for the web app (do not change without writing it into this playbook's notes):
- Layout (fixed; new Python code goes under `src/`, never at the repo root): the core package is `src/tripmap/` (the CLI lives in `src/tripmap/__init__.py`). The API is a second package, `src/tripmap_api/`, using FastAPI. Tests are in `tests/` at the repo root. The frontend is `web/` at the repo root. Scripts are in `scripts/` at the repo root.
- Frontend stack: Vite + React + TypeScript, Leaflet via react-leaflet, OpenStreetMap raster tiles.
- **Stateless.** The server keeps no session, no trip, and no per-user state. The browser owns the trip document and sends it in each request body. Disk caches under `~/.cache/tripmap` are allowed because they are caches, not state.
- The API binds to `127.0.0.1` only and allows CORS from `http://localhost:5173` only. Route coordinates are personal location data: never log coordinates, photo paths, or photo contents. Logs may say counts and status codes.
- Trip JSON uses the same field names as the trip YAML, plus an `enabled` boolean on each leg (default true). A disabled leg is written as a commented-out line in YAML.
- Draft takes tens of seconds because it calls Overpass, OSRM and BRouter. Backend endpoints that do blocking work are plain `def` functions so FastAPI runs them in its threadpool.
- The map uses `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with the attribution `© OpenStreetMap contributors`. Do not prefetch or bulk-download tiles. Set a descriptive User-Agent on any server-side HTTP call.
- Node: use the absolute path `/Users/sgolub/.asdf/installs/nodejs/22.14.0/bin/node` and the npm beside it (`/Users/sgolub/.asdf/installs/nodejs/22.14.0/bin/npm`) if `npm` is not on PATH.

Rules for every task:
- Do not modify files outside `/Users/sgolub/code/tripmap`.
- Do not run `git push`, and do not create GitHub resources. Local commits are allowed when a task says so.
- A task is done only when its verification command passes. If a verification fails, fix it and re-run. If it still fails after a real attempt, stop that task, leave the checkbox unchecked, and write what failed under a `## Blockers` heading at the end of the phase file.
- Do not read the live Photos database under `~/Pictures/Photos Library.photoslibrary`. Go through `load_photos` or the temp-copy path only.

## Editor behaviour (implement exactly)

- **Map.** OSM tiles, attribution visible. Stops are markers: a `major` stop is a red pin, a `minor` stop is a gold star, a `hidden` stop has no marker but still appears in the stop list and in legs. Markers are draggable; dropping one updates that stop's `at`. Enabled legs are drawn as straight polylines through their resolved `via` points, dashed for `boat` and `flight`. The map label says the lines are a straight-line preview; the real routes come from the render step.
- **Add stop.** A toolbar button puts the map in add mode. The next map click creates a `minor` stop named "New stop" with that position, and selects it for renaming.
- **Leg list.** One card per leg. Each card shows the date, a mode dropdown (native `<select>` with the four modes), checkboxes for `enabled` and `day_trip`, and the ordered `via` list.
- **Stop dropdown (the intelligent one).** Each `via` entry is a combobox. It filters as the user types, matching stop names case-insensitively. Options are sorted by distance from the previous `via` point, nearest first, using haversine in TypeScript. Each option shows the stop name, its kind, and its nights if it has any. Keyboard: arrow keys move the highlight, Enter selects, Escape closes. An option "Route point on map" enters a mode where the next map click inserts a `[lat, lon]` entry.
- **Suggest mode.** A "Suggest mode" button on each leg calls `suggestMode` with the first and last resolved points of that leg, and shows "Suggested: <mode>. <reason>" next to the select. It does not change the select. The user applies it.
- **Validation.** A `via` name that matches no stop shows an inline error on that entry and blocks the render step, with the message "No stop named X". Disabled legs are not validated.
- **Reducer.** All edits go through `tripReducer(state, action)` in `web/src/trip/reducer.ts`. Actions: `renameStop` (also renames every `via` reference), `moveStop`, `addStop`, `removeStop` (refused if a leg still references it, returning an error field), `setLegMode`, `setLegEnabled`, `setLegDayTrip`, `setVia` (index, value), `insertVia`, `removeVia`, `moveVia`, `addLeg`, `removeLeg`. The reducer is pure and returns a new object.

## Tasks

- [x] Create `web/src/trip/reducer.ts` with `tripReducer` and the action types above. Export `TripAction` as a discriminated union. Verification: `web/src/trip/reducer.test.ts` covers renameStop updating `via` references, removeStop refusing when referenced, moveStop changing only `at`, setLegMode, insertVia and removeVia at given indices, and that the input state is not mutated (deep-freeze the input in the test).

- [ ] Create `web/src/trip/geo.ts` with `haversineKm(a, b)`, `resolveVia(trip, via)` (returns a `LatLon` for a stop name or a point, or `null` for an unknown name), and `sortByDistance(options, from)`. Verification: `web/src/trip/geo.test.ts` checks Dublin to Galway is about 190 km, that an unknown name resolves to `null`, and that sorting puts the nearest first.

- [ ] Create `web/src/trip/validate.ts` with `validateTrip(trip)` returning a list of `{legIndex, viaIndex, message}` for unknown names, only for enabled legs. Verification: `web/src/trip/validate.test.ts` covers an unknown name, a disabled leg with an unknown name (no error), and a valid trip (empty list).

- [ ] Create `web/src/components/TripMap.tsx` using react-leaflet's `MapContainer`, `TileLayer` with the OSM URL and attribution, `Marker` with `draggable`, and `Polyline`. Props: `trip`, `onAction` (dispatches reducer actions), and `addMode` boolean. Use a `divIcon` for pins and stars. Verification: `web/src/components/TripMap.test.tsx` renders the map with a two-stop trip and checks that the tile layer URL contains `tile.openstreetmap.org` and that two marker elements render. Leaflet needs DOM APIs, so mock `ResizeObserver` in the test setup if the test fails without it.

- [ ] Create `web/src/components/StopCombobox.tsx`, the intelligent dropdown. Props: `value` (string or `LatLon`), `stops`, `previous` (the previous resolved point or null), `onChange`. Implement the filter, distance sort, keyboard handling, and the "Route point on map" option described above, with ARIA `role="combobox"` and `role="listbox"`. Verification: `web/src/components/StopCombobox.test.tsx` uses testing-library to type "gal" and expect only Galway in the list, press ArrowDown then Enter and expect `onChange` called with Galway, check the nearest-first order with two stops at different distances, and check Escape closes the list.

- [ ] Create `web/src/components/LegCard.tsx` and `web/src/components/LegList.tsx`. Each card has the mode select, the enabled and day-trip checkboxes, the ordered list of `StopCombobox`s, add and remove buttons for via entries, the Suggest mode button, and a remove-leg button. Verification: `web/src/components/LegList.test.tsx` renders a two-leg trip, changes the first leg's mode select to `train`, and checks `onAction` was called with `setLegMode`.

- [ ] Create `web/src/components/StopList.tsx` with one row per stop: an editable name, a kind select, a read-only coordinate display, and a remove button that shows the reducer's refusal message. Verification: `web/src/components/StopList.test.tsx` checks that renaming dispatches `renameStop`, and that a refused removal shows the message.

- [ ] Replace the placeholder in `web/src/App.tsx` with an editor: `TripMap` and `LegList` side by side, `StopList` below, a toolbar with the Add stop button, and a validation summary. Route all edits through `useReducer(tripReducer, trip)`. Keep the phase 03 flow. Verification: `web/src/App.test.tsx` still passes, and a new test checks that a validation error for an unknown via name appears in the summary.

- [ ] Run `cd web && npm test && npm run build`. Both must pass. Commit locally with `Add map and leg editor with OSM tiles and intelligent stop dropdowns`. Do not push.

## Notes

- Task 1 (reducer): state is `TripState = Trip & { error?: string }`, so `useReducer(tripReducer, trip)` works as written. A refused action returns the same trip with `error` set; any accepted action clears it. `tripOf(state)` strips `error` before sending to the API. Index fields are named `legIndex` / `viaIndex` (`moveVia` uses `from`/`to`).
- Extra rules the spec implied: `renameStop` refuses an empty or already-taken name (it would silently merge two stops' references); `addStop` de-duplicates names ("New stop 2"); out-of-range indices are refused with `error`. Added a `setStopKind` action for the StopList kind select (task 7), which the action list did not name.

## Manual Follow-Up (not executed by Auto Run)

- Drag a pin and a leg card around in the browser on a real trip and judge whether the dropdown ordering feels right.
- Confirm the OSM attribution is legible at all zoom levels.
