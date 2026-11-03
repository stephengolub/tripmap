# HTTP API

The local web app (`packages/web/`) is the only intended client. In local mode it calls these
endpoints through `packages/web/src/api/client.ts`; render, photo preview and YAML import run
in the browser tab and need no server. Hosted mode uses no server at all, only the one-shot
listener that `tripmap draft --port P --token T` starts (see the README's "Web app" section).

Route coordinates are personal location data. The server never logs coordinates, photo paths
or photo contents. A trip is the trip YAML as JSON (see [[trip-format]], `docs/trip-format.md`),
plus an `enabled` boolean on each leg.

## `tripmap serve`

`tripmap serve [--port 8787] [--library PATH]` binds `127.0.0.1` only, keeps no state, serves
the built web app from the package's `web-dist/` at `/`, and answers three endpoints. Errors are `{"detail": "..."}`.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /api/photos/status` | none | `{ok, library, geotagged_assets}` or `{ok: false, library, reason, message}`; `reason` is `not_found`, `permission_denied` or `unreadable` |
| `POST /api/detect` | `{from, to, title?}` (dates as `YYYY-MM-DD`) | `{trip, stats}`; 422 when `to` is before `from` or the span is over 60 days; 404 with the message when there are too few photos; 503 when Photos cannot be read |
| `POST /api/yaml` | `{trip}` | the trip YAML as `text/yaml`; 422 for a trip with no stops or legs |

POST bodies must be `application/json`, so a cross-site page cannot reach them without a CORS
preflight, and the only origin CORS allows is `http://localhost:5173`. Requests whose `Host`
is not `127.0.0.1` or `localhost` get 403, which blocks DNS rebinding. Logs are one line per
request: method, path and status.

The leg card's "suggest a mode" button calls `POST /api/suggest-mode`, which `tripmap serve`
does not answer yet. The app treats the 404 as "not available".
