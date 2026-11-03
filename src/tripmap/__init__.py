"""tripmap: turn a trip in your Photos library into a transparent route-map overlay.

  tripmap trips [--since YYYY-MM-DD]                 list trips found in Photos
  tripmap draft --from YYYY-MM-DD --to YYYY-MM-DD    detect the route -> trip.yaml
  tripmap render trip.yaml [--photo bg.jpg]          draw it -> transparent PNG(s)

Draft reads photo GPS only (the library is copied to a temp dir and never
modified). Place names come from OpenStreetMap (Nominatim + Overpass) using
rounded coordinates; road shapes come from the public OSRM router.
"""
import argparse, datetime as dt, hashlib, json, math, os, re, shutil, sqlite3, subprocess
import plistlib, sys, tempfile, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

import yaml
import shapely
from shapely import STRtree
from shapely.geometry import LineString, MultiPolygon, Point, box, shape

CACHE = Path.home() / ".cache" / "tripmap"
LIBRARY = Path.home() / "Pictures" / "Photos Library.photoslibrary"
UA = "tripmap/1.0 (personal photo-album route maps)"
CHROME_APP = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_NAMES = ("google-chrome", "chromium", "chromium-browser")  # looked up on PATH
APPLE_EPOCH = 978307200

# Detection tuning
STOP_RADIUS_KM = 0.8      # photos within this of each other form one cluster
STOP_MIN_SECONDS = 480    # a cluster this long (and 2+ photos) is a stop
STOP_MIN_PHOTOS = 5       # ...or this many photos regardless of duration
BASE_MERGE_KM = 10        # overnight spots this close are the same base
NEAR_BASE_KM = 3          # stops this close to a base are just "in town"
WAYPOINT_KM = 12          # spacing of in-between photo points kept as route hints
SEA_KM = 0.6              # a photo this far off the coastline was taken on the water
TRAIN_KMH = (140, 330)    # land-to-land photo speeds no car manages, but a train does
STATION_KM = 0.4          # a departure/arrival photo this close to a station counts as at the station
STATION_NAME = re.compile(r"\b(rail(way)? station|train station|bahnhof|hauptbahnhof|hbf|stazione|"
                          r"termini|estaci[oó]n de tren)\b", re.I)


class TripError(Exception):
    """A trip cannot be built or drawn; the message is meant for the user."""


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- Photos

def load_photos(library, t0=None, t1=None):
    """[(utc_ts, local_datetime, lat, lon, place_blob)] for geotagged, non-trashed assets."""
    db = Path(library) / "database" / "Photos.sqlite"
    if not db.exists():
        raise TripError(f"No Photos database at {db}")
    tmp = Path(tempfile.mkdtemp(prefix="tripmap-"))
    try:
        for suf in ("", "-wal", "-shm"):
            src = Path(str(db) + suf)
            if src.exists():
                shutil.copy2(src, tmp / ("Photos.sqlite" + suf))
        con = sqlite3.connect(tmp / "Photos.sqlite")
        rows = con.execute(f"""
            SELECT z.ZDATECREATED + {APPLE_EPOCH}, z.ZLATITUDE, z.ZLONGITUDE, a.ZTIMEZONEOFFSET,
                   a.ZREVERSELOCATIONDATA
            FROM ZASSET z LEFT JOIN ZADDITIONALASSETATTRIBUTES a ON a.Z_PK = z.ZADDITIONALATTRIBUTES
            WHERE z.ZTRASHEDSTATE = 0
              AND z.ZLATITUDE BETWEEN -90 AND 90 AND z.ZLONGITUDE BETWEEN -180 AND 180
              AND NOT (z.ZLATITUDE = 0 AND z.ZLONGITUDE = 0)
              AND z.ZDATECREATED + {APPLE_EPOCH} BETWEEN ? AND ?
            ORDER BY 1""", (t0 or 0, t1 or 4e9)).fetchall()
        con.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    out = []
    for ts, lat, lon, off, blob in rows:
        local = dt.datetime.fromtimestamp(ts, dt.timezone(dt.timedelta(seconds=off or 0)))
        out.append((ts, local.replace(tzinfo=None), lat, lon, blob))
    return out


DESIGNATION = re.compile(r"\b(SAC|SPA|NHA|pNHA|SSSI|AONB|IBA)\b")


def apple_place(blob):
    """Decode the reverse geocode Photos stores per asset (Apple Maps data).
    Returns {"city", "state", "country", "cc", "poi", "island"} or {}.
    Street-level entries (type 17, which can name your lodging) are never read."""
    if not blob:
        return {}
    try:
        p = plistlib.loads(blob)
        o = p["$objects"]
        R = lambda v: o[v.data] if isinstance(v, plistlib.UID) else v
        root = R(p["$top"]["root"])
        pa = R(root.get("postalAddress")) or {}
        val = lambda d, k: (lambda v: None if v in (None, "$null", "") else v)(R(d.get(k)))
        info = dict(city=val(pa, "_city"), state=val(pa, "_state"), country=val(pa, "_country"),
                    cc=val(root, "countryCode"))
        places = []
        mi = R(root.get("mapItem"))
        if isinstance(mi, dict) and mi.get("sortedPlaceInfos") is not None:
            for x in R(R(mi["sortedPlaceInfos"])["NS.objects"]):
                d = R(x)
                places.append((R(d["placeType"]), R(d["name"]), R(d["area"]) or 0))
    except Exception:  # noqa: BLE001 - odd/old blobs just go unnamed
        return {}
    types = {t for t, _, _ in places}
    info["water"] = 7 in types and not types & {4, 6, 11}
    info["onland"] = bool(types & {4, 6, 11})
    info["towns"], info["localities"] = {}, {}
    for t, n, a in places:
        if t in (4, 6, 11) and a < (4e9 if t == 4 else 5e8) and not re.search(r"\d", n):
            info["localities"][n] = max(a, info["localities"].get(n, 0))
            if t in (4, 11):
                info["towns"][n] = info["localities"][n]
    aoi = [(a, n) for t, n, a in places if t == 8 and 0 < a < 5e7 and not DESIGNATION.search(n)]
    info["poi"] = min(aoi)[1] if aoi else None
    isl = [(a, n) for t, n, a in places if t == 11 and 0 < a < 5e8]
    info["island"] = min(isl)[1] if isl else None
    if not info["city"]:
        towns = [(a, n) for t, n, a in places if t == 4 and a > 0]
        info["city"] = min(towns)[1] if towns else None
    return info


def town_vote(photos, prefer_small=False, key="localities"):
    """The locality name shared by the most photos; ties go to the bigger (or smaller) area."""
    cells, area = {}, {}  # count distinct ~100 m spots, so one hotel can't outvote a town walk
    for p in photos:
        for n, a in p["place"].get(key, {}).items():
            cells.setdefault(n, set()).add((round(p["lat"], 3), round(p["lon"], 3)))
            area[n] = max(a, area.get(n, 0))
    votes = {n: len(c) for n, c in cells.items()}
    if not votes:
        return None
    return max(votes, key=lambda n: (votes[n], -area[n] if prefer_small else area[n]))


def vote(photos, key):
    c = {}
    for p in photos:
        v = p["place"].get(key)
        if v:
            c[v] = c.get(v, 0) + 1
    return max(c, key=c.get) if c else None


# ---------------------------------------------------------------- geodata

def natural_earth(name):
    path = CACHE / "ne" / f"{name}.geojson"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/{name}.geojson"
        log(f"downloading {name} (one-time)...")
        urllib.request.urlretrieve(url, path)
    return json.load(open(path))["features"]


def parts(geom):
    return list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]


