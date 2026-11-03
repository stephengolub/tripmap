# HTTP API

`tripmap-api` serves a small JSON API over the same code the CLI runs. The web frontend
in `web/` is its only intended client.

```sh
uv sync --all-extras
uv run tripmap-api            # http://127.0.0.1:8000, --port to change the port
```

Ground rules:

- **It binds to `127.0.0.1` only**, and CORS allows `http://localhost:5173` only. There is
  no flag to change the host.
- **It is stateless.** The server keeps no session and no trip. The browser owns the trip
  document and sends it in each request body. Disk caches under `~/.cache/tripmap` are
  caches, not state.
- **A trip is the trip YAML as JSON** (see [[trip-format]], `docs/trip-format.md`), plus an
  `enabled` boolean on each leg. A disabled leg becomes a commented-out line in YAML, so
  importing that YAML again drops it rather than bringing it back as `enabled: false`.
- **Errors** use FastAPI's `{"detail": ...}` shape. Validation failures are 422 with
  FastAPI's list of problems; the handlers' own refusals are 422 or 404 with a string.
- Route coordinates are personal location data. The server never logs coordinates, photo
  paths or photo contents.

The examples below use public city centres, not real trip data.

## How the web app calls it

The browser reaches the API only through the Vite dev server's `/api` proxy, through the
functions in `web/src/api/client.ts`. Run both with `scripts/dev.sh` (see the README's
"Web app" section).

| Web app action | Client function | Endpoint |
|---|---|---|
| Photos check on load | `getPhotosStatus` | `GET /api/photos/status` |
| Draft | `draftTrip` | `POST /api/trips/draft` |
| Render (1600 px, `photo_size` from the preview photo) | `renderTrip` | `POST /api/trips/render` |
| Save YAML (downloads `trip.yaml`) | `exportYaml` | `POST /api/trips/yaml` |
| Open YAML (file read with `FileReader`) | `importYaml` | `POST /api/trips/import` |
| Mode suggestion for a leg | `suggestMode` | `POST /api/legs/suggest-mode` |

The photo preview never calls the API: the background photo stays in the browser and is
composited on a canvas.

## Endpoints

### GET /api/photos/status

Checks that the server can read the Photos library. The library is `tripmap.LIBRARY`,
which the `TRIPMAP_LIBRARY` environment variable overrides. It reads a temp copy of
`database/Photos.sqlite` (with `-wal` and `-shm`), counts the geotagged, untrashed assets,
and deletes the copy. It returns a count only: no coordinates, no photo paths.

Request:

```sh
curl http://127.0.0.1:8000/api/photos/status
```

Response, when it works:

```json
{"ok": true, "library": "/Users/you/Pictures/Photos Library.photoslibrary", "geotagged_assets": 41237}
```

Response, when macOS blocks it (still HTTP 200; `ok` carries the result):

```json
{
  "ok": false,
  "library": "/Users/you/Pictures/Photos Library.photoslibrary",
  "reason": "permission_denied",
  "message": "macOS blocked reading the Photos library. Grant Full Disk Access to the app running the server (your terminal, or whatever launched tripmap-api) in System Settings > Privacy & Security > Full Disk Access, then restart it."
}
```

| `reason` | Meaning |
|---|---|
| `not_found` | No library directory, or no `database/Photos.sqlite` in it. |
| `permission_denied` | The process may not read the library. Grant Full Disk Access as the message says. |
| `unreadable` | The database copy would not open or query. |

### POST /api/trips/draft

Detects a trip's route from the photos between two dates, the same as `tripmap draft`.
This takes tens of seconds, because it calls Overpass, OSRM and BRouter (all cached).
`title` is optional; without it the title is made from the dates.

Request:

```sh
curl -X POST http://127.0.0.1:8000/api/trips/draft \
  -H 'Content-Type: application/json' \
  -d '{"start": "2026-05-01", "end": "2026-05-04", "title": "Ireland sample"}'
```

Response (shortened):

```json
{
  "trip": {
    "title": "Ireland sample",
    "basemap": "auto",
    "stops": [
      {"name": "Dublin", "kind": "major", "at": [53.3498, -6.2603], "label": "auto", "nights": 2, "photos": 84},
      {"name": "Galway", "kind": "major", "at": [53.2707, -9.0568], "label": "auto", "nights": 1, "photos": 37}
    ],
    "legs": [
      {"date": "2026-05-03", "mode": "drive", "day_trip": false, "via": ["Dublin", "Galway"], "enabled": true}
    ]
  },
  "stats": {
    "photo_count": 121,
    "overnight_names": ["Dublin", "Galway"],
    "quick_names": [],
    "hidden_names": [],
    "leg_counts": {"drive": 1}
  }
}
```

Errors: 422 when `end` is before `start` or the range is over 60 days (`end - start > 60`);
404 with the detector's message when the range has too few photos.

### POST /api/trips/render

Draws the trip as a transparent PNG, the same as `tripmap render`. Headless Chrome
rasterizes the SVG. Disabled legs are left out.

| Field | Default | Meaning |
|---|---|---|
| `trip` | required | The trip document. |
| `size` | `1600` | Long edge in pixels, 200 to 6000. |
| `photo_size` | `null` | `{"width", "height"}` of the background photo, to match its aspect ratio. |
| `with_day_trips` | `false` | Draw `day_trip: true` legs too. |

Request:

```sh
curl -X POST http://127.0.0.1:8000/api/trips/render \
  -H 'Content-Type: application/json' -o map.png \
  -d '{"trip": {"basemap": "island",
               "stops": [{"name": "Dublin", "kind": "major", "at": [53.3498, -6.2603], "label": "auto"},
                         {"name": "Galway", "kind": "major", "at": [53.2707, -9.0568], "label": "auto"}],
               "legs": [{"date": "2026-05-03", "mode": "drive", "day_trip": false,
                         "via": ["Dublin", "Galway"], "enabled": true}]},
       "size": 1600, "photo_size": {"width": 3000, "height": 2000}}'
```

