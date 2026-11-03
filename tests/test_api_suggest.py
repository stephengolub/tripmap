import pytest
from fastapi.testclient import TestClient

import tripmap
from tripmap_api import routes
from tripmap_api.app import create_app


class FakeGeo:
    """One landmass, everything on land; coast_km is fixed per test."""

    def __init__(self, coast_km=100.0):
        self._coast = coast_km

    def classify(self, lat, lon):
        return 0, False

    def classify_strict(self, lat, lon):
        return 0

    def coast_km(self, lat, lon):
        return self._coast


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(routes, "_geo", lambda: FakeGeo())
    monkeypatch.setattr(tripmap, "rail", lambda coords: None)
    monkeypatch.setattr(tripmap, "drivable", lambda a, b: True)
    return TestClient(create_app())


def suggest(client, a, b, **extra):
    r = client.post("/api/legs/suggest-mode", json={"from": a, "to": b, **extra})
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["reason"], str) and body["reason"].strip()
    return body


def test_long_hop_is_a_flight(client):
    a, b = [53.35, -6.26], [45.76, 4.84]  # Dublin to Lyon, ~1,150 km
    assert tripmap.km(a, b) > 900
    body = suggest(client, a, b)
    assert body["mode"] == "flight"
    assert "km" in body["reason"]


def test_short_coastal_pair_is_not_a_flight(client, monkeypatch):
    monkeypatch.setattr(routes, "_geo", lambda: FakeGeo(coast_km=1.0))
    monkeypatch.setattr(tripmap, "drivable", lambda a, b: False)
    body = suggest(client, [53.14, -9.79], [53.10, -9.66])  # Doolin to Inis Oírr, ~10 km
    assert body["mode"] != "flight"


def test_short_land_hop_is_a_drive(client):
    body = suggest(client, [53.35, -6.26], [53.35, -7.16])
    assert body["mode"] == "drive"


def test_elapsed_hours_feeds_the_speed_rule(client):
    a, b = [53.35, -6.26], [51.50, -0.12]  # Dublin to London, ~460 km
    assert suggest(client, a, b)["mode"] == "drive"
    body = suggest(client, a, b, elapsed_hours=1.0)
    assert body["mode"] == "flight"
    assert "km/h" in body["reason"]


def test_bad_point_is_422(client):
    r = client.post("/api/legs/suggest-mode", json={"from": [1.0], "to": [2.0, 3.0]})
    assert r.status_code == 422


def test_geo_and_stations_are_loaded_once(monkeypatch):
    calls = []
    monkeypatch.setattr(tripmap, "Geo", lambda: calls.append(1) or FakeGeo())
    routes._geo.cache_clear()
    try:
        assert routes._geo() is routes._geo()
        assert calls == [1]
        assert routes._stations() is routes._stations()
        assert routes._stations().pts == []
    finally:
        routes._geo.cache_clear()
