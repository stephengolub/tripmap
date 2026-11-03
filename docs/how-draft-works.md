# How `draft` decides

`tripmap draft` reads only GPS coordinates, timestamps, and Apple's place names from your
Photos library. It turns them into overnight stops, quick stops, and legs, then writes a
trip file. Every decision below is a guess from photo data. Check the YAML before you
render.

The constants named here are at the top of `src/tripmap/__init__.py`. Changing one changes every draft.

## 1. Clusters and quick stops

Consecutive photos within **0.8 km** of each other form a cluster, as long as they are no
more than 2 hours apart. A cluster is a **stop** if:

- it spans **8 minutes or more** and has at least 2 photos, or
- it has **5 or more** photos, whatever its duration.

Stops that fall within 3 km of an overnight stop are "in town" and are not listed
separately.

## 2. Overnight stops (pins)

For each pair of consecutive days, tripmap compares the last photo of the first day with
the first photo of the next day, and picks the place where you probably slept:

- if the two photos are within **10 km**, or the evening photo is at or after 18:00, the
  evening photo's place is the night's location;
- otherwise, if the morning photo is before 09:00 it wins; failing that, the evening photo
  wins when it is at or after 16:00, and the morning photo otherwise.

Nights spent on water, or where the two photos are more than 150 km apart (a train or
overnight journey), are skipped.

Nights within **10 km** of each other are merged into one overnight stop, and two stops
with the same name within 25 km are merged too. **The name is decided by voting across
distinct ~100 m spots, not photos.** Counting photos let one hotel
outside town outvote the town itself. Each stop is then pinned at the town centre found by
searching the name in Nominatim.

## 3. Naming quick stops

In order:

1. The most common Apple point-of-interest name among the cluster's photos.
2. A nearby OpenStreetMap landmark within 500 m (one batched Overpass request, with
   coordinates rounded to ~100 m).
3. The most common locality name.
4. Raw coordinates, if nothing else matches.

A quick stop is **hidden**, not shown as a star, if its name looks like an airport
(`airport`, `terminal`, and the Spanish, French, and German equivalents), a railway station
(`Roma Termini`, `Firenze Santa Maria Novella`, `Bahnhof`, and so on), or if it is a brief
stop: fewer than 8 photos in under 20 minutes.

Apple's street-level place entries are never read. They can name your lodging.

## 4. Sea and road checks

A photo is **at sea** when:

- it is more than 0.6 km from every coastline in Natural Earth's 10m land data; or
- Apple's data places it on water; or
- it is classed as land but sits between two photos that are at sea (a shoreline photo
  taken from the boat); or
- it is within 8 km of the coast, outside any stop, and the nearest road is more than 2 km
  away. Photos within 1.5 km and 30 minutes of such a photo are also at sea.

## 5. Legs

Consecutive stops and route-hint points are joined into legs. Each hop gets a mode,
checked in this order:

1. **Train**, if `by_train` says so (see below).
2. **Flight**, if the hop is over 200 km at more than 130 km/h photo-to-photo, or over 900 km.
3. **Boat**, if both ends are at sea. If only one end is at sea, it is a boat when both ends
   are near the coast, and a drive otherwise.
4. **Boat or flight**, for hops over 25 km with no sensible road between the two points (no
   route, a huge detour, or mostly ferry). Coastal hops become boats; otherwise a hop over
   300 km becomes a flight and anything shorter a drive.
5. **Boat or flight**, if the two ends are on different landmasses: a flight over 80 km, a
   boat otherwise.
6. **Drive**, otherwise.

Consecutive hops of the same mode are merged into one leg.

### Train legs

A hop is a train if **all** of these hold:

- both ends are on land, and neither is at an airport;
- they are 25 to 700 km apart;
- a rail route exists between them (BRouter), no longer than **1.6×** the straight-line
  distance plus 20 km;
- **and** either the photo-to-photo speed is **140 to 330 km/h** (for hops over 40 km), or
  both the departure and arrival photos are within **400 m** of a railway station.

The speed test needs no station photos, so it catches a train you rode with the phone in
your pocket. The station test catches a slow train or a platform photo. Photos in between
become route hints. If a train leg and a drive leg are joined only by route-hint points,
both become train legs. Detection trusts photo timestamps. Clocks on two
devices out of step can fake a speed, so always check train legs.

## 6. Flights at the ends

Flights at the very start and end of the trip are written commented out, along with the
short drives next to them, since these are usually getting to and from the airport. Their
airport stops are `hidden`.

## 7. Day trips

A day that starts and ends at the same overnight stop, with every leg driven and the furthest
point more than **15 km** away, is a **day trip**: its legs get `day_trip: true`. `render`
draws them only in the `-with-day-trips.png` version.

## Where to check the draft

- Any leg whose mode is `train`, `flight`, or `boat`. Those are inferred from speed and
  geography, and are the most likely to be wrong.
- Overnight names, which come from voting. A townland or a neighbouring village is possible.
- Hidden stops, which are easy to miss. Unhide one by changing its `kind` to `minor`.