Response: `200`, `Content-Type: image/png`, the PNG bytes (here 1600x1067).

Errors: 422 when the trip has no stops or no legs, when `size` is out of range, or when the
trip is missing fields the renderer needs; 503 when Chrome is not installed.

```json
{"detail": "The trip has no stops"}
```

### POST /api/trips/yaml

Turns a trip document into editable YAML text, the same file `tripmap draft` writes,
header comments included. A leg with `enabled: false` is written commented out.

Request:

```sh
curl -X POST http://127.0.0.1:8000/api/trips/yaml \
  -H 'Content-Type: application/json' \
  -d '{"trip": {"title": "Ireland sample", "basemap": "island",
               "stops": [{"name": "Dublin", "kind": "major", "at": [53.3498, -6.2603], "label": "auto"},
                         {"name": "Galway", "kind": "major", "at": [53.2707, -9.0568], "label": "auto"}],
               "legs": [{"date": "2026-05-01", "mode": "drive", "day_trip": false, "via": ["Dublin", "Galway"], "enabled": true},
                        {"date": "2026-05-04", "mode": "drive", "day_trip": false, "via": ["Galway", "Dublin"], "enabled": false}]}}'
```

Response: `200`, `Content-Type: text/yaml` (header comments shortened):

```yaml
# tripmap trip. Edit freely, then:
#   tripmap render trip.yaml --photo <background photo>
# ...

title: "Ireland sample"
basemap: island

stops:
  - {name: "Dublin", kind: major, at: [53.3498, -6.2603], label: auto}
  - {name: "Galway", kind: major, at: [53.2707, -9.0568], label: auto}

legs:
  - {date: 2026-05-01, mode: drive, day_trip: false, via: ["Dublin", "Galway"]}
  # - {date: 2026-05-04, mode: drive, day_trip: false, via: ["Galway", "Dublin"]}
```

Errors: 422 when the trip is missing fields the YAML writer needs.

### POST /api/trips/import

Parses trip YAML text into a trip document. The body is the raw YAML, sent as
`text/plain`. Legs without `enabled` get `enabled: true`, and YAML dates come back as ISO
strings, so an imported trip has the same shape as a drafted one. Commented-out legs are
comments, so they are not imported.

Request:

```sh
curl -X POST http://127.0.0.1:8000/api/trips/import \
  -H 'Content-Type: text/plain' --data-binary @trip.yaml
```

Response, for the YAML shown under `/api/trips/yaml`:

```json
{
  "trip": {
    "title": "Ireland sample",
    "basemap": "island",
    "stops": [
      {"name": "Dublin", "kind": "major", "at": [53.3498, -6.2603], "label": "auto"},
      {"name": "Galway", "kind": "major", "at": [53.2707, -9.0568], "label": "auto"}
    ],
    "legs": [
      {"date": "2026-05-01", "mode": "drive", "day_trip": false, "via": ["Dublin", "Galway"], "enabled": true}
    ]
  }
}
```

Errors: 422 when the text is not valid YAML, is not a mapping, or has no `stops` or no
`legs`.

### POST /api/legs/suggest-mode

Suggests a travel mode for one hop between two points, using the same `classify_hop` rules
as draft (see [[how-draft-works]], `docs/how-draft-works.md`). It never queries Overpass,
so with no station data a train is only recognised by its speed. It can call OSRM and
BRouter, both cached. `elapsed_hours` is optional; when given it is the photo-to-photo gap
the speed rules use.

Request:

```sh
curl -X POST http://127.0.0.1:8000/api/legs/suggest-mode \
  -H 'Content-Type: application/json' \
  -d '{"from": [53.3498, -6.2603], "to": [45.7640, 4.8357]}'
```

Response (Dublin to Lyon):

```json
{"mode": "flight", "reason": "The points are 1160 km apart, too far to drive."}
```

And with `{"from": [53.3498, -6.2603], "to": [53.2707, -9.0568], "elapsed_hours": 2.5}`
(Dublin to Galway):

```json
{"mode": "drive", "reason": "A road links the two points, 186 km apart."}
```

`mode` is one of `drive`, `train`, `boat`, `flight`. Errors: 422 when a point is not a
`[lat, lon]` pair or `elapsed_hours` is negative.

## `tripmap serve` (the Node server)

The TypeScript CLI's `tripmap serve [--port 8787] [--library PATH]` replaces `tripmap-api`
for local mode. It binds `127.0.0.1` only, keeps no state, serves the built web app from the
package's `web-dist/` at `/`, and answers three endpoints. Errors are `{"detail": "..."}`.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /api/photos/status` | none | `{ok, library, geotagged_assets}` or `{ok: false, library, reason, message}`; `reason` is `not_found`, `permission_denied` or `unreadable`, as above |
| `POST /api/detect` | `{from, to, title?}` (dates as `YYYY-MM-DD`) | `{trip, stats}`; 422 when `to` is before `from` or the span is over 60 days; 404 with the message when there are too few photos; 503 when Photos cannot be read |
| `POST /api/yaml` | `{trip}` | the trip YAML as `text/yaml`; 422 for a trip with no stops or legs |

POST bodies must be `application/json`, so a cross-site page cannot reach them without a CORS
preflight, and the only origin CORS allows is `http://localhost:5173`. Requests whose `Host`
is not `127.0.0.1` or `localhost` get 403, which blocks DNS rebinding. Logs are one line per
request: method, path and status.
