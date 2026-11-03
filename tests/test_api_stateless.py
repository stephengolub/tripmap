"""The API keeps no state: each request stands on its own body, and the app stores nothing."""
import struct
import zlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

import tripmap
from tripmap_api.app import create_app

TRIP = {"title": "Test trip", "basemap": "auto",
        "stops": [{"name": "Town A", "kind": "major", "at": [53.35, -6.26], "label": "auto"},
                  {"name": "Town B", "kind": "major", "at": [52.06, -9.51], "label": "auto"}],
        "legs": [{"date": "2026-01-12", "mode": "drive", "day_trip": False, "via": ["Town A", "Town B"],
                  "enabled": True}]}


def _png(w, h):
    """A real, blank w x h greyscale PNG."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    raw = b"".join(b"\x00" + bytes(w) for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def _dims(png):
    return struct.unpack(">II", png[16:24])


def test_two_renders_are_independent(monkeypatch):
    def fake_render_png(trip, size=4000, photo_size=None, with_day_trips=False, geo=None):
        return _png(*tripmap.canvas_size(size, photo_size))

    monkeypatch.setattr(tripmap, "render_png", fake_render_png)
    client = TestClient(create_app())
    a = client.post("/api/trips/render", json={"trip": TRIP, "size": 400})
    b = client.post("/api/trips/render", json={"trip": TRIP, "size": 800,
                                               "photo_size": {"width": 3000, "height": 2000}})
    assert a.status_code == b.status_code == 200
    assert _dims(a.content) == (400, 400)
    assert _dims(b.content) == (800, 533)
    # Repeating the first request gives the first answer again: nothing carried over from the second.
    again = client.post("/api/trips/render", json={"trip": TRIP, "size": 400})
    assert again.content == a.content


def test_app_state_is_empty():
    assert vars(create_app().state) == vars(FastAPI().state)


def test_app_state_stays_empty_after_requests(monkeypatch):
    monkeypatch.setattr(tripmap, "render_png", lambda trip, size=4000, **k: _png(size, size))
    app = create_app()
    client = TestClient(app)
    client.post("/api/trips/render", json={"trip": TRIP, "size": 300})
    client.post("/api/trips/yaml", json={"trip": TRIP})
    assert vars(app.state) == vars(FastAPI().state)
