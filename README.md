# tripmap

Turns a trip in your Photos library into a transparent route-map PNG to lay over an
album photo. The look is fixed: white roads, red pins for overnight stops, gold stars
for quick stops, a railway track with cross-ties and a train badge for train legs,
dashed boat legs with a ship badge, dashed flight arcs with a plane badge, and navy
land with a white coastline.

![Italy 2024 train route, rendered on a neutral backdrop](examples/italy-preview.jpg)

- [Install](#install)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Web app](#web-app): a browser editor for drafts, with render and photo preview
- [Trip files](docs/trip-format.md): stops, legs, modes, basemaps
- [How `draft` decides](docs/how-draft-works.md): overnights, stars, boats, trains, flights
- [HTTP API](docs/api.md): the `tripmap serve` endpoints behind the local web app
- [Privacy and network use](#privacy-and-network-use)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Requirements

- **macOS**, with a Photos library that has GPS-tagged photos. The library is read from
  `~/Pictures/Photos Library.photoslibrary` by default (`--library` or `TRIPMAP_LIBRARY`
  overrides it). Only `draft` and `serve` read Photos; `render` works anywhere.
- **Node.js 22.5 or newer**, which has `node:sqlite` built in. `npx` comes with it.
- Nothing else. The SVG is rasterized with resvg, bundled with the package, so there is no
  Chrome and no ImageMagick. The preview on a photo is saved as JPEG with macOS `sips`.
- Internet access on the first run, for the basemap data and route lookups (see
  [Privacy and network use](#privacy-and-network-use)).

## Install

Nothing to install: `npx tripmap ...` fetches the package on first use. To keep it on your
PATH instead:

```sh
npm install -g tripmap
tripmap --help
```

## Quick start

```sh
npx tripmap draft --from 2026-04-29 --to 2026-05-08 -o ireland.yaml
#   ...edit ireland.yaml: rename stops, hide a hop, fix a mode...
npx tripmap render ireland.yaml --photo album-page.jpg     # -> ireland.png and a preview
```

`draft` writes a YAML file describing the route. `render` reads it and writes:

- `<name>.png`: the overlay, transparent, at 4000 px on the long side.
- `<name>-with-day-trips.png`: only if some legs are marked `day_trip: true`. The plain
  version leaves those out.
- `<name>-preview.jpg`: only with `--photo`. The overlay composited on your photo, to check
  placement before you use the PNG.

Edit the YAML between the two steps. Most corrections are a rename, a `kind` change, or
moving a leg from `drive` to `train`. Re-running `render` is cheap, since routes are cached.

## Commands

### `tripmap draft`

Detects the route for a date range and writes an editable trip file.

| Flag | Default | Meaning |
|---|---|---|
| `--from YYYY-MM-DD` | required | First day, inclusive. |
| `--to YYYY-MM-DD` | required | Last day, inclusive. |
| `-o, --output PATH` | stdout | Where to write the trip file. |
| `--title TEXT` | `Trip May 2 – May 8, 2024` | Title stored in the file. |
| `--port P --token T` | none | Hand the YAML to the hosted page (see [Web app](#web-app)). Used together. |

### `tripmap render`

Draws a trip file as transparent PNG overlays.

| Argument or flag | Default | Meaning |
|---|---|---|
| `TRIP` | required | Trip YAML file. |
| `--photo PATH` | none | Background photo. Sets the canvas shape to match it and writes a preview. |
| `--out DIR` | next to the YAML | Output folder. |
| `--size N` | `4000` | Long side of the PNG, in pixels. |
| `--day-trips` | off | Write only the with-day-trips PNG. |
| `--frame basemap\|route` | `basemap` | `basemap` follows the trip's `basemap` setting. `route` zooms to the route and fades the land at the edges, so the map is framed on the journey rather than the countries. |

### `tripmap serve`

Runs the local web app on `127.0.0.1` (see [Web app](#web-app)).

| Flag | Default | Meaning |
|---|---|---|
| `--port P` | `8787` | Port to listen on. |

### `tripmap trips`

Planned: lists trips found in the Photos library (runs of photos taken away from home).
The flags are parsed (`--since`, `--away-km`, `--min-photos`), but the TypeScript CLI does
not implement the command yet and says so.

### Global

`--library PATH` (on `draft`, `serve` and `trips`) points at a different Photos library.
`--version` prints the version.

## Web app

A browser editor over the same code: draft a trip from Photos, fix stops and legs on a map,
render the PNG, and preview it over a photo. It comes in two modes.

**Local mode** runs on your Mac:

```sh
npx tripmap serve          # http://127.0.0.1:8787
```

Open http://127.0.0.1:8787. The **Detect** button drafts a date range from Photos, the
same as `tripmap draft`; it takes tens of seconds.

**Hosted mode** is a static page at https://stephengolub.github.io/tripmap/ (once GitHub
Pages is turned on for the repository). It cannot read your Photos library, so it asks for
the dates and gives you a command to paste into Terminal:

```sh
npx --yes tripmap@1.0.0 draft --from 2026-04-29 --to 2026-05-08 --port 51234 --token 3f9c0a1b2d4e6f70
```

The CLI drafts the trip on your Mac and then answers the page once, on `127.0.0.1`, to that
port and token only, and only to the hosted page's origin. The page polls for up to 10
minutes. If that does not work, paste the YAML the command printed into the page instead.

**Photos needs Full Disk Access.** macOS blocks reading the Photos library until the app
that started tripmap is allowed. Open **System Settings > Privacy & Security > Full Disk
Access**, turn it on for your terminal app (Terminal, iTerm, or whatever ran
`tripmap serve` or `tripmap draft`), then quit and reopen that app and run the command
again. The local web app checks this on load and says so when it is blocked. Opening a
YAML file works without it; only drafting from Photos needs it.

In the app:

- **Edit** stops and legs. The map shows OpenStreetMap tiles.
- **Render** draws the PNG in the browser tab, with a "Show day trips" toggle and a
  download link.
- **Photo preview** composites the PNG over a photo you pick. The photo is read in the
  browser and never uploaded.
- **Open YAML** and **Save YAML** load and save the same trip files the CLI uses.

**Nothing is saved on the server.** `tripmap serve` is stateless: the trip lives in the
browser tab and goes to the server in each request. Close the tab without saving YAML and
the edits are gone. The server binds to `127.0.0.1` only and never logs coordinates or photo
paths. The endpoints are in [docs/api.md](docs/api.md).

## Trip files

A trip file has a title, a basemap, a list of **stops** (pins, stars, or hidden points),
and a list of **legs** (the travel between stops, each with a mode). The full field
reference is in [docs/trip-format.md](docs/trip-format.md).

```yaml
title: "Italy 2024"
basemap: auto
stops:
  - {name: "Bologna", kind: major, at: [44.4938, 11.3426], label: auto}
  - {name: "Florence", kind: major, at: [43.7698, 11.2556], label: auto}
legs:
  - {date: 2024-05-03, mode: train, day_trip: false, via: ["Bologna", "Florence"]}
```

## Privacy and network use

Photos is read from a temporary copy of `Photos.sqlite` (with its `-wal` and `-shm`
files). The live library is never opened or modified.

Only these things leave your machine, and each is cached under `~/.cache/tripmap`:

| Service | Sent | Why |
|---|---|---|
| Nominatim (OpenStreetMap) | Town **names** only | To find town centres for overnight pins. |
| Overpass (OpenStreetMap) | Coordinates rounded to ~100 m | Landmark names for quick stops; railway stations near stops. |
| OSRM (router.project-osrm.org) | Route points rounded to ~100 m | Road shapes, and whether a hop is drivable. |
| BRouter (brouter.de) | Station and route-hint points rounded to ~100 m | Railway geometry for train legs. |
| raw.githubusercontent.com | Nothing | Natural Earth coastline data, downloaded once. |

Lookups are best-effort. If a service is down, the draft still completes, with those names
or shapes left out, and the log says so.

Place names come from data Photos already stores on your Mac.

## Troubleshooting

**`render --photo` writes no preview.** The preview is saved as JPEG with macOS `sips`. If it
is missing, the PNGs are still written and the log says the preview was skipped.

**`draft` says Photos cannot be read.** Give your terminal app Full Disk Access (see
[Web app](#web-app)), then quit and reopen it.

**A train leg is drawn as a smooth curve, not following the rails.** Its rail route was
not found, so tripmap drew a smooth curve through its points in track style and logged
`no rail line found`. Check that the stops are near stations, or change the leg's `mode`.

**A train leg you did not take, or a train you took came out as a drive.** Detection trusts
photo timestamps. Two devices with clocks an hour apart can fake a speed. Set the leg's
`mode` by hand. See [How `draft` decides](docs/how-draft-works.md#train-legs).

**Overnight names look wrong (a townland, or a neighbouring village).** Edit the stop's
`name` in `stops`, and in every leg whose `via` refers to it.

**Landmark or road lookups keep failing.** The public Overpass and OSRM servers are often
overloaded. Wait and re-run `draft`. Successful lookups are cached, so only the missing
ones are retried.

**Cache is stale or corrupt.** Delete `~/.cache/tripmap/` and re-run. It is rebuilt on demand.

## Development

tripmap is a TypeScript monorepo with npm workspaces. Node 22.5 or newer.

```sh
npm install                # one install at the root covers every package
npm run typecheck
npm test                   # Vitest; no network, no Photos library needed
npm run build
scripts/dev.sh             # tripmap serve on 127.0.0.1:8787 plus Vite on http://localhost:5173
```

Layout:

- `packages/core/` (`@tripmap/core`): trip types, YAML, detection, geometry and `buildSvg`.
  It runs in Node and in the browser. Node-only code (the Photos reader, resvg, the disk
  cache, HTTP) is under `packages/core/src/node/`, which the browser never imports.
- `packages/cli/` (`tripmap`, the npm package): the `tripmap` command, `serve`, and the
  one-shot listener for hosted mode.
- `packages/web/` (`@tripmap/web`): the Vite + React + TypeScript editor. `npm test -w
  @tripmap/web` (Vitest) and `npm run test:e2e -w @tripmap/web` (Playwright; starts its own
  servers and opens `examples/italy.yaml`).
- `examples/`: real trip data and previews. See the note in `CLAUDE.md` about publishing.
- `scripts/dev.sh`: runs the web app locally.
- `docs/`: the trip-file reference, the detection rules, the HTTP API, and the parity report
  against the retired Python version (`docs/parity.md`).

The Python implementation was retired once the TypeScript version passed the parity gate.
Git history still has it.
