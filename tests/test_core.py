import datetime as dt

import pytest
import yaml

import tripmap as tm

TOWN_A = (53.35, -6.26)
TOWN_B = (52.06, -9.51)  # ~250 km from A
START, END = dt.date(2026, 1, 10), dt.date(2026, 1, 13)


def photo(day, hour, ll, jitter=0.0):
    local = dt.datetime.combine(day, dt.time(hour))
    ts = local.replace(tzinfo=dt.timezone.utc).timestamp()
    return (ts, local, ll[0] + jitter, ll[1] + jitter, None)


def three_nights():
    """Two nights in town A, a drive to town B, one night there."""
    d = [START + dt.timedelta(days=i) for i in range(4)]
    pts = []
    for h in range(9, 20):
        pts.append(photo(d[0], h, TOWN_A, 0.001 * (h % 3)))
        pts.append(photo(d[1], h, TOWN_A, 0.001 * (h % 2)))
    pts += [photo(d[2], h, TOWN_A) for h in (9, 10, 11)]
    pts += [photo(d[2], h, TOWN_B) for h in range(15, 20)]
    pts += [photo(d[3], h, TOWN_B) for h in (8, 9, 10)]
    return sorted(pts)


class FakeGeo:
    """Everything is inland on one landmass."""

    def classify(self, lat, lon):
        return 0, False

    def classify_strict(self, lat, lon):
        return 0

    def nearest(self, lat, lon):
        return 0

    def coast_km(self, lat, lon):
        return 100.0


@pytest.fixture
def offline(cache, monkeypatch):
    monkeypatch.setattr(tm, "Geo", FakeGeo)
    monkeypatch.setattr(tm.OSM, "town_centre", lambda self, name, cc, near: (round(near[0], 4), round(near[1], 4)))
    monkeypatch.setattr(tm.OSM, "stations", lambda self, spots, radius_km=3: tm.Stations([]))
    monkeypatch.setattr(tm.OSM, "landmarks", lambda self, spots: [None] * len(spots))
    monkeypatch.setattr(tm, "road_km", lambda lat, lon: None)
    # a road a little longer than the straight line, so every pair is drivable
    monkeypatch.setattr(tm, "osrm", lambda coords: [("drive", [coords[0], (coords[0][0] + 0.01, coords[0][1]),
                                                                coords[-1]])])
    monkeypatch.setattr(tm, "rail", lambda coords: None)


def test_build_trip_finds_the_overnights_and_the_drive(offline, monkeypatch):
    monkeypatch.setattr(tm, "load_photos", lambda library, t0=None, t1=None: three_nights())
    trip, stats = tm.build_trip("unused", START, END, "Test trip")

    assert trip["title"] == "Test trip"
    assert trip["basemap"] == "auto"
    majors = [s for s in trip["stops"] if s["kind"] == "major"]
    assert len(majors) == 2
    assert [s["nights"] for s in majors] == [2, 1]
    assert stats["overnight_names"] == [s["name"] for s in majors]
    assert stats["photo_count"] == len(three_nights())
    assert stats["leg_counts"] == {"drive": 1}
    (leg,) = trip["legs"]
    assert leg == dict(date="2026-01-12", mode="drive", day_trip=False,
                       via=[majors[0]["name"], majors[1]["name"]], enabled=True)


def test_dump_trip_yaml_round_trips(offline, monkeypatch):
    monkeypatch.setattr(tm, "load_photos", lambda library, t0=None, t1=None: three_nights())
    trip, _ = tm.build_trip("unused", START, END)
    loaded = yaml.safe_load(tm.dump_trip_yaml(trip))

    assert loaded["title"] == trip["title"]
    assert loaded["basemap"] == "auto"
    assert len(loaded["stops"]) == len(trip["stops"])
    for got, want in zip(loaded["stops"], trip["stops"]):
        assert (got["name"], got["kind"], got["label"]) == (want["name"], want["kind"], want["label"])
        assert got["at"] == pytest.approx(want["at"], abs=1e-4)
    assert len(loaded["legs"]) == len(trip["legs"])
    for got, want in zip(loaded["legs"], trip["legs"]):
        assert str(got["date"]) == want["date"]
        assert (got["mode"], got["day_trip"], got["via"]) == (want["mode"], want["day_trip"], want["via"])


def test_dump_trip_yaml_comments_out_disabled_legs():
    trip = dict(title="T", basemap="auto",
                stops=[dict(name="A", kind="major", at=[1.0, 2.0], label="auto", nights=1),
                       dict(name="B", kind="major", at=[1.5, 2.5], label="auto", nights=1)],
                legs=[dict(date="2026-01-01", mode="flight", day_trip=False, via=["A", "B"], enabled=False),
                      dict(date="2026-01-02", mode="drive", day_trip=False, via=["B", "A"])])
    text = tm.dump_trip_yaml(trip)
    assert "# - {date: 2026-01-01, mode: flight" in text
    assert "flights there and home are commented out" in text
    assert [l["mode"] for l in yaml.safe_load(text)["legs"]] == ["drive"]


@pytest.mark.parametrize("n", [0, 1])
def test_build_trip_needs_two_photos(offline, monkeypatch, n):
    monkeypatch.setattr(tm, "load_photos", lambda library, t0=None, t1=None: three_nights()[:n])
    with pytest.raises(tm.TripError, match=f"Only {n} geotagged photos"):
        tm.build_trip("unused", START, END)
