# tripmap

Single-file Python CLI (`tripmap.py`, a uv inline-script; deps: pyyaml, shapely) that
turns a trip in Stephen's macOS Photos library into a transparent PNG route map to lay
over an album photo. Installed as a symlink: `~/.local/bin/tripmap -> ~/code/tripmap/tripmap.py`.
Usage is in `README.md`.

- `tripmap trips [--since DATE]`: list trips found in Photos.
- `tripmap draft --from DATE --to DATE -o trip.yaml`: detect the route, write an editable YAML.
- `tripmap render trip.yaml --photo bg.jpg`: draw the PNG(s) plus a preview composited on
  the photo. Headless Chrome rasterizes the SVG.

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