class Geo:
    def __init__(self):
        self.land = [p for n in ("ne_10m_land", "ne_10m_minor_islands")
                     for ft in natural_earth(n) for p in parts(shape(ft["geometry"]))]
        self.tree = STRtree(self.land)
        self._countries = None

    def classify(self, lat, lon):
        """(landmass index or None, at_sea)."""
        pt = Point(lon, lat)
        hit = self.tree.query(pt, predicate="intersects")
        if len(hit):
            return int(hit[0]), False
        idx, dist = self.tree.query_nearest(pt, return_distance=True)
        if dist[0] * 111 * math.cos(math.radians(lat)) > SEA_KM:
            return None, True
        return int(idx[0]), False

    def coast_km(self, lat, lon):
        """Distance to the nearest coastline (0 at sea)."""
        pt = Point(lon, lat)
        i = int(self.tree.query_nearest(pt)[0])
        return self.land[i].exterior.distance(pt) * 111 * math.cos(math.radians(lat))

    def nearest(self, lat, lon):
        return int(self.tree.query_nearest(Point(lon, lat))[0])

    def classify_strict(self, lat, lon):
        hit = self.tree.query(Point(lon, lat), predicate="intersects")
        return int(hit[0]) if len(hit) else None

    @property
    def countries(self):
        if self._countries is None:
            feats = natural_earth("ne_10m_admin_0_countries")
            self._countries = [shape(f["geometry"]) for f in feats]
            self._ctree = STRtree(self._countries)
        return self._countries

    def countries_at(self, pts):
        self.countries
        found = []
        for lat, lon in pts:
            for i in self._ctree.query(Point(lon, lat), predicate="intersects"):
                if int(i) not in found:
                    found.append(int(i))
        return found


# ---------------------------------------------------------------- OSM lookups

class OSM:
    def __init__(self):
        self.path = CACHE / "geocode.json"
        self.cache = json.load(open(self.path)) if self.path.exists() else {}
        self.last = 0.0

    def _fetch(self, url, data=None):
        if url + (data or "") in self.cache:
            return self.cache[url + (data or "")]
        wait = 1.1 - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(url, data=data.encode() if data else None, headers={"User-Agent": UA})
        for attempt in range(3):
            try:
                res = json.load(urllib.request.urlopen(req, timeout=60))
                break
            except Exception as e:  # noqa: BLE001 - retry any network hiccup
                if attempt == 2:
                    log(f"  lookup failed ({e}); continuing without it")
                    return None
                time.sleep(3 * (attempt + 1))
        self.last = time.time()
        self.cache[url + (data or "")] = res
        self.path.parent.mkdir(parents=True, exist_ok=True)
        json.dump(self.cache, open(self.path, "w"))
        return res

    OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
    POI = ['[tourism~"^(attraction|viewpoint|museum|theme_park|zoo|gallery|aquarium)$"]',
           '[historic][historic!~"^(memorial|wayside_cross|wayside_shrine|boundary_stone|milestone|yes)$"]',
           '[natural~"^(beach|cliff|peak|bay|cave_entrance|waterfall|glacier|arch|volcano)$"]',
           '[leisure~"^(park|garden|nature_reserve)$"]', '[boundary=national_park]']

    def _overpass(self, body, what):
        """Elements for an Overpass union body, cached. Best effort: [] if every mirror fails."""
        query = f"[out:json][timeout:90];({body});out tags center;"
        key = "overpass:" + hashlib.sha1(query.encode()).hexdigest()
        res = self.cache.get(key)
        for url in ([] if res else self.OVERPASS):
            try:
                req = urllib.request.Request(url, data=("data=" + urllib.parse.quote(query)).encode(),
                                             headers={"User-Agent": UA})
                res = json.load(urllib.request.urlopen(req, timeout=100))
                if res.get("remark") and not res.get("elements"):  # e.g. a timeout, reported with HTTP 200
                    raise RuntimeError(res["remark"][:120])
                self.cache[key] = res
                self.path.parent.mkdir(parents=True, exist_ok=True)
                json.dump(self.cache, open(self.path, "w"))
                break
            except Exception as e:  # noqa: BLE001 - next mirror
                log(f"  {what} lookup via {urllib.parse.urlparse(url).netloc} failed: {e}")
        return (res or {}).get("elements", [])

    def landmarks(self, spots):
        """[(lat, lon)] -> [name or None], one batched Overpass request (coords rounded to ~100 m).
        Best effort: if every mirror fails, returns Nones and the draft carries on."""
        if not spots:
            return []
        spots = [(round(a, 3), round(b, 3)) for a, b in spots]
        els = self._overpass("".join(f"nwr(around:500,{a},{b})[name]{f};" for a, b in spots for f in self.POI),
                             "landmark")
        out = []
        for ll in spots:
            best, best_score = None, 1e9
            for e in els:
                c = e.get("center") or e
                if "lat" not in c:
                    continue
                t = e["tags"]
                d = km(ll, (c["lat"], c["lon"]))
                if d > 0.5:
                    continue
                score = d - 0.4 * ("wikidata" in t or "wikipedia" in t) - 0.15 * (e.get("type") != "node")
                if score < best_score:
                    best, best_score = t.get("name:en") or t["name"], score
            out.append(best)
        return out

    def stations(self, spots, radius_km=3):
        """Railway stations within radius_km of any of [(lat, lon)] (coords rounded to ~100 m),
        one batched Overpass request -> Stations. Best effort: empty if every mirror fails."""
        spots = sorted({(round(a, 3), round(b, 3)) for a, b in spots})
        if not spots:
            return Stations([])
        f = '[railway~"^(station|halt)$"][station!~"^(subway|light_rail|monorail|funicular|miniature)$"]'
        els = self._overpass("".join(f"node(around:{radius_km * 1000:.0f},{a},{b}){f};" for a, b in spots),
                             "station")
        return Stations([(e["lat"], e["lon"], e["tags"].get("railway") == "halt") for e in els if "lat" in e])

    def town_centre(self, name, cc, near):
        """Town-centre coordinates by searching the town NAME (no coordinates are sent)."""
        q = urllib.parse.urlencode(dict(format="jsonv2", q=name, countrycodes=(cc or "").lower(), limit=8,
                                        **{"accept-language": "en"}))
        hits = self._fetch("https://nominatim.openstreetmap.org/search?" + q) or []
        hits = [h for h in hits if km((float(h["lat"]), float(h["lon"])), near) < 20]
        if not hits:
            return (round(near[0], 3), round(near[1], 3))
        h = min(hits, key=lambda h: (h.get("addresstype") not in ("city", "town", "village"),
                                     km((float(h["lat"]), float(h["lon"])), near)))
        return (round(float(h["lat"]), 4), round(float(h["lon"]), 4))


class Stations:
    def __init__(self, pts):
        self.pts = pts  # [(lat, lon, is_halt)]

    def nearest(self, ll, max_km):
        """Closest station to ll within max_km (a minor halt counts as 800 m further), or None."""
        near = [(km(ll, (a, b)), halt, (a, b)) for a, b, halt in self.pts]
        best = min(((d + 0.8 * halt, s) for d, halt, s in near if d < max_km), default=None)
        return best[1] if best else None


# ---------------------------------------------------------------- trips

