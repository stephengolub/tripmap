import pytest

import tripmap as tm


class FakeGeo:
    """One landmass; coast_km is fixed per test."""

    def __init__(self, coast_km=100.0):
        self._coast = coast_km

    def classify_strict(self, lat, lon):
        return 0

    def coast_km(self, lat, lon):
        return self._coast


NO_STATIONS = tm.Stations([])


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setattr(tm, "rail", lambda coords: None)
    monkeypatch.setattr(tm, "drivable", lambda a, b: True)


def hop(a, b, geo=None):
    return tm.classify_hop(a, b, geo or FakeGeo(), NO_STATIONS, [])


def test_long_hop_is_a_flight():
    a = tm.Node("stop", 53.35, -6.26)  # Dublin
    b = tm.Node("stop", 45.76, 4.84)   # Lyon, ~1,150 km
    assert tm.km(a.ll, b.ll) > 900
    assert hop(a, b) == "flight"


def test_short_drivable_land_hop_is_a_drive():
    a = tm.Node("stop", 53.35, -6.26)
    b = tm.Node("stop", 53.35, -7.16)  # ~60 km west
    assert 50 < tm.km(a.ll, b.ll) < 70
    assert hop(a, b) == "drive"


def test_two_sea_nodes_are_a_boat():
    a = tm.Node("stop", 53.10, -9.70, sea=True)
    b = tm.Node("stop", 53.12, -9.95, sea=True)
    assert hop(a, b) == "boat"


def test_undrivable_coastal_hop_is_a_boat(monkeypatch):
    monkeypatch.setattr(tm, "drivable", lambda a, b: False)
    a = tm.Node("stop", 53.35, -6.26)
    b = tm.Node("stop", 53.35, -7.16)
    assert hop(a, b, FakeGeo(coast_km=1.0)) == "boat"


def test_fast_hop_is_a_flight():
    a = tm.Node("stop", 53.35, -6.26, t=1_700_000_000)
    b = tm.Node("stop", 51.47, -0.45, t=1_700_003_600)  # Heathrow, ~450 km in an hour
    assert hop(a, b) == "flight"
