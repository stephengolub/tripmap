"""POST /api/trips/render, stubbed, plus one real render of examples/italy.yaml."""
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

import tripmap
from tripmap_api.app import create_app

PNG_SIG = b"\x89PNG\r\n\x1a\n"
TRIP = {"title": "Test trip", "basemap": "auto",
        "stops": [{"name": "Town A", "kind": "major", "at": [53.35, -6.26], "label": "auto"},
                  {"name": "Town B", "kind": "major", "at": [52.06, -9.51], "label": "auto"}],
        "legs": [{"date": "2026-01-12", "mode": "drive", "day_trip": False, "via": ["Town A", "Town B"],
                  "enabled": True}]}


@pytest.fixture
def client(monkeypatch):
    calls = []

    def fake_render_png(trip, size=4000, photo_size=None, with_day_trips=False, geo=None):
        calls.append((size, photo_size, with_day_trips))
        return PNG_SIG + b"fake"

    monkeypatch.setattr(tripmap, "render_png", fake_render_png)
    c = TestClient(create_app())
    c.calls = calls
    return c


def test_render_returns_png(client):
    r = client.post("/api/trips/render", json={"trip": TRIP})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content == PNG_SIG + b"fake"
    assert client.calls == [(1600, None, False)]


def test_render_passes_options(client):
    r = client.post("/api/trips/render", json={"trip": TRIP, "size": 800, "with_day_trips": True,
                                               "photo_size": {"width": 3000, "height": 2000}})
    assert r.status_code == 200
    assert client.calls == [(800, (3000, 2000), True)]


@pytest.mark.parametrize("size", [199, 6001])
def test_render_size_out_of_range(client, size):
    assert client.post("/api/trips/render", json={"trip": TRIP, "size": size}).status_code == 422
    assert not client.calls


@pytest.mark.parametrize("key", ["stops", "legs"])
def test_render_needs_stops_and_legs(client, key):
    for value in ([], None):
        trip = {**TRIP, key: value}
        assert client.post("/api/trips/render", json={"trip": trip}).status_code == 422
    assert not client.calls


def test_render_without_chrome_is_503(monkeypatch):
    """find_chrome() exits the CLI; in the server that must be an error response, not a crash."""
    def no_chrome(*a, **k):
        raise SystemExit("Chrome not found")
    monkeypatch.setattr(tripmap, "render_png", no_chrome)
    r = TestClient(create_app()).post("/api/trips/render", json={"trip": TRIP})
    assert r.status_code == 503
    assert "Chrome not found" in r.json()["detail"]


@pytest.mark.slow
def test_render_italy_for_real():
    """Real Chrome and the real basemap. Uses ~/.cache/tripmap for routes."""
    try:
        tripmap.find_chrome()
    except SystemExit:
        pytest.skip("Chrome is not installed")
    trip = yaml.safe_load((Path(__file__).parent.parent / "examples" / "italy.yaml").read_text())
    for s in trip["stops"]:
        s["name"] = str(s["name"])
    for leg in trip["legs"]:
        leg["date"] = str(leg["date"])
    r = TestClient(create_app()).post("/api/trips/render", json={"trip": trip, "size": 400})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == PNG_SIG
