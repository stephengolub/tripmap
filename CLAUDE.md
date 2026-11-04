# tripmap

TypeScript npm-workspaces monorepo that turns a trip in Stephen's macOS Photos library into a
transparent PNG route map to lay over an album photo. Usage is in `README.md`; the trip-file
reference is `docs/trip-format.md`, how draft decides is `docs/how-draft-works.md`, and the
local server's endpoints are in `docs/api.md`. The Python version was retired after the parity
gate (`docs/parity.md`); git history keeps it.

## Packages, build and tests (npm workspaces)

- Root `package.json` has `"workspaces": ["packages/*"]`. Node 22.5 or newer (`node:sqlite`).
  Locally Node is the asdf install at `/Users/sgolub/.asdf/installs/nodejs/22.14.0/bin/`;
  put it on PATH when `npm` is not. Node 22.14 prints an ExperimentalWarning for
  `node:sqlite`; run scripts with `--no-warnings`.
- `packages/core` (`@tripmap/core`): types, YAML, detection, geometry, `buildSvg`. It must run
  in Node AND the browser. Node-only code lives under `packages/core/src/node/` (Photos reader,
  resvg rasterizer, disk cache, HTTP); the browser bundle never imports from it.
- `packages/cli` (`tripmap`, the npm package and `bin`, version in its `package.json`). It is bundled
  with esbuild into one `dist/cli.js`, which inlines `@tripmap/core`; `@resvg/resvg-js` is the only
  runtime dependency. The bundle banner defines `require` with `createRequire`, because the `yaml`
  package calls `require` inside an ESM bundle. Verify a change by packing and installing the
  tarball in an empty directory, not only by running the workspace build.
  `draft`, `render`, `serve`, and the one-shot hosted-mode listener. `trips` is parsed but not
  implemented yet.
- `packages/web` (`@tripmap/web`): Vite + React + TypeScript editor with a Leaflet map.
- From the root: `npm install`, `npm run typecheck`, `npm test` (Vitest, offline; network
  calls are stubbed and the cache is redirected), `npm run build`. Add new HTTP-touching code
  under the same stubs.
- `npm run test:e2e -w @tripmap/web` (Playwright) starts its servers from
  `packages/web/playwright.config.ts` and opens `examples/italy.yaml`, so it needs no network
  or Photos access. `scripts/dev.sh` runs `tripmap serve` on 8787 plus Vite on 5173.
- Rendering: `buildSvg` makes the SVG. Node rasterizes it with `@resvg/resvg-js`; the browser
  rasterizes it on a canvas. No Chrome, no ImageMagick. The `--photo` preview JPEG uses macOS
  `sips`, and is skipped with a notice when that is missing.
- Not unit-tested end to end: the full detection run over a real library, and the full
  render. `examples/` is the regression check for those.

- `npx tripmap draft --from DATE --to DATE -o trip.yaml`: detect the route, write an editable
  YAML (stdout without `-o`).
- `npx tripmap render trip.yaml --photo bg.jpg`: draw the PNG(s) plus a preview composited on
  the photo.
- `npx tripmap serve [--port 8787]`: the local web app on `127.0.0.1`.
- Hosted page: https://stephengolub.github.io/tripmap/ (built by `.github/workflows/pages.yml`
  with `VITE_MODE=hosted`, base path `/tripmap/`).

## Web app architecture (don't change without recording why)

- Layout: all code is TypeScript under `packages/`. Scripts are in `scripts/`. Endpoints are
  documented in `docs/api.md`.
- Two modes. **Local:** `tripmap serve` serves the built app and `GET /api/photos/status`,
  `POST /api/detect`, `POST /api/yaml`. Default port 8787 (not 8000). **Hosted:** a static
  GitHub Pages build that shows a date form, then generates
  `npx --yes tripmap@<VERSION> draft --from A --to B --port P --token T` (P random in
  49152–65535, T 16 random hex characters) and polls `http://127.0.0.1:P/trip?token=T` every
  1.5 s for up to 10 minutes. The CLI's listener answers once and closes. A paste box is the
  fallback.
- The listener allows only the origins `https://stephengolub.github.io` and
  `http://localhost:5173`. `tripmap serve` allows CORS from `http://localhost:5173` only and
  rejects any `Host` other than `127.0.0.1`/`localhost`.
- Front end: Leaflet via react-leaflet, OpenStreetMap raster tiles from
  `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with the attribution
  `© OpenStreetMap contributors`. Never prefetch or bulk-download tiles.
- **The server is stateless.** It keeps no session, no trip, and no per-user state. The
  browser owns the trip document and sends it in each request body. Disk caches under
  `~/.cache/tripmap` are allowed because they are caches, not state. The background photo
  for the preview never leaves the browser. Render and photo preview run in the browser tab.
- Everything binds to `127.0.0.1` only.
- **Never log coordinates, photo paths, or photo contents.** Route coordinates are personal
  location data. Logs may say counts and status codes.
- Trip JSON uses the trip YAML's field names plus an `enabled` boolean per leg (default
  true). A disabled leg is written as a commented-out YAML line.
- Any server-side HTTP call sets a descriptive User-Agent.

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
- **Train detection** (`byTrain` in `packages/core/src/trains.ts`): land-to-land, 25–700 km, a rail route no
  longer than 1.6x the straight line, and either a 140–330 km/h photo-to-photo speed or
  departure and arrival photos both within 400 m of a station. Anything near an airport
  is excluded. Train mode then spreads across in-between route-hint photos.
- **Flights at the very start and end** of a trip are written commented out, as layovers.
  Stops used only by those flights are written as `kind: hidden`.
- **Connecting countries are always drawn.** `countriesAlong` in `packages/core/src/basemap.ts` includes
  every country whose outline is within `CORRIDOR_KM` (100 km) of the route, not only countries that
  contain a trip point. Without this, countries the route crosses at sea (Central America) are missing
  and the visited countries look like islands. Not behind a toggle.
- **Zoom to route** (`frame: 'route'`, the CLI `--frame route`, the web "Zoom to route" box) forces the
  region crop, tighter (half-size 0.6 of the route span, against 0.85 for the basemap crop), with the
  faded edges. Default is `basemap`, so the committed examples render unchanged.
- **Basemap modes:** `island`, `country`, `region` (a faded crop matching the photo's aspect
  ratio). All from Natural Earth 10m, downloaded to the cache on first run.
- **The visual style is FIXED by Stephen's choice:** white roads, red pins for overnights,
  gold stars for quick stops, train legs as a white track with cross-ties and a train badge, dashed boat legs with a ship badge, dashed flight arcs with a
  plane badge, navy land at 45% with a white coast. Don't add style options unless he asks.

## Regression set

`examples/` holds the drafts and previews. It contains Stephen's real trip data (GPS points,
dates, San Antonio as home in `pnw.yaml`); he approved committing it. **The repository is
public, so this GPS data is public too. Remind him once that this data is in it.** Do not add
more real trip data anywhere in the repo: test fixtures are synthetic, and scratch output goes
under `~/.cache/tripmap/` or `/tmp`.

- **Ireland:** `npx tripmap draft --from 2026-04-29 --to 2026-05-08`. Expect overnights
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