def cmd_trips(args):
    since = dt.datetime.fromisoformat(args.since).timestamp() if args.since else 0
    try:
        pts = load_photos(args.library, since)
    except TripError as e:
        sys.exit(str(e))
    if not pts:
        sys.exit("No geotagged photos found.")
    cells = {}
    for p in pts:
        k = (round(p[2], 1), round(p[3], 1))
        cells[k] = cells.get(k, 0) + 1
    home = max(cells, key=cells.get)
    days = {}
    for ts, local, lat, lon, blob in pts:
        if km(home, (lat, lon)) > args.away_km:
            days.setdefault(local.date(), []).append(blob)
    trips, cur = [], []
    for d in sorted(days):
        if cur and (d - cur[-1]).days > 2:
            trips.append(cur)
            cur = []
        cur.append(d)
    if cur:
        trips.append(cur)
    log(f"home looks like {home[0]:.1f}, {home[1]:.1f}; trips more than {args.away_km:g} km away:\n")
    for t in trips:
        n = sum(len(days[d]) for d in t)
        if n < args.min_photos:
            continue
        places = []
        for d in t:
            for blob in days[d][::max(1, len(days[d]) // 6)]:
                info = apple_place(blob)
                place = info.get("state") if info.get("cc") in ("US", "CA", "AU") else info.get("country")
                if place and place not in places:
                    places.append(place)
        print(f"{t[0]} → {t[-1]}  {len(t):>2} days  {n:>5} photos  {', '.join(places) or '?'}")
    print("\nNext: tripmap draft --from <start> --to <end>")


# ---------------------------------------------------------------- draft

class Node:
    def __init__(self, kind, lat, lon, t=None, ref=None, sea=False, raw=None):
        self.kind, self.lat, self.lon, self.t, self.ref, self.sea = kind, lat, lon, t, ref, sea
        self.t0, self.raw0, self.raw = t, raw, raw  # first and latest photo here (arrival / departure)

    @property
    def ll(self):
        return (self.lat, self.lon)


def build_trip(library, start: dt.date, end: dt.date, title: str | None = None) -> tuple[dict, dict]:
    """Detect the route of the trip between two dates from the Photos library.

    Returns (trip, stats). trip is the trip document as plain data, the same field
    names as the trip YAML plus `enabled` on each leg; stats summarises the draft."""
    d0, d1 = start, end
    t0 = dt.datetime.combine(d0, dt.time()).timestamp() - 86400 * 1.2
    t1 = dt.datetime.combine(d1, dt.time()).timestamp() + 86400 * 2.2
    raw = [p for p in load_photos(library, t0, t1) if d0 <= p[1].date() <= d1]
    if len(raw) < 2:
        raise TripError(f"Only {len(raw)} geotagged photos between {d0} and {d1}.")
    log(f"{len(raw)} geotagged photos, {d0} → {d1}")
    geo, osm = Geo(), OSM()

    P = [dict(t=ts, lt=lt, lat=la, lon=lo, place=apple_place(blob)) for ts, lt, la, lo, blob in raw]
    for p in P:
        p["land"], p["sea"] = geo.classify(p["lat"], p["lon"])
        p["shore"] = not p["sea"] and geo.classify_strict(p["lat"], p["lon"]) is None
        if p["place"].get("water"):
            p["sea"], p["land"], p["shore"] = True, None, False
        elif p["place"].get("onland"):
            if p["sea"]:
                p["land"] = geo.nearest(p["lat"], p["lon"])
            p["sea"], p["shore"] = False, False
    for i, p in enumerate(P):
        if p["shore"]:
            prev = next((q for q in reversed(P[:i]) if not q["shore"]), None)
            nxt = next((q for q in P[i + 1:] if not q["shore"]), None)
            if prev and nxt and prev["sea"] and nxt["sea"]:
                p["sea"], p["land"] = True, None

    # 1. clusters of consecutive nearby photos
    clusters, cur = [], None
    for p in P:
        if cur and not p["sea"] and not cur["sea"] and km((cur["lat"], cur["lon"]), (p["lat"], p["lon"])) < STOP_RADIUS_KM \
                and p["t"] - cur["t1"] < 7200:
            cur["pts"].append(p)
            cur["t1"] = p["t"]
            n = len(cur["pts"])
            cur["lat"] += (p["lat"] - cur["lat"]) / n
            cur["lon"] += (p["lon"] - cur["lon"]) / n
        else:
            cur = dict(pts=[p], t0=p["t"], t1=p["t"], lat=p["lat"], lon=p["lon"], sea=p["sea"])
            clusters.append(cur)
        p["cluster"] = cur
    for c in clusters:
        c["stop"] = not c["sea"] and ((c["t1"] - c["t0"] >= STOP_MIN_SECONDS and len(c["pts"]) >= 2)
                                      or len(c["pts"]) >= STOP_MIN_PHOTOS)
    prev = None
    for c in clusters:
        if not c["stop"]:
            continue
        if prev and c["t0"] - prev["t1"] < 5400 and km((prev["lat"], prev["lon"]), (c["lat"], c["lon"])) < 2.5:
            c["stop"] = False
            c["parent"] = prev
            prev["t1"] = c["t1"]
            prev["pts"] += c["pts"]
            for p in c["pts"]:
                p["cluster"] = prev
            continue
        prev = c

    # coastal photos far from any road (outside stops) were taken from the water
    checks = [p for p in P if not p["sea"] and not p["cluster"]["stop"] and not p["place"].get("water")
              and geo.coast_km(p["lat"], p["lon"]) < 8]
    sample = []
    for p in checks:
        if not sample or km((sample[-1]["lat"], sample[-1]["lon"]), (p["lat"], p["lon"])) > 3:
            sample.append(p)
    if sample:
        log(f"checking {len(sample)} coastal spots for roads...")
    offroad = []
    for p in sample:
        r = road_km(p["lat"], p["lon"])
        if r is not None and r > 2:
            offroad.append(p)
    for p in checks:
        if any(km((o["lat"], o["lon"]), (p["lat"], p["lon"])) < 1.5 and abs(o["t"] - p["t"]) < 1800 for o in offroad):
            p["sea"], p["land"] = True, None

    # 2. where each night was spent -> bases (major stops)
    by_day = {}
    for p in P:
        by_day.setdefault(p["lt"].date(), []).append(p)
    dates = sorted(by_day)
    nights = {}  # date -> base dict, for the night following that date
    bases = []
    for d, n in zip(dates, dates[1:]):
        ev, mo = by_day[d][-1], by_day[n][0]
        if km((ev["lat"], ev["lon"]), (mo["lat"], mo["lon"])) < BASE_MERGE_KM or ev["lt"].hour >= 18:
            loc = ev
        elif mo["lt"].hour < 9:
            loc = mo
        else:
            loc = ev if ev["lt"].hour >= 16 else mo
        if loc["sea"] or km((ev["lat"], ev["lon"]), (mo["lat"], mo["lon"])) > 150:
            continue  # slept aboard a ship/train, or travelled overnight
        base = next((b for b in bases if km(b["raw"], (loc["lat"], loc["lon"])) < BASE_MERGE_KM), None)
        if not base:
            base = dict(raw=(loc["lat"], loc["lon"]), nights=0, kind="major")
            bases.append(base)
        base["nights"] += 1
        nights[d] = base

    # name bases from Apple's town names; pin them at the town centre
    log(f"naming {len(bases)} overnight stops...")
    for b in bases:
        near = [p for p in P if km(b["raw"], (p["lat"], p["lon"])) < 3]
        b["name"] = town_vote(near, key="towns") or town_vote(near) or vote(near, "city") \
            or f"Stop {bases.index(b) + 1}"
        b["at"] = osm.town_centre(b["name"], vote(near, "cc"), b["raw"])
    merged = []
    for b in bases:  # two night spots in the same town
        same = next((m for m in merged if m["name"] == b["name"] and km(m["at"], b["at"]) < 25), None)
        if same:
            same["nights"] += b["nights"]
            for d in nights:
                if nights[d] is b:
                    nights[d] = same
        else:
            merged.append(b)
    bases = merged

    def near_base(ll):
        return next((b for b in bases if km(b["at"], ll) < NEAR_BASE_KM or km(b["raw"], ll) < NEAR_BASE_KM), None)

    # 3. quick stops (minor), named from Apple's points of interest
    stops = []
    names = {b["name"] for b in bases}
    todo = [c for c in clusters if c["stop"] and not near_base((c["lat"], c["lon"]))]
    need = [c for c in todo if not vote(c["pts"], "poi")]
    if need:
        log(f"looking up landmarks for {len(need)} of {len(todo)} quick stops...")
    for c, lm in zip(need, osm.landmarks([(c["lat"], c["lon"]) for c in need])):
        c["landmark"] = lm
    for c in todo:
        name = vote(c["pts"], "poi") or c.get("landmark") or town_vote(c["pts"], prefer_small=True) \
            or f"{c['lat']:.3f}, {c['lon']:.3f}"
        same = next((x for x in stops + bases if x["name"] == name and km(x["at"], (c["lat"], c["lon"])) < 8), None)
        if same:
            c["ref"] = same
            same["photos"] = same.get("photos", 0) + len(c["pts"])
            continue
        unique, i = name, 2
        while unique in names:
            unique, i = f"{name} ({i})", i + 1
        names.add(unique)
        airport = bool(re.search(r"\bairport\b|\bterminal\b|\baeroport|\baeropuerto|\bflughafen", name, re.I))
        station = bool(STATION_NAME.search(name))
        brief = len(c["pts"]) < 8 and c["t1"] - c["t0"] < 1200
        x = dict(name=unique, at=(round(c["lat"], 4), round(c["lon"], 4)),
                 kind="hidden" if airport or station or brief else "minor", photos=len(c["pts"]),
                 when=dt.datetime.fromtimestamp(c["t0"]).strftime("%b %-d"),
                 note="airport" if airport else "station" if station else "brief stop" if brief else None)
        stops.append(x)
        c["ref"] = x
    for c in clusters:
        if c["stop"] and "ref" not in c:
            c["ref"] = near_base((c["lat"], c["lon"]))

    # railway stations near stops and overnight spots, for spotting train legs
    log("looking up railway stations...")
    stations = osm.stations([(c["lat"], c["lon"]) for c in clusters if c["stop"]] + [b["raw"] for b in bases])

    airports = [s["at"] for s in stops if s.get("note") == "airport"]

    def is_airport(n):
        return bool(n.ref and n.ref.get("note") == "airport") or any(km(n.ll, a) < 5 for a in airports)

    def by_train(a, b):
        """Is a -> b a train ride? Needs a rail route, plus a speed no car manages or a
        departure and arrival photographed at stations."""
        if a.sea or b.sea or is_airport(a) or is_airport(b):
            return False
        dist = km(a.ll, b.ll)
        if dist < 25 or dist > 700:
            return False
        fast = a.t and b.t0 and dist > 40 and TRAIN_KMH[0] < dist / max((b.t0 - a.t) / 3600, 0.1) < TRAIN_KMH[1]
        at_stations = all(n.raw and stations.nearest(n.raw if n is a else n.raw0, STATION_KM) for n in (a, b))
        if not (fast or at_stations):
            return False
        ends = [stations.nearest(n.raw or n.ll, 3) or n.ll for n in (a, b)]
        path = rail(ends)
        return bool(path) and sum(km(p, q) for p, q in zip(path, path[1:])) < 1.6 * dist + 20

    # 4. per-day node sequences
    first_day, last_day = dates[0], dates[-1]
    legs = []
    prev_night = None
    for d in dates:
        seq = []
        start_base = nights.get(prev_night) if prev_night else None
        end_base = nights.get(d)
        if start_base:
            seq.append(Node("stop", *start_base["at"], ref=start_base))
        elif legs:
            last = legs[-1]["via"][-1]
            seq.append(Node(last.kind, last.lat, last.lon, t=last.t, ref=last.ref, sea=last.sea))
        day = by_day[d]
        for i, p in enumerate(day):
            c = p["cluster"]
            switch = (i > 0 and day[i - 1]["sea"] != p["sea"]) or (i + 1 < len(day) and day[i + 1]["sea"] != p["sea"])
            if c.get("ref"):
                node = Node("stop", *c["ref"]["at"], t=p["t"], ref=c["ref"], raw=(p["lat"], p["lon"]))
            elif p["sea"]:
                node = Node("sea", p["lat"], p["lon"], t=p["t"], sea=True)
                if seq and seq[-1].kind == "sea" and km(seq[-1].ll, node.ll) < 1.5:
                    continue
            else:
                if seq and not switch and km(seq[-1].ll, (p["lat"], p["lon"])) < WAYPOINT_KM:
                    if seq[-1].ref is not None:  # a stray photo in town, e.g. at the station on the way out
                        seq[-1].raw = (p["lat"], p["lon"])
                    continue
                node = Node("shore" if switch else "way", p["lat"], p["lon"], t=p["t"], raw=(p["lat"], p["lon"]))
            if seq and node.ref is not None and seq[-1].ref is node.ref:
                seq[-1].t, seq[-1].raw = node.t, node.raw
                if seq[-1].t0 is None:
                    seq[-1].t0, seq[-1].raw0 = node.t, node.raw
                continue
            seq.append(node)
        if end_base and not (seq and seq[-1].ref is end_base):
            seq.append(Node("stop", *end_base["at"], ref=end_base))
        # tidy: no dangling route hints at the very start/end of the trip, none hugging a stop
        if d == first_day:
            while seq and seq[0].kind == "way":
                seq.pop(0)
        if d == last_day:
            while seq and seq[-1].kind == "way":
                seq.pop()
        seq = [n for i, n in enumerate(seq) if n.kind != "way" or i + 1 >= len(seq)
               or km(n.ll, seq[i + 1].ll) > 3]
        prev_night = d

        # 5. segment modes, merged into legs
        def mode(a, b):
            dist = km(a.ll, b.ll)
            if by_train(a, b):
                return "train"
            if a.t and b.t and dist > 200 and dist / max((b.t - a.t) / 3600, 0.1) > 130:
                return "flight"
            if dist > 900:
                return "flight"
            if a.sea and b.sea:
                return "boat"
            coastal = all(n.sea or geo.coast_km(n.lat, n.lon) < 5 for n in (a, b))
            if a.sea or b.sea:
                return "boat" if coastal else "drive"
            if dist > 25 and not drivable(a.ll, b.ll):
                return "boat" if coastal else "flight" if dist > 300 else "drive"
            ma, mb = geo.classify_strict(a.lat, a.lon), geo.classify_strict(b.lat, b.lon)
            if ma is not None and mb is not None and ma != mb:  # different islands/continents
                return "flight" if dist > 80 else "boat"
            return "drive"

        modes = [mode(a, b) for a, b in zip(seq, seq[1:])]
        # photos taken from the train are only route hints: the hops either side of one ride the train too
        for _ in range(len(modes)):
            changed = False
            for i in range(len(modes) - 1):
                if seq[i + 1].kind == "way" and {modes[i], modes[i + 1]} == {"train", "drive"}:
                    modes[i] = modes[i + 1] = "train"
                    changed = True
            if not changed:
                break
        day_legs = []
        for a, b, m in zip(seq, seq[1:], modes):
            if day_legs and day_legs[-1]["mode"] == m:
                day_legs[-1]["via"].append(b)
            else:
                day_legs.append(dict(date=d, mode=m, via=[a, b]))
        loop = (start_base is not None and start_base is end_base and day_legs
                and all(l["mode"] == "drive" for l in day_legs)
                and max(km(start_base["at"], (p["lat"], p["lon"])) for p in by_day[d]) > 15)
        for l in day_legs:
            l["day_trip"] = bool(loop)
        legs += day_legs

    # arrival/departure flights at either end are usually layovers: keep them, commented out
    for l in legs:
        l["off"] = False
    i = 0
    while i < len(legs) and legs[i]["mode"] in ("flight", "drive") and any(x["mode"] == "flight" for x in legs[i:i + 2]):
        if legs[i]["mode"] == "flight":
            for x in legs[:i + 1]:
                x["off"] = True
            break
        i += 1
    j = len(legs) - 1
    while j >= 0 and j > i:
        if legs[j]["mode"] == "flight":
            for x in legs[j:]:
                x["off"] = True
            break
        if legs[j]["mode"] != "drive" or j < len(legs) - 2:
            break
        j -= 1
    active = [l for l in legs if not l["off"]]

    # 6. the trip document, as plain data
    used = {id(n.ref) for l in legs for n in l["via"] if n.ref}
    in_active = {id(n.ref) for l in active for n in l["via"] if n.ref}
    for x in stops + bases:
        if id(x) in used and id(x) not in in_active:
            x["kind"], x["note"] = "hidden", "layover"
    all_stops = [b for b in bases] + [s for s in stops if id(s) in used]
    trip_stops = []
    for s in all_stops:
        x = dict(name=s["name"], kind=s["kind"], at=[s["at"][0], s["at"][1]], label="auto")
        for k in ("note", "nights", "photos", "when"):
            if s.get(k) is not None:
                x[k] = s[k]
        trip_stops.append(x)
    trip_legs = [dict(date=l["date"].isoformat(), mode=l["mode"], day_trip=bool(l["day_trip"]),
                      via=[n.ref["name"] if n.ref else [n.lat, n.lon] for n in l["via"]],
                      enabled=not l["off"])
                 for l in legs]
    trip = dict(title=title or f"Trip {d0:%b %-d} – {d1:%b %-d, %Y}", basemap="auto",
                stops=trip_stops, legs=trip_legs)
    counts = {}
    for l in active:
        counts[l["mode"]] = counts.get(l["mode"], 0) + 1
    stats = dict(photo_count=len(raw),
                 overnight_names=[b["name"] for b in bases],
                 quick_names=[s["name"] for s in trip_stops if s["kind"] == "minor"],
                 hidden_names=[s["name"] for s in trip_stops if s["kind"] == "hidden"],
                 leg_counts=counts)
    return trip, stats


def cmd_draft(args):
    d0, d1 = dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end)
    try:
        trip, stats = build_trip(args.library, d0, d1, args.title)
    except TripError as e:
        sys.exit(str(e))
    out = Path(args.output)
    q = lambda s: json.dumps(s, ensure_ascii=False)
    L = [f"# tripmap draft from {stats['photo_count']} photos, {d0} to {d1}. Edit freely, then:",
         f"#   tripmap render {out.name} --photo <background photo>",
         "#",
         "# stops: kind = major (red pin) | minor (gold star) | hidden (route passes, no marker)",
         "#        label = auto | n | s | e | w | ne | nw | se | sw | none",
         "#        rename freely; legs refer to stops by name, so rename in both places",
         "# legs:  mode = drive (real roads) | train (real rail lines, train icon) | boat (dashed, ship icon)",
         "#               | flight (dashed arc, plane icon)",
         "#        via = stop names or [lat, lon] route hints, in travel order",
         "#        day_trip: true legs are left out of the plain version and drawn in",
         "#        the \"-with-day-trips\" version",
         "# basemap: auto | island (whole island, e.g. Ireland) | country | region (cropped, faded edges)",
         "",
         f"title: {q(trip['title'])}",
         f"basemap: {trip['basemap']}",
         "",
         "stops:"]
    for s in trip["stops"]:
        note = (f"{s['nights']} night{'s' * (s['nights'] > 1)}" if s.get("nights") and not s.get("note")
                else f"{s.get('photos', 0)} photos, {s.get('when', '')}")
        if s.get("note"):
            note += f" ({s['note']}; hidden by default)"
        L.append(f"  - {{name: {q(s['name'])}, kind: {s['kind']}, at: [{s['at'][0]:.4f}, {s['at'][1]:.4f}], "
                 f"label: {s['label']}}}  # {note}")
    L += ["", "legs:"]
    if any(not l["enabled"] for l in trip["legs"]):
        L.insert(L.index("legs:"), "# The flights there and home are commented out (usually just a layover).\n"
                                  "# Uncomment them to draw them; their stops are already listed, hidden.")
    for l in trip["legs"]:
        via = ", ".join(q(v) if isinstance(v, str) else f"[{v[0]:.3f}, {v[1]:.3f}]" for v in l["via"])
        L.append(f"  {'' if l['enabled'] else '# '}- {{date: {l['date']}, mode: {l['mode']}, "
                 f"day_trip: {str(l['day_trip']).lower()}, via: [{via}]}}")
    out.write_text("\n".join(L) + "\n")

    nights = {s["name"]: s.get("nights") for s in trip["stops"]}
    print(f"Wrote {out}")
    print(f"  {len(stats['overnight_names'])} overnight stops: "
          + ", ".join(f"{n} ({nights[n]})" for n in stats["overnight_names"]))
    print(f"  {len(stats['quick_names'])} quick stops: " + ", ".join(stats["quick_names"]))
    if stats["hidden_names"]:
        print(f"  hidden: " + ", ".join(stats["hidden_names"]))
    print("  legs: " + ", ".join(f"{v} {k}" for k, v in stats["leg_counts"].items())
          + f"; {len({l['date'] for l in trip['legs'] if l['day_trip']})} day-trip days")
    print(f"Next: review {out}, then tripmap render {out} --photo <background photo>")


# ---------------------------------------------------------------- routing

def osrm(coords):
    """[(mode, [(lat, lon), ...])] along roads; mode is 'drive' or 'ferry'."""
    coords = [(round(a, 3), round(b, 3)) for a, b in coords]
    pieces = []
    for i in range(0, len(coords) - 1, 24):
        chunk = coords[i:i + 25]
        cs = ";".join(f"{lon},{lat}" for lat, lon in chunk)
        path = CACHE / "osrm" / (hashlib.sha1(cs.encode()).hexdigest() + ".json")
        if path.exists():
            data = json.load(open(path))
        else:
            url = (f"https://router.project-osrm.org/route/v1/driving/{cs}"
                   "?overview=false&steps=true&geometries=geojson&continue_straight=false")
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                data = json.load(urllib.request.urlopen(req, timeout=90))
            except Exception as e:  # noqa: BLE001
                log(f"  routing failed ({e}); drawing a straight line for that stretch")
                data = {"code": "Error"}
            if data.get("code") == "Ok":
                path.parent.mkdir(parents=True, exist_ok=True)
                json.dump(data, open(path, "w"))
            time.sleep(1.0)
        if data.get("code") != "Ok":
            pieces.append(("drive", list(chunk)))
            continue
        for leg in data["routes"][0]["legs"]:
            for st in leg["steps"]:
                m = "ferry" if st.get("mode") == "ferry" else "drive"
                pts = [(la, lo) for lo, la in st["geometry"]["coordinates"]]
                if pieces and pieces[-1][0] == m:
                    pieces[-1][1].extend(pts[1:])
                else:
                    pieces.append((m, pts))
    return pieces


def road_km(lat, lon):
    """Distance to the nearest road (OSRM nearest), or None if the lookup fails."""
    lat, lon = round(lat, 3), round(lon, 3)
    path = CACHE / "osrm" / f"nearest_{lat}_{lon}.json"
    if path.exists():
        data = json.load(open(path))
    else:
        url = f"https://router.project-osrm.org/nearest/v1/driving/{lon},{lat}?number=1"
        try:
            data = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30))
        except Exception:  # noqa: BLE001
            return None
        time.sleep(1.0)
        if data.get("code") == "Ok":
            path.parent.mkdir(parents=True, exist_ok=True)
            json.dump(data, open(path, "w"))
    if data.get("code") != "Ok":
        return None
    return data["waypoints"][0]["distance"] / 1000


