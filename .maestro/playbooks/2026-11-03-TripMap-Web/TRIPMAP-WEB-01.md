# TripMap Web Phase 01: Extract the core into importable functions

Goal: make the draft and render pipeline callable from Python without writing files, so the API in phase 02 can use it. The CLI must behave exactly as before.

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

## Tasks

- [x] Capture a regression baseline before changing anything. Create `~/.cache/tripmap/regression-baseline/` and run `uv run tripmap draft --from 2026-04-29 --to 2026-05-08 -o ~/.cache/tripmap/regression-baseline/ireland.yaml`, the same for `--from 2024-05-02 --to 2024-05-08` as `italy.yaml`, and for `--from 2024-09-18 --to 2024-09-30` as `pnw.yaml`. Also render `italy.yaml` with `uv run tripmap render` into the same folder with `--size 800`. Verification: all four files exist and are non-empty. Record the photo counts printed by draft in the phase's `## Notes` section.

- [x] In `src/tripmap/__init__.py`, move the trip-building logic out of `cmd_draft` into a top-level function `build_trip(library, start: datetime.date, end: datetime.date, title: str | None = None) -> tuple[dict, dict]`. It returns `(trip, stats)`. `trip` has keys `title`, `basemap` (always `"auto"`), `stops` (list of dicts with `name`, `kind`, `at` as `[lat, lon]`, `label`, and optional `note`, `nights`, `photos`, `when`), and `legs` (list of dicts with `date` as an ISO string, `mode`, `day_trip`, `via` where each item is a stop name or a `[lat, lon]` list, and `enabled` boolean). `stats` has `photo_count`, `overnight_names`, `quick_names`, `hidden_names`, and `leg_counts`. Keep the existing algorithm unchanged. Verification: `uv run python -c "import tripmap"` succeeds.

- [x] Replace `sys.exit` calls inside `build_trip` with `raise TripError(message)`, where `class TripError(Exception)` is defined at module level. `cmd_draft` catches `TripError` and calls `sys.exit` with the same message as before. Verification: `uv run pytest` passes, and `uv run tripmap draft --from 2020-01-01 --to 2020-01-02 -o /tmp/none.yaml` exits non-zero with a readable message and no traceback.

- [x] Add `dump_trip_yaml(trip: dict) -> str` at module level. It produces the same text that `cmd_draft` writes today, including the header comments, the commented-out lines for disabled legs, and the "flights there and home are commented out" note. `cmd_draft` calls `build_trip` then `dump_trip_yaml`. Verification: rerun the four draft commands from the baseline task into `~/.cache/tripmap/after/` and run `cmp` against each baseline file. Any difference is a regression. Fix it before continuing. Note that the Italy photo count can differ from the committed `examples/italy.yaml`, because photos change. Compare against the baseline you captured, not the committed file.

- [x] Move the nested `mode()` function, the `by_train` function, and the `Node` class out of `cmd_draft` to module level. Give them explicit parameters: `classify_hop(a, b, geo, stations, airports) -> str`, `by_train(a, b, geo, stations, airports) -> bool`. They must behave identically. Verification: the draft commands in the baseline still produce byte-identical YAML with `cmp`.

- [x] Add `render_png(trip: dict, size: int = 4000, photo_size: tuple[int, int] | None = None, with_day_trips: bool = False) -> bytes`. It calls `build_svg` then `screenshot` into a temporary PNG, reads the bytes, deletes the temp file, and returns the bytes. `cmd_render` uses it, but the CLI still writes files to disk and still produces the same file names and preview behavior. Verification: `uv run tripmap render ~/.cache/tripmap/regression-baseline/italy.yaml --size 800 --out ~/.cache/tripmap/after/` produces a PNG, and `render_png` returns bytes that start with the PNG signature `\x89PNG`.

