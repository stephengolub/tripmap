"""The API routes. Handlers that do blocking work are plain `def`, so FastAPI runs them in
its threadpool. Nothing here keeps state between requests."""
from fastapi import APIRouter, HTTPException

from .models import (DraftRequest, DraftResponse, PhotosStatus, RenderRequest, SuggestModeRequest,
                     SuggestModeResponse, TripBody)

router = APIRouter(prefix="/api")


def _todo():
    raise HTTPException(501, "Not implemented yet")


@router.get("/photos/status", response_model=PhotosStatus)
def photos_status():
    _todo()


@router.post("/trips/draft", response_model=DraftResponse)
def draft(req: DraftRequest):
    _todo()


@router.post("/trips/render")
def render(req: RenderRequest):
    _todo()


@router.post("/trips/yaml")
def trip_yaml(req: TripBody):
    _todo()


@router.post("/trips/import", response_model=TripBody)
def trip_import():
    _todo()


@router.post("/legs/suggest-mode", response_model=SuggestModeResponse)
def suggest_mode(req: SuggestModeRequest):
    _todo()
