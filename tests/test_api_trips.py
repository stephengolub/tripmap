"""POST /api/trips/draft, /yaml and /import, with build_trip stubbed out."""
import datetime as dt

import pytest
import yaml
from fastapi.testclient import TestClient

import tripmap
from tripmap_api.app import create_app

TRIP = {"title": "Test trip", "basemap": "auto",
        "stops": [{"name": "Town A", "kind": "major", "at": [53.35, -6.26], "label": "auto", "nights": 2},
                  {"name": "Town B", "kind": "major", "at": [52.06, -9.51], "label": "auto", "nights": 1}],
        "legs": [{"date": "2026-01-12", "mode": "drive", "day_trip": False, "via": ["Town A", "Town B"],
                  "enabled": True},
                 {"date": "2026-01-13", "mode": "flight", "day_trip": False, "via": ["Town B", [51.4, -0.4]],
                  "enabled": False}]}
STATS = {"photo_count": 42, "overnight_names": ["Town A", "Town B"], "quick_names": [],
         "hidden_names": [], "leg_counts": {"drive": 1}}


@pytest.fixture
def client(monkeypatch):
    calls = []

    def fake_build_trip(library, start, end, title=None):
        calls.append((start, end, title))
        if start == dt.date(2020, 1, 1):
            raise tripmap.TripError("Only 0 geotagged photos between 2020-01-01 and 2020-01-02.")
        return TRIP, STATS

    monkeypatch.setattr(tripmap, "build_trip", fake_build_trip)
    c = TestClient(create_app())
    c.calls = calls
    return c


def test_draft_shape(client):
    r = client.post("/api/trips/draft", json={"start": "2026-01-10", "end": "2026-01-13", "title": "Hi"})
    assert r.status_code == 200
    assert r.json() == {"trip": TRIP, "stats": STATS}
    assert client.calls == [(dt.date(2026, 1, 10), dt.date(2026, 1, 13), "Hi")]


def test_draft_end_before_start(client):
    r = client.post("/api/trips/draft", json={"start": "2026-01-10", "end": "2026-01-09"})
    assert r.status_code == 422
    assert not client.calls


def test_draft_span_over_60_days(client):
    r = client.post("/api/trips/draft", json={"start": "2026-01-01", "end": "2026-03-03"})
    assert r.status_code == 422
    assert client.post("/api/trips/draft", json={"start": "2026-01-01", "end": "2026-03-02"}).status_code == 200


def test_draft_too_few_photos_is_404(client):
    r = client.post("/api/trips/draft", json={"start": "2020-01-01", "end": "2020-01-02"})
    assert r.status_code == 404
    assert "Only 0 geotagged photos" in r.json()["detail"]


def test_yaml_export_comments_out_disabled_legs(client):
    r = client.post("/api/trips/yaml", json={"trip": TRIP})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/yaml")
    assert "  - {date: 2026-01-12, mode: drive" in r.text
    assert "  # - {date: 2026-01-13, mode: flight" in r.text
    assert yaml.safe_load(r.text)["title"] == "Test trip"


def test_yaml_export_rejects_incomplete_trip(client):
    assert client.post("/api/trips/yaml", json={"trip": {"title": "x"}}).status_code == 422


def test_import_fills_enabled(client):
    text = tripmap.dump_trip_yaml(TRIP)
    r = client.post("/api/trips/import", content=text, headers={"Content-Type": "text/plain"})
    assert r.status_code == 200
    trip = r.json()["trip"]
    assert [l["enabled"] for l in trip["legs"]] == [True]  # the commented-out leg is a comment
    assert trip["legs"][0]["date"] == "2026-01-12"
    assert trip["stops"][0]["name"] == "Town A"


def test_import_keeps_explicit_enabled(client):
    text = "stops: [{name: A, at: [1, 2]}]\nlegs: [{date: 2026-01-12, via: [A], enabled: false}]\n"
    r = client.post("/api/trips/import", content=text, headers={"Content-Type": "text/plain"})
    assert r.json()["trip"]["legs"][0]["enabled"] is False


@pytest.mark.parametrize("text", ["title: x\n", "stops: []\nlegs: [{via: []}]\n",
                                  "stops: [{name: A}]\nlegs: []\n", "- just a list\n", "a: [unclosed\n"])
def test_import_rejects_missing_stops_or_legs(client, text):
    r = client.post("/api/trips/import", content=text, headers={"Content-Type": "text/plain"})
    assert r.status_code == 422