- [ ] Add `tests/test_core.py`. Monkeypatch `tripmap.load_photos` to return a small synthetic list of `(ts, local_datetime, lat, lon, blob)` tuples for three nights in two towns, with `blob=None`. Stub `OSM.town_centre`, `OSM.stations`, and `OSM.landmarks` to deterministic values, and stub `road_km`, `osrm`, and `rail` to no-op answers, so the test is offline. Assert that `build_trip` returns the expected number of overnight stops and that `dump_trip_yaml` output loads with `yaml.safe_load` back to a dict with the same stops and legs. Add a test that `build_trip` raises `TripError` when there are fewer than two photos. Verification: `uv run pytest tests/test_core.py -q` passes.

- [ ] Add `tests/test_classify.py` covering `classify_hop`: a 900 km hop returns `flight`, a 60 km land hop with a drivable route returns `drive`, and two sea-level nodes return `boat`. Build the `Node` objects directly and stub `drivable` and `geo` where needed. Verification: `uv run pytest -q` passes.

- [ ] Run `uv run pytest -q` and `uv run tripmap --help`. Both must succeed. Commit locally with the message `Extract build_trip, dump_trip_yaml and render_png from the CLI`. Do not push.

## Notes

(The agent fills this in: baseline photo counts, any byte differences found and how they were resolved.)

### Baseline (2026-11-03, task 1)

Files in `~/.cache/tripmap/regression-baseline/`: `ireland.yaml`, `italy.yaml`, `pnw.yaml`, `italy.png` (800x800, basemap region), all non-empty. Draft stdout/stderr saved beside them as `*.log`.

| Trip | Photos | Overnights | Legs |
|---|---|---|---|
| Ireland 2026-04-29 → 05-08 | 810 | Dublin (3), Killarney (2), Dingle (1), Galway (3) | 7 drive, 2 boat; 2 day-trip days |
| Italy 2024-05-02 → 05-08 | 571 | Bologna (2), Rome (2), Florence (2) | 3 drive, 2 train |
| Alaska/PNW 2024-09-18 → 09-30 | 675 | San Antonio (1), Seattle (3), Victoria (1) | 8 drive, 9 boat, 1 train; 1 day-trip day |

Caveat for the `cmp` checks in later tasks: during the Ireland baseline the Overpass station lookup failed on two mirrors (502, timeout). Overpass is best-effort and failures are not cached, so a later `cmp` difference may come from network flakiness rather than a code regression. If one appears, re-run both the baseline and the after-draft back to back before treating it as a regression.

### build_trip (2026-11-03, task 2)

- `build_trip` holds the whole detection algorithm unchanged; it ends by converting the internal stop/`Node` objects to plain data. `cmd_draft` now calls it and writes the YAML (and the summary print) from the returned `trip` and `stats` only, so the next task can lift that writer into `dump_trip_yaml` as-is.
- Values are kept unrounded in `trip` (`at` and `[lat, lon]` via hints); rounding to 4 / 3 decimals happens only in the YAML writer, exactly as before. Optional stop keys (`note`, `nights`, `photos`, `when`) are omitted when absent rather than set to `None`.
- `stats.overnight_names` is a plain name list; nights come from the matching stop. The day-trip-day count is derived from `trip["legs"]` (all legs, disabled included, as before).
- The YAML header needs the photo count, the two dates and the output file name, none of which are in `trip`. `dump_trip_yaml(trip)` in the next task will need them passed in some way (extra kwargs or a header-meta key); that decision is left to that task.
- Still uses `sys.exit` for the <2 photos case (next task).
- Verified: `uv run python -c "import tripmap"` OK, `uv run pytest` 45 passed, and all three drafts (Ireland, Italy, PNW) rerun into a temp dir are `cmp`-identical to the baseline, with the same summary output.
- Not committed: this playbook's rules allow local commits only when a task says so (the last task does).

### TripError (2026-11-03, task 3)

