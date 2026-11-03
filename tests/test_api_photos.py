"""GET /api/photos/status against a synthetic library, never the real one."""
import os
import sqlite3

import pytest
from fastapi.testclient import TestClient

import tripmap
from tripmap_api import photos
from tripmap_api.app import create_app


def make_library(root, rows):
    """A library dir with database/Photos.sqlite holding the tables load_photos reads."""
    db = root / "Lib.photoslibrary" / "database" / "Photos.sqlite"
    db.parent.mkdir(parents=True)
    con = sqlite3.connect(db)
    con.execute("""CREATE TABLE ZASSET (Z_PK INTEGER PRIMARY KEY, ZDATECREATED REAL,
                   ZLATITUDE REAL, ZLONGITUDE REAL, ZTRASHEDSTATE INTEGER,
                   ZADDITIONALATTRIBUTES INTEGER)""")
    con.execute("""CREATE TABLE ZADDITIONALASSETATTRIBUTES (Z_PK INTEGER PRIMARY KEY,
                   ZTIMEZONEOFFSET INTEGER, ZREVERSELOCATIONDATA BLOB)""")
    for i, (lat, lon, trashed) in enumerate(rows, 1):
        con.execute("INSERT INTO ZADDITIONALASSETATTRIBUTES VALUES (?, 0, NULL)", (i,))
        con.execute("INSERT INTO ZASSET VALUES (?, 7e8, ?, ?, ?, ?)", (i, lat, lon, trashed, i))
    con.commit()
    con.close()
    return db.parent.parent


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(tripmap, "LIBRARY", tmp_path / "missing.photoslibrary")
    return TestClient(create_app())


def test_ok_counts_geotagged_untrashed(client, monkeypatch, tmp_path):
    lib = make_library(tmp_path, [(53.3, -6.2, 0), (52.0, -9.5, 0), (None, None, 0),
                                  (51.9, -8.4, 1), (0, 0, 0), (-180, -180, 0)])
    monkeypatch.setattr(tripmap, "LIBRARY", lib)
    r = client.get("/api/photos/status")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "library": str(lib), "geotagged_assets": 2,
                        "reason": None, "message": None}
    assert "53.3" not in r.text and "-6.2" not in r.text


def test_not_found(client, tmp_path):
    body = client.get("/api/photos/status").json()
    assert body["ok"] is False and body["reason"] == "not_found"
    assert body["library"] == str(tmp_path / "missing.photoslibrary")


def test_unreadable_garbage_database(client, monkeypatch, tmp_path):
    lib = make_library(tmp_path, [])
    (lib / "database" / "Photos.sqlite").write_bytes(b"this is not sqlite " * 100)
    monkeypatch.setattr(tripmap, "LIBRARY", lib)
    body = client.get("/api/photos/status").json()
    assert body["ok"] is False and body["reason"] == "unreadable"


@pytest.mark.skipif(hasattr(os, "geteuid") and os.geteuid() == 0, reason="root ignores chmod")
def test_permission_denied_names_full_disk_access(client, monkeypatch, tmp_path):
    lib = make_library(tmp_path, [(53.3, -6.2, 0)])
    db = lib / "database" / "Photos.sqlite"
    os.chmod(db, 0)
    monkeypatch.setattr(tripmap, "LIBRARY", lib)
    try:
        body = client.get("/api/photos/status").json()
    finally:
        os.chmod(db, 0o644)
    assert body["ok"] is False and body["reason"] == "permission_denied"
    assert "Full Disk Access" in body["message"]
    assert "System Settings > Privacy & Security > Full Disk Access" in body["message"]


def test_temp_copy_is_removed(monkeypatch, tmp_path):
    made = []
    real = photos.tempfile.mkdtemp
    monkeypatch.setattr(photos.tempfile, "mkdtemp", lambda **kw: made.append(real(**kw)) or made[-1])
    photos.photos_status(make_library(tmp_path, [(53.3, -6.2, 0)]))
    assert made and not os.path.exists(made[0])


def test_library_env_override(tmp_path):
    """Checked in a fresh interpreter, since LIBRARY is read at import time."""
    import subprocess, sys
    lib = tmp_path / "Other.photoslibrary"
    out = subprocess.run([sys.executable, "-c", "import tripmap; print(tripmap.LIBRARY)"],
                         env={**os.environ, "TRIPMAP_LIBRARY": str(lib)},
                         capture_output=True, text=True, check=True)
    assert out.stdout.strip() == str(lib)
