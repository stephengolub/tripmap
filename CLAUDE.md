# tripmap

Python package (`src/tripmap/`, the CLI, one module: `src/tripmap/__init__.py`) that turns a trip in Stephen's macOS Photos library
into a transparent PNG route map to lay over an album photo. Usage is in `README.md`; the
trip-file reference is `docs/trip-format.md`, and how draft decides is `docs/how-draft-works.md`.

## Packaging and tests (uv)

- `pyproject.toml` is the source of truth for dependencies (pyyaml, shapely) and the dev group
  (pytest). `uv.lock` is committed. Do not reintroduce `# /// script` inline metadata.
- Installed with `uv tool install --editable ~/code/tripmap`, which puts `tripmap` on
  `~/.local/bin`. It is an editable install, so source edits apply without reinstalling.
  Changing the dependencies needs `uv lock` and `uv sync`, then `uv tool upgrade tripmap`.
- Chrome is the SVG rasterizer, not a runtime dependency: `find_chrome()` checks
  `$TRIPMAP_CHROME`, then the macOS app, then PATH. Keep it that way; don't hardcode a path.
- `uv run pytest` runs `tests/` offline. The network-facing tests stub `urllib` and redirect
  `tripmap.CACHE` to a temp directory via the `cache` fixture in `tests/conftest.py`. Add
  new HTTP-touching code under the same stubs.
- `web/` is the Vite + React + TypeScript front end (Leaflet map). Node is the asdf 22.14.0
  install. `cd web && npm test` (Vitest, offline, mocks the API client) and `npm run build`.
  It reaches `tripmap-api` only through the dev server's `/api` proxy; the trip lives in
  browser state, never on the server.
- `cd web && npm run test:e2e` (Playwright) starts both servers from `web/playwright.config.ts`
  and opens `examples/italy.yaml`, so it needs no network or Photos access, but render needs
  Chrome. `scripts/dev.sh` runs the web app locally (needs `uv sync --all-extras` once).
- Not unit-tested: the nested detection logic in `cmd_draft`, the full SVG render, and the
  Photos reader. `examples/` is the regression check for those.

- `tripmap trips [--since DATE]`: list trips found in Photos.
- `tripmap draft --from DATE --to DATE -o trip.yaml`: detect the route, write an editable YAML.
- `tripmap render trip.yaml --photo bg.jpg`: draw the PNG(s) plus a preview composited on
  the photo. Headless Chrome rasterizes the SVG.

## Web app architecture (don't change without recording why)

- Layout: new Python code goes under `src/`, never at the repo root. The core package is
  `src/tripmap/`; the API is a second package, `src/tripmap_api/` (FastAPI, the `web` extra).
  Tests are in `tests/`, the front end in `web/`, scripts in `scripts/`. Endpoints are
  documented in `docs/api.md`.
- Front end: Vite + React + TypeScript, Leaflet via react-leaflet, OpenStreetMap raster
  tiles from `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with the attribution
  `© OpenStreetMap contributors`. Never prefetch or bulk-download tiles.
- **The server is stateless.** It keeps no session, no trip, and no per-user state. The
  browser owns the trip document and sends it in each request body. Disk caches under
  `~/.cache/tripmap` are allowed because they are caches, not state. The background photo
  for the preview never leaves the browser.
- The API binds to `127.0.0.1` only and allows CORS from `http://localhost:5173` only.
- **Never log coordinates, photo paths, or photo contents.** Route coordinates are personal
  location data. Logs may say counts and status codes.
- Trip JSON uses the trip YAML's field names plus an `enabled` boolean per leg (default
  true). A disabled leg is written as a commented-out YAML line.
- Endpoints doing blocking work (draft calls Overpass, OSRM, BRouter for tens of seconds)
  are plain `def`, so FastAPI runs them in its threadpool.
- Any server-side HTTP call sets a descriptive User-Agent.
- Node is the absolute asdf path `/Users/sgolub/.asdf/installs/nodejs/22.14.0/bin/` when
  `npm` is not on PATH.