def drivable(a, b):
    """Is there a sensible road between a and b? False if no route, a huge detour,
    or a route that is mostly ferry."""
    pieces = osrm([a, b])
    if len(pieces) == 1 and pieces[0][1] == [(round(a[0], 3), round(a[1], 3)), (round(b[0], 3), round(b[1], 3))]:
        return False  # routing failed, straight-line fallback
    length = lambda pts: sum(km(p, q) for p, q in zip(pts, pts[1:]))
    total = sum(length(p) for _, p in pieces)
    ferry = sum(length(p) for m, p in pieces if m == "ferry")
    return total < 2.5 * km(a, b) + 20 and ferry < 0.4 * total


def rail(coords):
    """[(lat, lon), ...] along railway lines through coords (BRouter's rail profile), or None.
    Points must sit within about a kilometre of a track: snap towns to their station first."""
    cs = "|".join(f"{lon:.4f},{lat:.4f}" for lat, lon in coords)
    path = CACHE / "rail" / (hashlib.sha1(cs.encode()).hexdigest() + ".json")
    if path.exists():
        data = json.load(open(path))
    else:
        url = ("https://brouter.de/brouter?" + urllib.parse.urlencode(
            dict(lonlats=cs, profile="rail", alternativeidx=0, format="geojson")))
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            data = json.load(urllib.request.urlopen(req, timeout=90))
        except urllib.error.HTTPError as e:  # BRouter answers "no track found" as an HTTP error
            msg = e.read().decode(errors="replace")[:200]
            if "no track" not in msg:
                log(f"  rail routing failed ({e.code}: {msg.strip()})")
                return None
            data = {"error": msg}
        except Exception as e:  # noqa: BLE001 - network trouble: don't cache, just give up on this one
            log(f"  rail routing failed ({e})")
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        json.dump(data, open(path, "w"))
        time.sleep(1.0)
    try:
        return [(la, lo) for lo, la, *_ in data["features"][0]["geometry"]["coordinates"]]
    except (KeyError, IndexError, TypeError):
        return None


