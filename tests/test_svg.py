import xml.etree.ElementTree as ET

import pytest

import tripmap as tm

NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'


def parse(fragment):
    return ET.fromstring(f"<svg {NS}>{fragment}</svg>")


@pytest.mark.parametrize("kind", ["boat", "train", "plane"])
def test_badges_are_well_formed_svg(kind):
    root = parse(tm.badge_svg(100, 100, 58, kind, angle=30))
    assert root.find(".//{http://www.w3.org/2000/svg}g") is not None


def test_pin_is_red_and_well_formed():
    root = parse(tm.pin_svg(50, 50, 118))
    assert tm.PIN in ET.tostring(root, encoding="unicode")


def test_train_badge_differs_from_boat_and_plane():
    shapes = {k: tm.badge_svg(0, 0, 58, k) for k in ("boat", "train", "plane")}
    assert len(set(shapes.values())) == 3


def test_unknown_badge_kind_falls_back_to_plane_glyph():
    assert tm.badge_svg(0, 0, 58, "mystery") == tm.badge_svg(0, 0, 58, "plane")
