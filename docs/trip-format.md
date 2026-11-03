# Trip file format

A trip file is YAML. `draft` writes one, `render` reads one. You can write one by hand.

```yaml
title: "Ireland 2026"        # optional text, not drawn on the map
basemap: island             # auto | island | country | region
stops:                      # places: pins, stars, or hidden points
  - {name: "Dublin", kind: major, at: [53.3498, -6.2603], label: auto}
  - {name: "Dun Aengus", kind: minor, at: [53.1196, -9.6658], label: se}
  - {name: "Shannon Airport", kind: hidden, at: [52.7020, -8.9248], label: auto}
legs:                       # travel between stops, in order
  - {date: 2026-05-01, mode: drive, day_trip: false, via: ["Dublin", "Killarney"]}
  - {date: 2026-05-05, mode: boat, day_trip: false, via: ["Galway", [53.251, -9.041], "Galway"]}
  # - {date: 2026-05-08, mode: flight, day_trip: false, via: ["Shannon Airport", "Heathrow"]}
```

## Top-level keys

| Key | Required | Values | Meaning |
|---|---|---|---|
| `title` | no | any string | Stored for reference. Not drawn on the map. |
| `basemap` | no, default `auto` | see below | Which land to draw behind the route. |
| `stops` | yes | list | Every named place the route refers to. |
| `legs` | yes | list | The travel, in order. |

### Basemaps

| Value | Draws |
|---|---|
| `auto` | `island` if the trip stays on small landmasses (Ireland, a Greek island). Otherwise `country`, falling back to `region` when those countries are much larger than the route. |
| `island` | The whole island, for a trip on one island (Ireland). |
| `country` | The countries visited. |
| `region` | A faded crop around the route, matched to the background photo's aspect ratio. Used for very large countries (the US). |

## Stops

Each entry is a mapping:

| Field | Required | Values | Meaning |
|---|---|---|---|
| `name` | yes | string | The identifier legs use in `via`. Renaming a stop means renaming it in `legs` too. |
| `kind` | yes | `major`, `minor`, `hidden` | See below. |
| `at` | yes | `[lat, lon]` | Where the marker sits, in decimal degrees. |
| `label` | no, default `auto` | `auto`, `n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`, `none` | Which side of the marker the label goes. `none` hides the label. |

**`kind`:**

- `major`: a red pin. Used for overnight stops.
- `minor`: a gold star. Used for quick stops, like a viewpoint or a short visit.
- `hidden`: no marker. The route passes through it, so it is still a point in `via`. Used
  for airports, brief stops, and layovers. A hidden stop never gets a marker; it only
  shapes the route.

Put a stop in `legs` to route through it. A stop used only by a commented-out leg is
written as `hidden`.

## Legs

Each entry is a mapping:

| Field | Required | Values | Meaning |
|---|---|---|---|
| `date` | yes | `YYYY-MM-DD` | The day of travel. Informational. Drawing doesn't use it. |
| `mode` | yes | `drive`, `train`, `boat`, `flight` | How the leg is drawn. See below. |
| `day_trip` | no, default `false` | `true`, `false` | `true` legs are left out of the plain PNG and drawn only in `-with-day-trips.png`. |
| `via` | yes | list of stop names and `[lat, lon]` points | The route, in travel order. |

**`via`** items can be either:

- a **stop name**, which must match a `name` under `stops`. The route is pinned there.
- a **`[lat, lon]` point**, a route hint. The path is routed through it, so it shapes the
  line without adding a marker. `draft` writes these from photos taken along the way.

**`mode`:**

| Mode | Drawn as | Routed by |
|---|---|---|
| `drive` | A solid white road. Ferry crossings are drawn as dotted lines. | OSRM road routing. |
| `train` | A white track with cross-ties and a train badge. | BRouter rail routing. Named stops snap to the nearest station first. If no track is found, a smooth curve through the points is drawn in the same style. |
| `boat` | A dashed line with a ship badge. Bends around headlands. | A sea route computed from the coastline. |
| `flight` | A dashed arc with a plane badge. | Straight arc between the endpoints. |

### Commented-out legs

Flights at the very start and end of a trip (getting there and home) are written commented
out, since they are usually layovers. Uncomment a line to draw it. Its stops are already
listed as `hidden`.

## A complete example

`examples/italy.yaml` is a real draft for the Italy 2024 trip, with the train legs filled
in. It is a good starting point for your own edits.