def train_route(ll, named, stations):
    """Rail path for a train leg: named stops snap to their nearest station, [lat, lon] hints
    (photos from the train) are routed through as-is, dropped if they won't route. Falls back
    to a smooth line through the via points, and says so."""
    snapped = [stations.nearest(p, 5) or p if is_name else p for p, is_name in zip(ll, named)]
    path = rail(snapped)
    if path is None and len(ll) > 2:
        keep = [p for p, is_name in zip(snapped, named) if is_name] or [snapped[0], snapped[-1]]
        if keep[0] != snapped[0]:
            keep.insert(0, snapped[0])
        if keep[-1] != snapped[-1]:
            keep.append(snapped[-1])
        path = rail(keep) if len(keep) > 1 else None
    if path is None:
        log(f"  no rail line found from {ll[0]} to {ll[-1]}; drawing the train leg as a smooth line")
        return list(ll), False
    return [ll[0]] + path + [ll[-1]], True


# ---------------------------------------------------------------- render

class Canvas:
    def __init__(self, w, h, bbox):
        """bbox: (min_lon, min_lat, max_lon, max_lat) to fit with margins."""
        self.w, self.h = w, h
        lat0 = (bbox[1] + bbox[3]) / 2
        self.kx = math.cos(math.radians(lat0))
        bw = (bbox[2] - bbox[0]) * self.kx
        bh = bbox[3] - bbox[1]
        self.s = min(w * 0.86 / bw, h * 0.86 / bh)
        self.ox = w / 2 - self.s * (bbox[0] + bbox[2]) / 2 * self.kx
        self.oy = h / 2 + self.s * (bbox[1] + bbox[3]) / 2

    def __call__(self, lat, lon):
        return (self.ox + self.s * lon * self.kx, self.oy - self.s * lat)

    def geom(self, g, tol):
        f = lambda c: c * [self.s * self.kx, -self.s] + [self.ox, self.oy]
        return shapely.transform(g, f).simplify(tol)