## Key decisions (the reasons matter)

- **Photos is read from a TEMP COPY** of `Photos.sqlite` (plus `-wal`/`-shm`). Never open
  the live library DB.
- **Place names** come from Apple's per-asset reverse geocode,
  `ZADDITIONALASSETATTRIBUTES.ZREVERSELOCATIONDATA` (an NSKeyedArchiver plist). Place
  types: 4 = town, 6 = neighbourhood, 7 = water body, 8 = POI, 11 = island, 17 = street.
  **Type 17 is never read**: it can name the lodging.
- **Overnight base names vote on towns across distinct ~100 m spots, not across photos.**
  Counting photos let lodging outside town outvote the town itself (Dingle came out as
  "Tralee"). Don't regress this.
- **Network calls**, all cached in `~/.cache/tripmap`:
  - Nominatim: town NAMES only, to find town centres.
  - Overpass: one batched landmark query, coordinates rounded to ~100 m. Best-effort; its
    mirrors 502 often, so a failure must never block a draft.
  - OSRM (router.project-osrm.org): road geometry; nearest-road check (photos >2 km
    off-road near the coast count as boat); drivability (no sensible road between two
    points means boat or flight).
  - Overpass, second batched query: railway stations within 3 km of stops/bases.
  - BRouter (brouter.de, `profile=rail`): train geometry. Points must be within ~1 km
    of a track, so named stops snap to their nearest station first. A "no track"
    answer is cached; network errors are not.
- **Train detection** (`by_train` in draft): land-to-land, 25–700 km, a rail route no
  longer than 1.6x the straight line, and either a 140–330 km/h photo-to-photo speed or
  departure and arrival photos both within 400 m of a station. Anything near an airport
  is excluded. Train mode then spreads across in-between route-hint photos.
- **Flights at the very start and end** of a trip are written commented out, as layovers.
  Stops used only by those flights are written as `kind: hidden`.
- **Basemap modes:** `island`, `country`, `region` (a faded crop matching the photo's aspect
  ratio). All from Natural Earth 10m, downloaded to the cache on first run.
- **The visual style is FIXED by Stephen's choice:** white roads, red pins for overnights,
  gold stars for quick stops, train legs as a white track with cross-ties and a train badge, dashed boat legs with a ship badge, dashed flight arcs with a
  plane badge, navy land at 45% with a white coast. Don't add style options unless he asks.

## Regression set

`examples/` holds the drafts and previews. It contains Stephen's real trip data (GPS points,
dates, San Antonio as home in `pnw.yaml`); he approved committing it. **If the repo is ever
made public, remind him once that this data is in it.**

- **Ireland:** `tripmap draft --from 2026-04-29 --to 2026-05-08`. Expect overnights
  Dublin(3), Killarney(2), Dingle(1), Galway(3); 2 day-trip days; boat legs only on May 5
  (Aran Islands); basemap `island`.
- **Alaska cruise:** `--from 2024-09-18 --to 2024-09-30`. Expect Seattle(3), Victoria(1);
  port-to-port boat legs; basemap `region`.
- **Italy:** `--from 2024-05-02 --to 2024-05-08`. Expect Bologna, Rome, Florence; the
  Heathrow flights commented out; train legs May 3 (Bologna→Rome, caught by speed) and
  May 5 (Rome→Florence, caught by Roma Termini + Firenze SMN photos); May 7 stays a drive
  (no evidence). Renders with basemap `region` at square sizes (this predates trains).
- Background photo for previews: any photo works.

## Known weak spots

- Some auto names are townlands ("Kilfearagh" for Kilkee, "Faill Móir" for Slea Head).
- Labels crowd in dense areas (Killarney, Skagway).
- Train detection trusts photo timestamps. Two devices with clocks an hour apart
  (Alaska, Sept 26, Skagway/Fraser) make fake speeds, and one landed in the train window.
- Stops that get no name at all fall back to raw coordinates.
