"""Network-facing code with the HTTP layer stubbed out. Nothing here touches the internet."""
import io
import urllib.error

import pytest

import tripmap as tm
from conftest import fake_response


# ---- Stations

def test_stations_nearest_respects_max_km():
    st = tm.Stations([(44.5058, 11.3433, False)])
    assert st.nearest((44.5058, 11.3433), 0.4) == (44.5058, 11.3433)
    assert st.nearest((44.60, 11.3433), 0.4) is None
    assert tm.Stations([]).nearest((0, 0), 5) is None


def test_stations_nearest_prefers_a_main_station_to_a_halt_just_as_close():
    main = (44.5000, 11.3400, False)
    halt = (44.5001, 11.3400, True)  # 11 m away, but a halt counts 800 m further
    assert tm.Stations([halt, main]).nearest((44.5, 11.34), 5) == (44.5000, 11.3400)


# ---- rail routing (BRouter)

def brouter_ok(points):
    return {"type": "FeatureCollection", "features": [{
        "type": "Feature", "properties": {"track-length": "1000"},
        # BRouter returns GeoJSON order: [lon, lat, elevation]
        "geometry": {"type": "LineString", "coordinates": [[lon, lat, 0] for lat, lon in points]}}]}


def test_rail_returns_lat_lon_pairs_in_order(cache, monkeypatch):
    pts = [(44.5058, 11.3433), (43.7775, 11.2474)]
    monkeypatch.setattr(tm.urllib.request, "urlopen", lambda req, timeout=None: fake_response(brouter_ok(pts)))
    assert tm.rail(pts) == pts


def test_rail_caches_results_and_skips_the_network_next_time(cache, monkeypatch):
    calls = []
    pts = [(44.5, 11.3), (43.7, 11.2)]

    def fake(req, timeout=None):
        calls.append(req.full_url)
        return fake_response(brouter_ok(pts))

    monkeypatch.setattr(tm.urllib.request, "urlopen", fake)
    tm.rail(pts)
    assert tm.rail(pts) == pts
    assert len(calls) == 1


def test_rail_no_track_is_cached_as_a_real_answer(cache, monkeypatch):
    pts = [(41.9, 12.5), (0.0, 0.0)]
    calls = []

    def fake(req, timeout=None):
        calls.append(1)
        raise urllib.error.HTTPError(req.full_url, 500, "err", {}, io.BytesIO(b"no track found at pass=0\n"))

    monkeypatch.setattr(tm.urllib.request, "urlopen", fake)
    assert tm.rail(pts) is None
    assert tm.rail(pts) is None
    assert len(calls) == 1  # "no track" is an answer, so it is not retried


def test_rail_network_error_is_not_cached(cache, monkeypatch):
    pts = [(41.9, 12.5), (43.7, 11.2)]
    state = {"fail": True}

    def fake(req, timeout=None):
        if state["fail"]:
            raise OSError("connection reset")
        return fake_response(brouter_ok(pts))

    monkeypatch.setattr(tm.urllib.request, "urlopen", fake)
    assert tm.rail(pts) is None
    state["fail"] = False
    assert tm.rail(pts) == pts  # a later run gets a real answer


def test_rail_other_http_errors_are_not_mistaken_for_no_track(cache, monkeypatch):
    def fake(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 503, "busy", {}, io.BytesIO(b"server busy"))

    monkeypatch.setattr(tm.urllib.request, "urlopen", fake)
    assert tm.rail([(1, 1), (2, 2)]) is None
    assert not (cache / "rail").exists() or not list((cache / "rail").iterdir())


# ---- train_route

@pytest.fixture
def stations():
    # Bologna Centrale and Firenze SMN, roughly where they are
    return tm.Stations([(44.5058, 11.3433, False), (43.7775, 11.2474, False)])


def test_train_route_snaps_named_stops_to_stations(monkeypatch, stations):
    seen = []

    def fake_rail(coords):
        seen.append(coords)
        return [coords[0], (44.0, 11.3), coords[-1]]

    monkeypatch.setattr(tm, "rail", fake_rail)
    path, on_rails = tm.train_route([(44.4938, 11.3426), (43.7698, 11.2556)], [True, True], stations)
    assert on_rails is True
    assert seen[0] == [(44.5058, 11.3433), (43.7775, 11.2474)]
    assert path[0] == (44.4938, 11.3426) and path[-1] == (43.7698, 11.2556)


def test_train_route_retries_with_only_named_stops_when_hints_do_not_route(monkeypatch, stations):
    attempts = []

    def fake_rail(coords):
        attempts.append(list(coords))
        if len(coords) > 2:
            return None  # a photo-hint in the middle has no track nearby
        return list(coords)

    monkeypatch.setattr(tm, "rail", fake_rail)
    hint = (43.0, 12.0)
    path, on_rails = tm.train_route([(44.49, 11.34), hint, (43.77, 11.25)], [True, False, True], stations)
    assert on_rails is True
    assert len(attempts) == 2
    assert attempts[1] == [(44.5058, 11.3433), (43.7775, 11.2474)]
    assert hint not in path


def test_train_route_falls_back_to_a_smooth_line(monkeypatch, stations, capsys):
    monkeypatch.setattr(tm, "rail", lambda coords: None)
    ll = [(44.49, 11.34), (43.77, 11.25)]
    path, on_rails = tm.train_route(ll, [True, True], stations)
    assert on_rails is False
    assert path == ll
    assert "smooth line" in capsys.readouterr().err


# ---- Overpass cache (OSM._overpass / stations)

def test_overpass_results_are_cached_per_query(cache, monkeypatch):
    payload = {"elements": [{"type": "node", "lat": 44.5, "lon": 11.3, "tags": {"railway": "station"}}]}
    calls = []

    def fake(req, timeout=None):
        calls.append(1)
        return fake_response(payload)

    monkeypatch.setattr(tm.urllib.request, "urlopen", fake)
    osm = tm.OSM()
    assert osm.stations([(44.5, 11.3)]).pts == [(44.5, 11.3, False)]
    assert osm.stations([(44.5, 11.3)]).pts == [(44.5, 11.3, False)]
    assert len(calls) == 1


def test_overpass_halt_tag_is_kept(cache, monkeypatch):
    payload = {"elements": [{"type": "node", "lat": 43.8, "lon": 11.2, "tags": {"railway": "halt"}}]}
    monkeypatch.setattr(tm.urllib.request, "urlopen", lambda req, timeout=None: fake_response(payload))
    assert tm.OSM().stations([(43.8, 11.2)]).pts == [(43.8, 11.2, True)]


def test_overpass_remark_only_reply_is_an_error_and_not_cached(cache, monkeypatch):
    # Overpass reports timeouts as HTTP 200 with a "remark" and no elements
    def fake(req, timeout=None):
        return fake_response({"elements": [], "remark": "runtime error: timeout"})

    monkeypatch.setattr(tm.urllib.request, "urlopen", fake)
    osm = tm.OSM()
    assert osm.stations([(44.5, 11.3)]).pts == []
    assert "overpass:" not in str(osm.cache.keys())


def test_stations_with_no_spots_makes_no_request(cache, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("no request expected")

    monkeypatch.setattr(tm.urllib.request, "urlopen", boom)
    assert tm.OSM().stations([]).pts == []