def poly_d(g):
    d = []
    for p in parts(g):
        if p.geom_type != "Polygon" or p.is_empty:
            continue
        for ring in [p.exterior, *p.interiors]:
            c = list(ring.coords)
            if len(c) > 2:
                d.append("M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in c) + "Z")
    return " ".join(d)


def line_d(pts):
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)


def smooth_d(pts):
    d = f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"
    for i in range(len(pts) - 1):
        p0 = pts[i - 1] if i else pts[i]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[i + 2] if i + 2 < len(pts) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}"
    return d


def thin(pts, step):
    out = [pts[0]]
    for p in pts[1:]:
        if math.dist(p, out[-1]) >= step:
            out.append(p)
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return out


def midpoint(pts):
    total = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
    acc = 0
    for a, b in zip(pts, pts[1:]):
        seg = math.dist(a, b)
        if acc + seg >= total / 2 and seg:
            f = (total / 2 - acc) / seg
            return (a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])), total
        acc += seg
    return pts[0], total


def land_cut(geo, a, b):
    """km of the straight a->b line that crosses land, ignoring 1.5 km around each end."""
    line = LineString([(a[1], a[0]), (b[1], b[0])])
    ends = Point(a[1], a[0]).buffer(0.02).union(Point(b[1], b[0]).buffer(0.02))
    cut = 0.0
    for i in geo.tree.query(line):
        seg = line.intersection(geo.land[int(i)]).difference(ends)
        cut += seg.length * 111 * math.cos(math.radians(a[0]))
    return cut


def sea_route(geo, a, b, depth=0):
    """Bend a boat segment out to sea until it stops cutting across land."""
    if depth >= 4 or land_cut(geo, a, b) < 0.3:
        return [a, b]
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    kx = math.cos(math.radians(mid[0]))
    dx, dy = (b[1] - a[1]) * kx, b[0] - a[0]
    best = None
    for f in (0.12, -0.12, 0.25, -0.25, 0.4, -0.4):
        m = (mid[0] + dx * f, mid[1] - dy * f / kx)
        c = land_cut(geo, a, m) + land_cut(geo, m, b)
        if best is None or c < best[0]:
            best = (c, m)
        if c < 0.3:
            break
    m = best[1]
    return sea_route(geo, a, m, depth + 1)[:-1] + sea_route(geo, m, b, depth + 1)


def pick_basemap(geo, mode, trip_ll, aspect=1.0):
    """-> (mode, [shapely geoms in lon/lat], bbox)"""
    lons = [lo for _, lo in trip_ll]
    lats = [la for la, _ in trip_ll]
    trip_bbox = (min(lons), min(lats), max(lons), max(lats))
    masses = sorted({geo.classify(la, lo)[0] for la, lo in trip_ll} - {None})

    def union_bbox(gs):
        b = [g.bounds for g in gs]
        return (min(x[0] for x in b), min(x[1] for x in b), max(x[2] for x in b), max(x[3] for x in b))

    def grow(b, f):
        w, h = b[2] - b[0], b[3] - b[1]
        return (b[0] - w * f, b[1] - h * f, b[2] + w * f, b[3] + h * f)

    def inside(g, b):
        x0, y0, x1, y1 = g.bounds
        return x0 >= b[0] and y0 >= b[1] and x1 <= b[2] and y1 <= b[3]

    if mode == "auto":
        small = all(max((g.bounds[2] - g.bounds[0]) * 0.6, g.bounds[3] - g.bounds[1]) < 12
                    for g in (geo.land[i] for i in masses))
        mode = "island" if masses and small else "country"
    if mode == "island":
        main = grow(union_bbox([geo.land[i] for i in masses]), 0.03)
        main = (min(main[0], trip_bbox[0]), min(main[1], trip_bbox[1]),
                max(main[2], trip_bbox[2]), max(main[3], trip_bbox[3]))
        return mode, [g for g in geo.land if inside(g, main)], main
    if mode == "country":
        geoms = []
        for ci in geo.countries_at(trip_ll):
            ps = parts(geo.countries[ci])
            hit = [p for p in ps if any(p.intersects(Point(lo, la)) for la, lo in trip_ll)] or ps
            keep = grow(union_bbox(hit), 0.25)
            geoms.append(MultiPolygon([p for p in ps if inside(p, keep)]))
        if geoms:
            b = union_bbox(geoms)
            tb_area = max(trip_bbox[2] - trip_bbox[0], 1.0) * max(trip_bbox[3] - trip_bbox[1], 1.0)
            if (b[2] - b[0]) * (b[3] - b[1]) <= 12 * tb_area:
                return mode, geoms, b
        mode = "region"
    # region: crop around the trip, edges faded
    w, h = max(trip_bbox[2] - trip_bbox[0], 1.5), max(trip_bbox[3] - trip_bbox[1], 1.0)
    cx, cy = (trip_bbox[0] + trip_bbox[2]) / 2, (trip_bbox[1] + trip_bbox[3]) / 2
    kx = math.cos(math.radians(cy))
    w, h = w * 0.85, h * 0.85  # half-sizes, with margin
    if w * kx / h < aspect:
        w = h * aspect / kx
    else:
        h = w * kx / aspect
    b = (cx - w, cy - h, cx + w, cy + h)
    frame = box(*b)
    geo.countries
    geoms = [c.intersection(frame) for c in (geo.countries[int(i)] for i in geo._ctree.query(frame))]
    return mode, [g for g in geoms if not g.is_empty], b


STAR = "#FFC93C"
PIN = "#E8553E"
NAVY = "#0B2238"


def star_pts(cx, cy, r):
    out = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.45
        out.append(f"{cx + rr * math.cos(a):.1f},{cy + rr * math.sin(a):.1f}")
    return " ".join(out)


def pin_svg(x, y, h):
    r = h * 0.31
    cy = y - h + r
    d = (f"M{x:.1f},{y:.1f} C{x - r * 0.35:.1f},{y - h * 0.3:.1f} {x - r:.1f},{cy + r * 0.55:.1f} "
         f"{x - r:.1f},{cy:.1f} A{r:.1f},{r:.1f} 0 1 1 {x + r:.1f},{cy:.1f} "
         f"C{x + r:.1f},{cy + r * 0.55:.1f} {x + r * 0.35:.1f},{y - h * 0.3:.1f} {x:.1f},{y:.1f} Z")
    return (f'<g filter="url(#soft)"><path d="{d}" fill="{PIN}" stroke="#FFFFFF" stroke-width="{h * 0.06:.1f}"/>'
            f'<circle cx="{x:.1f}" cy="{cy:.1f}" r="{r * 0.38:.1f}" fill="#FFFFFF"/></g>')


def badge_svg(x, y, r, kind, angle=0):
    if kind == "boat":
        glyph = f'''<path d="M-36,4 L36,4 L26,22 L-26,22 Z"/>
    <rect x="-20" y="-12" width="30" height="16" rx="2"/>
    <rect x="-14" y="-8" width="6" height="6" fill="#FFFFFF"/>
    <rect x="-2" y="-8" width="6" height="6" fill="#FFFFFF"/>
    <rect x="14" y="-26" width="9" height="30" rx="2" fill="{PIN}"/>
    <path d="M-38,32 q9.5,-8 19,0 t19,0 t19,0 t19,0" fill="none" stroke="{NAVY}" stroke-width="5" stroke-linecap="round"/>'''
    elif kind == "train":
        glyph = f'''<rect x="-25" y="-36" width="50" height="54" rx="13"/>
    <rect x="-17" y="-26" width="34" height="18" rx="3" fill="#FFFFFF"/>
    <circle cx="-12" cy="6" r="4.5" fill="#FFFFFF"/>
    <circle cx="12" cy="6" r="4.5" fill="#FFFFFF"/>
    <path d="M-13,20 L-23,34 M13,20 L23,34 M-31,34 L31,34" fill="none" stroke="{NAVY}" stroke-width="6" stroke-linecap="round"/>'''
    else:
        glyph = (f'<path transform="rotate({angle:.1f})" d="M0,-34 C5,-34 6,-29 6,-22 L6,-8 L36,8 L36,15 L6,6 '
                 f'L6,22 L15,29 L15,34 L0,30 L-15,34 L-15,29 L-6,22 L-6,6 L-36,15 L-36,8 L-6,-8 L-6,-22 '
                 f'C-6,-29 -5,-34 0,-34 Z"/>')
    return (f'<g transform="translate({x:.1f},{y:.1f})" filter="url(#soft)"><circle r="{r:.1f}" fill="#FFFFFF"/>'
            f'<g fill="{NAVY}" transform="scale({r / 58:.3f})">{glyph}</g></g>')


