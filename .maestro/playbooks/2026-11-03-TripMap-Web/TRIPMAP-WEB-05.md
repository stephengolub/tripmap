# TripMap Web Phase 05: Render, import and export, end-to-end tests, and docs

Goal: finish the loop. Render the edited trip to PNG through the API, composite it onto an uploaded photo entirely in the browser, import and export YAML, prove the flow end to end, and document how to run it.

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

## Behaviour

- **Render panel.** A "Render" button posts the current trip to `/api/trips/render`. Show the PNG inline and a download link. A "Show day trips" checkbox switches `with_day_trips`, and the preview size is 1600 px. The button is disabled while any validation error is present.
- **Photo preview.** An optional file input takes a background photo. It is read only in the browser with `URL.createObjectURL` and drawn onto a `<canvas>` with the rendered PNG on top. The photo never leaves the browser. A "Download preview" link exports the canvas as JPEG.
- **Import and export.** "Open YAML" reads a file with `FileReader` and posts its text to `/api/trips/import`. "Save YAML" posts the trip to `/api/trips/yaml` and downloads the result as `trip.yaml`. Both use the client functions from phase 03.

## Tasks

- [x] Implement `renderTrip`, `exportYaml`, `importYaml`, and `suggestMode` in `web/src/api/client.ts` (the stubs from phase 03). Verification: `web/src/api/client.test.ts` mocks `fetch` and checks each request URL, method, content type, and body shape. `renderTrip` must return a `Blob`.

- [ ] Create `web/src/components/RenderPanel.tsx` with the render button, the day-trip checkbox, the inline image, and the download link. Revoke the previous object URL when a new render replaces it. Verification: `web/src/components/RenderPanel.test.tsx` mocks `renderTrip` and `URL.createObjectURL`, clicks Render, and checks the image `src` is the created URL. It also checks the button is disabled when the trip has a validation error.

- [ ] Create `web/src/components/PhotoPreview.tsx` that composites the rendered PNG over an uploaded photo using a canvas. Export the pure helper `compositeSize(photoW, photoH, maxSide)` returning the output dimensions, and test it in `web/src/components/PhotoPreview.test.ts`: a landscape 4000x3000 photo at max 1600 gives 1600x1200, and a portrait 3000x4000 gives 1200x1600. Verification: `npm test` passes.

- [ ] Add the Open YAML and Save YAML buttons to the toolbar in `web/src/App.tsx`. Open YAML replaces the trip in the reducer state with the imported trip, after a `window.confirm` if the current trip has unsaved edits. Verification: `web/src/App.test.tsx` checks that importing replaces the stop list.

- [ ] Write an end-to-end test in `web/e2e/editor.spec.ts` using Playwright. Install with `npm install -D @playwright/test` and `npx playwright install chromium`. The test starts from the import path, not the live draft, so it needs no network: it posts `examples/italy.yaml` through the Open YAML input, then checks that the map has markers, that the leg list has the Italy legs, and that the Render button produces an image with a `src` starting with `blob:`. Add `web/playwright.config.ts` whose `webServer` starts the backend with `uv run --project .. tripmap-api` and the frontend with `npm run dev`. Verification: `cd web && npx playwright test` passes. The backend must have Chrome available for render; if not, record in Notes that the render assertion was skipped and why, and do not delete the assertion.

- [ ] Add a `scripts/dev.sh` at the repo root that runs the backend and frontend in the foreground with `trap` to stop both on Ctrl-C. Make it executable. Verification: `bash -n scripts/dev.sh` succeeds and the file contains `127.0.0.1`.

- [ ] Update `README.md` with a "Web app" section: how to start with `scripts/dev.sh`, the Photos Full Disk Access step (name the exact System Settings path), and a note that nothing is saved on the server. Update `docs/api.md` for any endpoint changes made in phases 03 to 05. Update `CLAUDE.md` with the architecture block from the shared context, with the stateless rule and the coordinate logging rule. Verification: `rg -c "Full Disk Access" README.md` prints at least 1, and `rg -c "stateless" CLAUDE.md` prints at least 1.

- [ ] Run the full check and record the results in Notes: `uv run pytest -q`, `cd web && npm test`, `cd web && npm run build`, `cd web && npx playwright test`. Commit locally with `Add render, import and export, end-to-end tests and web app docs`. Do not push.

## Notes

(The agent fills this in: the four check results, and any skipped assertion with its reason.)

- Task 1: `renderTrip` posts `{trip, ...opts}` to `/api/trips/render` and returns `res.blob()`; `exportYaml` posts `{trip}` to `/api/trips/yaml` and returns the text; `suggestMode` posts `{from, to, elapsed_hours?}` to `/api/legs/suggest-mode`. All JSON. The Blob test checks the `[object Blob]` tag rather than `instanceof Blob`, because under jsdom `Response.blob()` returns Node's Blob class, not jsdom's. `npm test` 76/76, `tsc -b` clean.

## Manual Follow-Up (not executed by Auto Run)

- Use the web app on this Mac with the real Photos library: draft a trip, edit it, render it, and confirm the result matches what the CLI produces for the same dates.
- Check the photo preview on a real album photo and judge the placement.
- Before any public release: the OSM tile usage policy allows light use only. A public app needs a tile provider or a self-hosted tile server, and the repository needs the privacy review noted in `CLAUDE.md` before it is made public.
- Grant Full Disk Access to the terminal app and confirm the status check passes on a fresh start.
