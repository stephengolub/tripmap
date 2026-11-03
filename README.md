# tripmap

Turns a trip in your Photos library into a transparent route-map PNG to lay over
an album photo. Same look as the Ireland 2026 map: white roads, red pins for
overnight stops, gold stars for quick stops, railway-track train legs with a train
icon, dashed boat legs with a ship icon, dashed flight arcs with a plane icon, navy
land with a white coastline.

```sh
tripmap trips --since 2024-01-01                          # find trips and their dates
tripmap draft --from 2026-04-29 --to 2026-05-08 -o ireland.yaml
#   ...edit ireland.yaml: rename, hide, or add stops...
tripmap render ireland.yaml --photo album-page.jpg        # -> ireland.png (+ previews)
```

`render` matches the PNG to the photo's shape (4000 px on the long side) and
writes a preview composited on it. If any legs are day trips you get two
versions: `<name>.png` and `<name>-with-day-trips.png`.

## What the draft figures out

- **Overnight stops (pins):** where your last evening photo and next morning's
  photo agree, named by voting on Apple's place names across your photos there.
- **Quick stops (stars):** clusters of photos at one spot for 8+ minutes or 5+
  photos. Named from Apple's points of interest, then nearby OpenStreetMap
  landmarks, then the locality. Brief stops and airports start as `hidden`.
- **Boat legs:** photos Apple places on water, or coastal photos far from any road.
  Port-to-port hops with no sensible road (cruises, island ferries) also count.
  Boat paths bend around headlands.
- **Train legs:** land hops faster than any car (140–330 km/h between photos), or
  a departure and arrival both photographed at railway stations, provided a real
  rail line connects them. Drawn along the actual tracks, station to station.
  Train rides with no photos at either station come out as drives: switch them
  to `mode: train` by hand.
- **Flights:** big jumps too fast to drive, or between landmasses. Flights at the
  very start and end (getting there and home) are written commented out.
- **Day trips:** days that start and end at the same overnight stop.
- **Basemap:** `island` (the whole island, e.g. Ireland), `country` (the countries
  you visited), or `region` (a faded crop when the countries are huge, e.g. the US).

## Privacy

Photos are read from a temp copy of the library database, never modified.
Place names come from data Photos already stores on your Mac. Network calls:
town *names* to Nominatim (to put pins at town centres); quick stops without an
Apple point of interest, rounded to ~100 m, to Overpass; and route points,
rounded to ~100 m, to the public OSRM router; railway stations near your stops,
rounded to ~100 m, to Overpass; and train-leg station and route-hint points to the
public BRouter rail router (brouter.de). Lookups are cached in
`~/.cache/tripmap`. Rendering uses headless Google Chrome.