def text_w(name, size, upper):
    return len(name) * size * (0.80 if upper else 0.53)


class Labeler:
    SIDES = ["e", "w", "n", "s", "ne", "se", "nw", "sw"]

    def __init__(self, w, h, route_pts):
        self.w, self.h = w, h
        self.boxes = []
        self.route = route_pts

    def block(self, b):
        self.boxes.append(b)

    def place(self, name, cx, cy, m, size, upper, side):
        tw = text_w(name, size, upper)
        g = size * 0.35

        def cand(sd):
            dx = {"e": 1, "w": -1, "n": 0, "s": 0, "ne": 0.75, "se": 0.75, "nw": -0.75, "sw": -0.75}[sd]
            dy = {"e": 0, "w": 0, "n": -1, "s": 1, "ne": -0.75, "se": 0.75, "nw": -0.75, "sw": 0.75}[sd]
            ax, ay = cx + dx * (m + g), cy + dy * (m + g)
            x0 = ax if dx > 0 else (ax - tw if dx < 0 else ax - tw / 2)
            if dy < 0:
                y0 = ay - size * 0.95
            elif dy > 0:
                y0 = ay
            else:
                y0 = ay - size * 0.5
            return (x0, y0, x0 + tw, y0 + size * 0.95)

        def cost(b, i):
            c = i * 0.5
            for o in self.boxes:
                ix = max(0, min(b[2], o[2]) - max(b[0], o[0]))
                iy = max(0, min(b[3], o[3]) - max(b[1], o[1]))
                c += ix * iy / (size * size) * 40
            c += sum(1 for x, y in self.route if b[0] <= x <= b[2] and b[1] <= y <= b[3]) * 0.6
            if b[0] < 0 or b[1] < 0 or b[2] > self.w or b[3] > self.h:
                c += 1000
            return c

        sides = [side] if side in self.SIDES else self.SIDES
        b = min((cand(sd) for sd in sides), key=lambda bb, it=iter(range(len(sides))): cost(bb, next(it)))
        self.boxes.append(b)
        anchor_x = b[0]
        weight = 700 if upper else 600
        spacing = size * (0.12 if upper else 0.02)
        text = name.upper() if upper else name
        return (f'<text x="{anchor_x:.1f}" y="{b[1] + size * 0.75:.1f}" font-size="{size:.0f}" '
                f'font-weight="{weight}" letter-spacing="{spacing:.1f}" filter="url(#txt)">'
                f'{text.replace("&", "&amp;").replace("<", "&lt;")}</text>')


def build_svg(trip, W, H, with_day_trips, geo):
    u = max(W, H) / 4000
    stops = {s["name"]: s for s in trip["stops"]}

    def resolve(v):
        if isinstance(v, str):
            if v not in stops:
                sys.exit(f"leg via '{v}' is not a stop name. Stops: {', '.join(stops)}")
            return tuple(stops[v]["at"])
        return (float(v[0]), float(v[1]))

    legs = [l for l in trip["legs"] if with_day_trips or not l.get("day_trip")]
    all_ll = [resolve(v) for l in trip["legs"] for v in l["via"]] + \
        [tuple(s["at"]) for s in trip["stops"] if s.get("kind", "minor") != "hidden"]
    mode, land, bbox = pick_basemap(geo, trip.get("basemap", "auto"), all_ll, W / H)
    P = Canvas(W, H, bbox)

    lw = 15 * u
    parts_ = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<defs>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="{9 * u:.1f}"/></filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
    <feDropShadow dx="0" dy="{6 * u:.1f}" stdDeviation="{8 * u:.1f}" flood-color="{NAVY}" flood-opacity="0.55"/></filter>
  <filter id="txt" x="-20%" y="-50%" width="140%" height="200%">
    <feDropShadow dx="0" dy="{3 * u:.1f}" stdDeviation="{7 * u:.1f}" flood-color="{NAVY}" flood-opacity="0.85"/></filter>
  <filter id="fadeblur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="{170 * u:.1f}"/></filter>
  <mask id="fade" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">
    <rect x="{P(bbox[3], bbox[0])[0] + 380 * u:.1f}" y="{P(bbox[3], bbox[0])[1] + 380 * u:.1f}"
          width="{(P(bbox[1], bbox[2])[0] - P(bbox[3], bbox[0])[0]) - 760 * u:.1f}"
          height="{(P(bbox[1], bbox[2])[1] - P(bbox[3], bbox[0])[1]) - 760 * u:.1f}"
          rx="{120 * u:.1f}" fill="#FFFFFF" filter="url(#fadeblur)"/></mask>
