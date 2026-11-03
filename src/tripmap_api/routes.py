"""The API routes. Handlers that do blocking work are plain `def`, so FastAPI runs them in
its threadpool. Nothing here keeps state between requests."""
import datetime as dt

import yaml
from fastapi import APIRouter, Body, HTTPException, Response

import tripmap

from . import photos
from .models import (DraftRequest, DraftResponse, PhotosStatus, RenderRequest, SuggestModeRequest,
                     SuggestModeResponse, TripBody)

router = APIRouter(prefix="/api")


def _todo():
    raise HTTPException(501, "Not implemented yet")


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


@router.post("/trips/render")
def render(req: RenderRequest):
    _todo()


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
    _todo()
