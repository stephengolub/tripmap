# TripMap Web Phase 03: React shell, Photos check at startup, and date entry

Goal: the frontend starts, checks Photos access, and only then shows the date form. Submitting dates calls the draft endpoint and holds the returned trip in browser state. Nothing is saved server-side.

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

## Frontend contract

- Dev server on `http://localhost:5173`. Vite proxies `/api` to `http://127.0.0.1:8000`, so the browser never calls the backend port directly.
- Startup: on mount, call `GET /api/photos/status` once. While waiting, show "Checking Photos access...". If `ok` is false, show the `message` and a "Check again" button that re-runs the same check. Do not poll on a timer. Do not render the date form until the check passes.
- Date form: two date inputs, From and To. Validation: both required, To not before From, span at most 60 days. Show messages next to the fields. Submit is disabled while invalid.
- While a draft runs: show a spinner, an elapsed-seconds counter, and the text "Detecting the route can take a minute." Disable the form. Show a non-technical error message on failure, using the `detail` from the response when present.
- Hold the trip document in React state at the app root. Phase 04 consumes it. Do not put it in localStorage or any server call.

## Tasks

- [x] Scaffold `web/` with Vite's React and TypeScript template: `npm create vite@latest web -- --template react-ts` run from `/Users/sgolub/code/tripmap`, using the npm path in the shared context. Then `cd web && npm install`. Verification: `cd web && npm run build` succeeds.

- [ ] Add `web/vite.config.ts` proxy: `/api` to `http://127.0.0.1:8000`, and `server.port = 5173` with `strictPort: true`. Verification: the config file contains both `127.0.0.1:8000` and `5173` (check with `rg`).

- [ ] Install runtime dependencies `leaflet`, `react-leaflet`, `@types/leaflet`, and dev dependencies `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`. Configure Vitest in `web/vite.config.ts` with `environment: "jsdom"` and a setup file `web/src/test/setup.ts` that imports jest-dom. Add scripts `test` (`vitest run`) and keep `build` as it is. Verification: `cd web && npm test` runs (it may report no tests yet, exit 0 with `--passWithNoTests`).

- [ ] Create `web/src/api/client.ts` with typed functions `getPhotosStatus()`, `draftTrip(start, end, title?)`, `renderTrip(trip, opts)`, `exportYaml(trip)`, `importYaml(text)`, `suggestMode(from, to, elapsedHours?)`. Each throws an `ApiError` with `status` and `message` on a non-2xx response. Only `getPhotosStatus`, `draftTrip`, and `importYaml` need to be implemented in this phase; the rest can be stubs that throw "not yet implemented" so later phases fill them in. Verification: `web/src/api/client.test.ts` mocks `fetch` and checks `getPhotosStatus` parses the ok and not-ok shapes, and that `draftTrip` posts the correct JSON body.

- [ ] Create `web/src/types/trip.ts` with TypeScript types `Trip`, `Stop`, `Leg`, `Stats`, `Mode` (`"drive" | "train" | "boat" | "flight"`), `StopKind` (`"major" | "minor" | "hidden"`), and `LatLon = [number, number]`. A `Leg.via` item is `string | LatLon`. Match the JSON shape in `docs/api.md` and `docs/trip-format.md`. Verification: `npm run build` succeeds.

- [ ] Create `web/src/components/PhotosGate.tsx`. It takes `children` and renders them only when the status is ok. It shows the checking, failure, and retry states above. Verification: `web/src/components/PhotosGate.test.tsx` mocks the client and checks three cases: checking text first, children rendered when ok, and the message plus a working "Check again" button when not ok. The retry must call the status function a second time.

- [ ] Create `web/src/components/DateForm.tsx` with the validation and busy states described above. Export a pure `validateRange(start, end)` function returning `string | null` per field, and test it in `web/src/components/DateForm.test.ts`: missing start, end before start, a 61-day span, and a valid 60-day span.

- [ ] Wire `web/src/App.tsx` so that `PhotosGate` wraps a `DateForm`. On a successful draft, store the returned `trip` in an `App` state variable and render a placeholder `<section data-testid="editor-placeholder">` showing the stop and leg counts from `stats`. Phase 04 replaces that placeholder. Verification: `web/src/App.test.tsx` mocks the client and checks the full flow: status ok, then the form, then a draft call, then the placeholder shows the counts.

- [ ] Remove the Vite template's demo content (`App.css` contents, the logo assets) so the app shows only the gate and the form. Verification: `rg -l "vite.svg|react.svg" web/src` prints nothing.

- [ ] Run `cd web && npm test && npm run build`. Both must pass. Commit locally with `Add React shell with Photos check and date entry`. Do not push.

## Notes

(The agent fills this in.)

## Manual Follow-Up (not executed by Auto Run)

- Open `http://localhost:5173` with the backend running and check the layout of the gate and the form on a laptop-width window.