</defs>
<g font-family="Avenir Next, Avenir, Helvetica Neue, sans-serif" fill="#FFFFFF">''']

    # land
    mask = ' mask="url(#fade)"' if mode == "region" else ""
    land_d = " ".join(poly_d(P.geom(g, 1.0 * u)) for g in land)
    parts_.append(f'<g{mask}><path d="{land_d}" fill="{NAVY}" fill-opacity="0.45" fill-rule="evenodd" stroke="#FFFFFF" '
                  f'stroke-opacity="0.9" stroke-width="{6 * u:.1f}" stroke-linejoin="round" filter="url(#soft)"/></g>')

    # route geometry
    roads, ferries, boats, trains, flights, route_pts = [], [], [], [], [], []
    train_legs = [l for l in legs if l.get("mode") == "train"]
    stations = OSM().stations([resolve(v) for l in train_legs for v in l["via"] if isinstance(v, str)], 5) \
        if train_legs else None
    for l in legs:
        ll = [resolve(v) for v in l["via"]]
        m = l.get("mode", "drive")
        if m == "drive":
            for pm, pts in osrm(ll):
                xy = thin([P(*p) for p in pts], 1.5 * u)
                (ferries if pm == "ferry" else roads).append(xy)
        elif m == "boat":
            path = [ll[0]]
            for a, b in zip(ll, ll[1:]):
                path += sea_route(geo, a, b)[1:]
            boats.append([P(*p) for p in path])
        elif m == "train":
            path, on_rails = train_route(ll, [isinstance(v, str) for v in l["via"]], stations)
            xy = [P(*p) for p in path]
            trains.append((thin(xy, 1.5 * u) if on_rails else xy, on_rails))
        elif m == "flight":
            for a, b in zip(ll, ll[1:]):
                flights.append((P(*a), P(*b)))
        else:
            sys.exit(f"unknown leg mode '{m}' (use drive, train, boat or flight)")
    for group in (roads, ferries, boats, [xy for xy, _ in trains]):
        for xy in group:
            route_pts += thin(xy, 20 * u)

    attrs = 'fill="none" stroke-linecap="round" stroke-linejoin="round"'
    shadow = f'stroke="{NAVY}" stroke-opacity="0.55" filter="url(#shadow)"'
    arcs = []
    for (ax, ay), (bx, by) in flights:
        mx, my = (ax + bx) / 2, (ay + by) / 2
        dx, dy = bx - ax, by - ay
        nx, ny = -dy * 0.18, dx * 0.18
        if ny > 0:  # bow upward
            nx, ny = -nx, -ny
        c = (mx + nx, my + ny)
        arcs.append(((ax, ay), c, (bx, by)))
        route_pts += [(ax + (bx - ax) * t + 2 * (1 - t) * t * nx * 2, ay + (by - ay) * t + 2 * (1 - t) * t * ny * 2)
                      for t in (i / 20 for i in range(21))]
    arc_d = [f"M{a[0]:.1f},{a[1]:.1f} Q{c[0]:.1f},{c[1]:.1f} {b[0]:.1f},{b[1]:.1f}" for a, c, b in arcs]
    boat_d = [smooth_d(b) for b in boats]
    train_d = [line_d(xy) if on_rails else smooth_d(xy) for xy, on_rails in trains]
    dash = f'stroke-dasharray="{36 * u:.1f} {30 * u:.1f}"'
    dots = f'stroke-dasharray="{1 * u:.1f} {34 * u:.1f}"'
    ties = f'stroke-width="{lw * 1.9:.1f}" stroke-dasharray="{5 * u:.1f} {25 * u:.1f}" stroke-linecap="butt"'

    parts_.append(f'<g {attrs} {shadow} stroke-width="{lw + 14 * u:.1f}">')
    parts_ += [f'<path d="{line_d(r)}"/>' for r in roads]
    parts_ += [f'<path d="{d}"/>' for d in train_d]
    parts_ += [f'<path d="{d}" {dash}/>' for d in boat_d + arc_d]
    parts_.append("</g>")
    parts_.append(f'<g {attrs} stroke="#FFFFFF" stroke-width="{lw:.1f}">')
    parts_ += [f'<path d="{line_d(r)}"/>' for r in roads]
    parts_ += [f'<path d="{line_d(r)}" {dots}/>' for r in ferries]
    parts_ += [f'<path d="{d}" {ties}/><path d="{d}" stroke-width="{lw * 0.6:.1f}"/>' for d in train_d]
    parts_ += [f'<path d="{d}" {dash}/>' for d in boat_d + arc_d]
    parts_.append("</g>")

    labeler = Labeler(W, H, route_pts)
    icons, icon_at = [], []
    badged = []  # train lines already carrying a badge: legs sharing a line get one between them
    for kind, paths in (("boat", boats), ("train", [xy for xy, _ in trains])):
        for b in paths:
            (x, y), length = midpoint(b)
            if kind == "train" and any(math.dist((x, y), q) < 40 * u for q in badged):
                continue
            if length > 140 * u and all(math.dist((x, y), q) > 260 * u for q in icon_at):
                icon_at.append((x, y))
                icons.append(badge_svg(x, y, 58 * u, kind))
                labeler.block((x - 60 * u, y - 60 * u, x + 60 * u, y + 60 * u))
                if kind == "train":
                    badged += thin(b, 10 * u)
    for a, c, b in arcs:
        x, y = 0.25 * a[0] + 0.5 * c[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * c[1] + 0.25 * b[1]
        ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) + 90
        icons.append(badge_svg(x, y, 58 * u, "plane", ang))
        labeler.block((x - 60 * u, y - 60 * u, x + 60 * u, y + 60 * u))
    parts_ += icons

    # markers: only stops on a visible leg (or referenced by none at all)
    on_legs = {v for l in trip["legs"] for v in l["via"] if isinstance(v, str)}
    visible = {v for l in legs for v in l["via"] if isinstance(v, str)}
    shown = [s for s in trip["stops"] if s.get("kind", "minor") != "hidden"
             and (s["name"] in visible or s["name"] not in on_legs)]
    majors = [s for s in shown if s.get("kind") == "major"]
    minors = [s for s in shown if s.get("kind") != "major"]
    pin_h = 118 * u
    for s in majors:
        x, y = P(*s["at"])
        labeler.block((x - pin_h * 0.31, y - pin_h, x + pin_h * 0.31, y))
    for s in minors:
        x, y = P(*s["at"])
        labeler.block((x - 46 * u, y - 46 * u, x + 46 * u, y + 46 * u))
    labels = []
    for s in majors:
        x, y = P(*s["at"])
        parts_.append(pin_svg(x, y, pin_h))
        if s.get("label", "auto") != "none":
            labels.append(labeler.place(s["name"], x, y - pin_h * 0.55, pin_h * 0.5, 78 * u, True, s.get("label", "auto")))
    for s in minors:
        x, y = P(*s["at"])
        parts_.append(f'<polygon points="{star_pts(x, y, 46 * u)}" fill="{STAR}" stroke="#8A4B12" '
                      f'stroke-width="{4 * u:.1f}" stroke-linejoin="round" filter="url(#soft)"/>')
        if s.get("label", "auto") != "none":
            labels.append(labeler.place(s["name"], x, y, 46 * u, 50 * u, False, s.get("label", "auto")))
    parts_ += labels
    parts_.append("</g></svg>")
    return "\n".join(parts_), mode


def find_chrome():
    """The Chrome binary to rasterize with: $TRIPMAP_CHROME if set (it must exist), else the
    macOS app, else the first of CHROME_NAMES on PATH. Exits with a clear message if none."""
    env = os.environ.get("TRIPMAP_CHROME")
    if env:
        if Path(env).is_file() and os.access(env, os.X_OK):
            return env
        sys.exit(f"TRIPMAP_CHROME is set to {env!r}, which is not an executable file")
    if Path(CHROME_APP).exists():
        return CHROME_APP
    for name in CHROME_NAMES:
        found = shutil.which(name)
        if found:
            return found
    sys.exit("Rendering needs Google Chrome or Chromium. Install it, or set TRIPMAP_CHROME "
             "to the path of its executable (for example /usr/bin/chromium).")


def screenshot(svg, png, W, H):
    chrome = find_chrome()
    html = Path(tempfile.mkdtemp(prefix="tripmap-")) / "map.html"
    html.write_text('<html><body style="margin:0;background:transparent">' + svg + "</body></html>")
    try:
        subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        f"--window-size={W},{H}", "--force-device-scale-factor=1",
                        "--default-background-color=00000000", f"--screenshot={Path(png).resolve()}",
                        html.as_uri()], check=True, capture_output=True, timeout=180)
    finally:
        shutil.rmtree(html.parent, ignore_errors=True)


def cmd_render(args):
    trip = yaml.safe_load(open(args.trip))
    for k in ("stops", "legs"):
        if not trip.get(k):
            sys.exit(f"{args.trip} has no {k}")
    for s in trip["stops"]:
        s["name"] = str(s["name"])
    for l in trip["legs"]:
        l["via"] = [str(v) if not isinstance(v, list) else v for v in l["via"]]
    out = Path(args.out or Path(args.trip).parent)
    out.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", Path(args.trip).stem.lower()).strip("-") or "trip"

    W = H = args.size
    if args.photo:
        dims = subprocess.run(["magick", "identify", "-format", "%w %h", f"{args.photo}[0]"],
                              capture_output=True, text=True, check=True).stdout.split()
        pw, ph = int(dims[0]), int(dims[1])
        W, H = (args.size, round(args.size * ph / pw)) if pw >= ph else (round(args.size * pw / ph), args.size)

    geo = Geo()
    variants = [(False, f"{slug}.png")]
    if any(l.get("day_trip") for l in trip["legs"]):
        variants.append((True, f"{slug}-with-day-trips.png"))
    for with_dt, name in variants:
        svg, mode = build_svg(trip, W, H, with_dt, geo)
        png = out / name
        screenshot(svg, png, W, H)
        print(f"{png}  ({W}x{H}, transparent, basemap: {mode})")
        if args.photo:
            prev = out / name.replace(".png", "-preview.jpg")
            subprocess.run(["magick", f"{args.photo}[0]", "-auto-orient", "(", str(png), "-resize", f"{pw}x{ph}!", ")",
                            "-composite", "-resize", "1600x1600>", "-quality", "88", str(prev)], check=True)
            print(f"{prev}  (preview on your photo)")


def main():
    ap = argparse.ArgumentParser(prog="tripmap", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--library", default=str(LIBRARY), help="Photos library path")
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("trips", help="list trips found in your Photos library")
    t.add_argument("--since", help="only trips after this date (YYYY-MM-DD)")
    t.add_argument("--away-km", type=float, default=150, help="distance from home that counts as away")
    t.add_argument("--min-photos", type=int, default=30)
    d = sub.add_parser("draft", help="detect a trip's route from photo GPS and write an editable YAML")
    d.add_argument("--from", dest="start", required=True, help="first day, YYYY-MM-DD")
    d.add_argument("--to", dest="end", required=True, help="last day, YYYY-MM-DD")
    d.add_argument("-o", "--output", default="trip.yaml")
    d.add_argument("--title")
    r = sub.add_parser("render", help="draw a trip YAML as transparent PNG overlay(s)")
    r.add_argument("trip")
    r.add_argument("--photo", help="background photo: matches its shape and writes a preview")
    r.add_argument("--out", help="output folder (default: next to the YAML)")
    r.add_argument("--size", type=int, default=4000, help="long side in pixels")
    args = ap.parse_args()
    {"trips": cmd_trips, "draft": cmd_draft, "render": cmd_render}[args.cmd](args)


if __name__ == "__main__":
    main()
