"""The API routes. Handlers that do blocking work are plain `def`, so FastAPI runs them in
its threadpool. Nothing here keeps state between requests."""
import datetime as dt
import functools

import yaml
from fastapi import APIRouter, Body, HTTPException, Response

import tripmap

from . import photos
from .models import (DraftRequest, DraftResponse, PhotosStatus, RenderRequest, SuggestModeRequest,
                     SuggestModeResponse, TripBody)

router = APIRouter(prefix="/api")


@router.get("/photos/status", response_model=PhotosStatus)
def photos_status():
    return photos.photos_status()


@router.post("/trips/draft", response_model=DraftResponse)
def draft(req: DraftRequest):
    try:
        trip, stats = tripmap.build_trip(tripmap.LIBRARY, req.start, req.end, req.title)
    except tripmap.TripError as e:
        raise HTTPException(404, str(e))
    return {"trip": trip, "stats": stats}


@router.post("/trips/render", response_class=Response,
             responses={200: {"content": {"image/png": {}}}})
def render(req: RenderRequest):
    trip = req.trip
    for key in ("stops", "legs"):
        if not isinstance(trip.get(key), list) or not trip[key]:
            raise HTTPException(422, f"The trip has no {key}")
    photo_size = (req.photo_size.width, req.photo_size.height) if req.photo_size else None
    try:
        png = tripmap.render_png(trip, req.size, photo_size, req.with_day_trips)
    except (KeyError, TypeError, IndexError) as e:
        raise HTTPException(422, f"Not a complete trip: {e!r}")
    except SystemExit as e:  # the CLI's find_chrome() exits when Chrome is missing
        raise HTTPException(503, str(e.code))
    return Response(content=png, media_type="image/png")


@router.post("/trips/yaml")
def trip_yaml(req: TripBody):
    try:
        text = tripmap.dump_trip_yaml(req.trip)
    except (KeyError, TypeError, IndexError) as e:
        raise HTTPException(422, f"Not a complete trip: {e!r}")
    return Response(content=text, media_type="text/yaml")


@router.post("/trips/import", response_model=TripBody)
def trip_import(text: str = Body(media_type="text/plain")):
    """Parse trip YAML text. Commented-out legs are comments, so they do not come back."""
    try:
        trip = yaml.safe_load(text)
    except yaml.YAMLError as e:
        raise HTTPException(422, f"Not valid YAML: {e}")
    if not isinstance(trip, dict):
        raise HTTPException(422, "The YAML is not a trip document")
    for key in ("stops", "legs"):
        if not isinstance(trip.get(key), list) or not trip[key]:
            raise HTTPException(422, f"The trip has no {key}")
    for leg in trip["legs"]:
        if not isinstance(leg, dict):
            raise HTTPException(422, "Each leg must be a mapping")
        leg.setdefault("enabled", True)
        if isinstance(leg.get("date"), dt.date):
            leg["date"] = leg["date"].isoformat()  # the same string form build_trip uses
    return {"trip": trip}


@router.post("/legs/suggest-mode", response_model=SuggestModeResponse)
def suggest_mode(req: SuggestModeRequest):
    """The mode classify_hop picks for one hop. Stations are empty, so this never asks
    Overpass, and a train is only recognised by its speed."""
    geo = _geo()
    base = 1_000_000_000.0  # any nonzero epoch: classify_hop treats a falsy t as "unknown"
    nodes = []
    for (lat, lon), t in ((req.from_, base), (req.to, base + (req.elapsed_hours or 0) * 3600)):
        _, sea = geo.classify(lat, lon)
        nodes.append(tripmap.Node("stop", lat, lon, t=t if req.elapsed_hours is not None else None,
                                  sea=sea))
    a, b = nodes
    mode = tripmap.classify_hop(a, b, geo, _stations(), [])
    return {"mode": mode, "reason": _reason(mode, a, b, req.elapsed_hours, geo)}


@functools.lru_cache(maxsize=1)
def _geo():
    return tripmap.Geo()


@functools.lru_cache(maxsize=1)
def _stations():
    return tripmap.Stations([])


def _reason(mode, a, b, hours, geo):
    """One sentence on why classify_hop chose `mode`, from the same facts it used."""
    dist = tripmap.km(a.ll, b.ll)
    ma, mb = geo.classify_strict(a.lat, a.lon), geo.classify_strict(b.lat, b.lon)
    apart = ma is not None and mb is not None and ma != mb
    pace = f" at about {dist / max(hours, 0.1):.0f} km/h" if hours is not None else ""
    if mode == "train":
        return f"A rail route links the two points and the {dist:.0f} km pace{pace} fits a train."
    if mode == "flight":
        if dist > 900:
            return f"The points are {dist:.0f} km apart, too far to drive."
        if pace and dist > 200:
            return f"Covering {dist:.0f} km{pace} is faster than any road trip."
        if apart:
            return f"The points are on different landmasses, {dist:.0f} km apart."
        return f"There is no sensible road over the {dist:.0f} km between the points."
    if mode == "boat":
        if a.sea or b.sea:
            return "One end is at sea and both are on the coast."
        if apart:
            return f"The points are on different islands, {dist:.0f} km apart."
        return f"No road links the two coastal points, {dist:.0f} km apart."
    return f"A road links the two points, {dist:.0f} km apart."
