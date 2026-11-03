import io
import json

import pytest

import tripmap


@pytest.fixture
def cache(tmp_path, monkeypatch):
    """Point the on-disk cache at a temp dir and skip the politeness sleeps."""
    monkeypatch.setattr(tripmap, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(tripmap.time, "sleep", lambda s: None)
    return tmp_path / "cache"


def fake_response(payload):
    """What urllib.request.urlopen returns: something json.load can read."""
    return io.BytesIO(json.dumps(payload).encode())
