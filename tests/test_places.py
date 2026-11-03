"""Place-name decoding and voting. The Photos reverse-geocode blob is an NSKeyedArchiver
plist; these tests build a minimal one with the same shape instead of using real data."""
import plistlib

import pytest

import tripmap as tm


def make_blob(*, city=None, country_code=None, places=()):
    """places: (placeType, name, area). Object 0 is the archiver's '$null' sentinel."""
    objs = ["$null"]

    def add(o):
        objs.append(o)
        return plistlib.UID(len(objs) - 1)

    place_refs = [add({"placeType": add(t), "name": add(n), "area": add(a)}) for t, n, a in places]
    sorted_infos = add({"NS.objects": place_refs})
    map_item = add({"sortedPlaceInfos": sorted_infos})
    postal = add({"_city": city or "$null", "_state": "$null", "_country": "Ireland"})
    root = add({"postalAddress": postal, "countryCode": country_code or "IE", "mapItem": map_item})
    return plistlib.dumps({"$archiver": "NSKeyedArchiver", "$objects": objs, "$top": {"root": root}},
                          fmt=plistlib.FMT_BINARY)


def test_apple_place_reads_towns_pois_and_islands():
    blob = make_blob(city="Dingle", places=[
        (4, "Dingle", 2e8),          # town
        (6, "Ventry", 1e7),          # neighbourhood -> localities only
        (8, "Slea Head", 1e6),       # point of interest
        (11, "Great Blasket", 1e8),  # island
    ])
    info = tm.apple_place(blob)
    assert info["city"] == "Dingle"
    assert info["cc"] == "IE"
    # islands count as towns too, so an island can name an overnight stop
    assert set(info["towns"]) == {"Dingle", "Great Blasket"}
    assert set(info["localities"]) == {"Dingle", "Ventry", "Great Blasket"}
    assert info["poi"] == "Slea Head"
    assert info["island"] == "Great Blasket"
    assert info["onland"] is True


def test_apple_place_never_reads_street_level_entries():
    # type 17 can name the lodging, so it must not become a city, POI or locality
    blob = make_blob(places=[(17, "Guesthouse Lane", 1e4)])
    info = tm.apple_place(blob)
    assert info.get("poi") is None
    assert info.get("localities") == {}
    assert info.get("city") is None


def test_apple_place_detects_water():
    blob = make_blob(places=[(7, "Atlantic Ocean", 1e12)])
    assert tm.apple_place(blob)["water"] is True


def test_apple_place_ignores_designated_areas_as_poi():
    blob = make_blob(places=[(8, "Dingle Bay SAC", 1e6), (8, "Gallarus Oratory", 2e6)])
    assert tm.apple_place(blob)["poi"] == "Gallarus Oratory"


@pytest.mark.parametrize("blob", [None, b"", b"not a plist"])
def test_apple_place_tolerates_missing_or_garbage(blob):
    assert tm.apple_place(blob) == {}


def test_vote_counts_photos_and_ignores_missing_values():
    photos = [{"place": {"poi": "A"}}, {"place": {"poi": "B"}}, {"place": {"poi": "B"}}, {"place": {}}]
    assert tm.vote(photos, "poi") == "B"
    assert tm.vote(photos, "city") is None


def test_town_vote_counts_distinct_spots_not_photos():
    # 20 photos hard-wired to one hotel outside town must not outvote the town walk
    hotel = {"lat": 52.0, "lon": -9.0, "place": {"localities": {"Lodgeville": 1e6}}}
    walk = [{"lat": 52.1 + i * 0.01, "lon": -9.1, "place": {"localities": {"Dingle": 2e8}}} for i in range(3)]
    assert tm.town_vote([hotel] * 20 + walk) == "Dingle"


def test_town_vote_breaks_ties_by_area_and_can_prefer_small():
    photos = [
        {"lat": 1.0, "lon": 1.0, "place": {"localities": {"Big": 9e8, "Small": 1e6}}},
        {"lat": 2.0, "lon": 2.0, "place": {"localities": {"Big": 9e8, "Small": 1e6}}},
    ]
    assert tm.town_vote(photos) == "Big"
    assert tm.town_vote(photos, prefer_small=True) == "Small"
    assert tm.town_vote([]) is None
