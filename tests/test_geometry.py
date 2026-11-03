import math

import pytest

import tripmap as tm


def test_km_one_degree_of_longitude_at_equator():
    assert tm.km((0, 0), (0, 1)) == pytest.approx(111.19, rel=1e-3)


def test_km_zero_and_symmetric():
    assert tm.km((53.35, -6.26), (53.35, -6.26)) == 0
    assert tm.km((53.35, -6.26), (53.27, -9.05)) == pytest.approx(tm.km((53.27, -9.05), (53.35, -6.26)))


def test_thin_keeps_endpoints_and_spaces_points():
    pts = [(0, 0), (0.5, 0), (1.2, 0), (1.3, 0), (2.0, 0)]
    out = tm.thin(pts, 1.0)
    assert out[0] == (0, 0)
    assert out[-1] == (2.0, 0)
    assert all(math.dist(a, b) >= 1.0 for a, b in zip(out[:-1], out[1:-1]))


def test_thin_single_point_is_unchanged():
    assert tm.thin([(3, 4)], 10) == [(3, 4)]


def test_midpoint_on_a_straight_line():
    (x, y), total = tm.midpoint([(0, 0), (10, 0)])
    assert total == pytest.approx(10)
    assert (x, y) == pytest.approx((5, 0))


def test_midpoint_spans_a_bend_by_length_not_by_vertex():
    # first leg 2 long, second 8 long: the halfway point is 3 along the second leg
    (x, y), total = tm.midpoint([(0, 0), (2, 0), (2, 8)])
    assert total == pytest.approx(10)
    assert (x, y) == pytest.approx((2, 3))


def test_line_d_and_smooth_d_start_at_first_point():
    assert tm.line_d([(1, 2), (3, 4)]) == "M1.0,2.0 L3.0,4.0"
    assert tm.smooth_d([(1, 2), (3, 4), (5, 6)]).startswith("M1.0,2.0 C")
    assert tm.smooth_d([(1, 2), (3, 4)]).count("C") == 1


def test_star_pts_has_ten_alternating_vertices():
    pts = tm.star_pts(0, 0, 10).split()
    assert len(pts) == 10
    radii = [math.hypot(*map(float, p.split(","))) for p in pts]
    assert radii[0::2] == pytest.approx([10] * 5, abs=0.2)
    assert radii[1::2] == pytest.approx([4.5] * 5, abs=0.2)


def test_text_w_is_wider_for_capitals():
    assert tm.text_w("ROME", 10, upper=True) > tm.text_w("Rome", 10, upper=False)
    assert tm.text_w("", 10, upper=True) == 0