- `class TripError(Exception)` sits at module level above `km`. `build_trip` raises it for the fewer-than-2-photos case; `cmd_draft` catches it and `sys.exit`s with the same message.
- Also converted `load_photos`'s "No Photos database at ..." exit, because `build_trip` calls it and a `SystemExit` escaping into the API's threadpool would be wrong. `cmd_trips` now catches it the same way, so CLI output and exit codes are unchanged (verified: `tripmap --library /nonexistent trips` prints the message, exit 1).
- The playbook's verification range `2020-01-01 → 2020-01-02` has 8 geotagged photos, so it drafts successfully (exit 0). The error path was verified with `--from 1990-01-01 --to 1990-01-02`: prints `Only 0 geotagged photos between 1990-01-01 and 1990-01-02.`, exit 1, no traceback, no file written. `uv run pytest`: 45 passed.
- `sys.exit` calls in `build_svg`, `find_chrome` and `cmd_render` are untouched; `render_png` (task 6) may want the same treatment for the API.

### dump_trip_yaml (2026-11-03, task 4)

- Signature: `dump_trip_yaml(trip, *, photo_count=None, start=None, end=None, filename="trip.yaml") -> str`. The keyword-only extras exist only because the first two header lines name the photo count, the date range and the output file, none of which live in `trip`. `cmd_draft` passes them, so its file is unchanged. Called as plain `dump_trip_yaml(trip)` (the API's case), the first line reads `# tripmap trip. Edit freely, then:` and the render hint names `trip.yaml`.
- Legs missing `enabled` count as enabled (`l.get("enabled", True)`), matching the JSON default in the shared context. A disabled leg is written as `# - {...}`, and any disabled leg adds the "flights there and home are commented out" note, as before.
- Verified: the three drafts rerun into `~/.cache/tripmap/after/` are `cmp`-identical to the baseline (Ireland, Italy, PNW). (The task says "four"; the baseline's fourth file is the Italy render, which task 6 covers.) `uv run pytest`: 45 passed. A synthetic trip with one disabled leg dumps to YAML that `yaml.safe_load` reads back with one active leg.

### classify_hop / by_train (2026-11-03, task 5)

- `Node` was already module-level (moved in task 2), so only `mode()` and `by_train` moved. They are now `classify_hop(a, b, geo, stations, airports)` and `by_train(a, b, geo, stations, airports)` just above `build_trip`, bodies unchanged apart from the explicit parameters.
- The nested `is_airport` closure became `is_airport(n, airports)` at module level, since `by_train` needs it. `by_train` takes `geo` only to match the requested signature; it does not use it.
- Both still reach `rail` and `drivable` through module globals, so tests can stub `tripmap.rail` / `tripmap.drivable` with monkeypatch.
- Verified: `uv run pytest` 45 passed; Ireland, Italy and PNW drafts rerun into `~/.cache/tripmap/after/` are `cmp`-identical to the baseline.

### render_png (2026-11-03, task 6)

- Added three module-level functions above `cmd_render`: `canvas_size(size, photo_size)` (the W/H math the CLI used to do inline), `_render(trip, W, H, with_day_trips, geo) -> (bytes, mode)`, and `render_png(trip, size=4000, photo_size=None, with_day_trips=False, geo=None) -> bytes`. `_render` uses `tempfile.mkstemp`, screenshots into it, reads the bytes and unlinks in a `finally`.
- `cmd_render` now goes through `_render` and writes the bytes itself, so it keeps the basemap mode for its summary line. File names, previews and stdout are unchanged.
- Two additions beyond the spec: `render_png` takes an optional `geo` so the API can reuse a loaded basemap across calls; and `_render` drops legs with `enabled: false` before drawing, matching a commented-out YAML leg. YAML-loaded trips have no `enabled` key, so the CLI is unaffected.
- `render_png` does not normalize stop names to `str` the way `cmd_render` does for YAML input; JSON trips from the API already carry string names.
- Verified: `uv run tripmap render .../regression-baseline/italy.yaml --size 800 --out ~/.cache/tripmap/after/` gives an `italy.png` that is `cmp`-identical to the baseline render. `render_png(italy, size=400, photo_size=(4, 3))` returns 52,942 bytes starting `\x89PNG`, IHDR 400x300. No `tripmap-*` temp files left in `$TMPDIR`. `uv run pytest`: 45 passed.

## Manual Follow-Up (not executed by Auto Run)

- Skim `git diff HEAD~1 -- src/tripmap/__init__.py` and confirm the moved code reads well.
