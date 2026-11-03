"""Request and response bodies for the API. A trip travels as a plain dict with the same
field names as the trip YAML (see docs/trip-format.md), plus `enabled` on each leg."""
import datetime as dt
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Trip = dict[str, Any]


class PhotosStatus(BaseModel):
    ok: bool
    library: str
    geotagged_assets: int | None = None
    reason: Literal["not_found", "permission_denied", "unreadable"] | None = None
    message: str | None = None


class DraftRequest(BaseModel):
    start: dt.date
    end: dt.date
    title: str | None = None


class DraftResponse(BaseModel):
    trip: Trip
    stats: dict[str, Any]


class PhotoSize(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class RenderRequest(BaseModel):
    trip: Trip
    size: int = 1600
    photo_size: PhotoSize | None = None
    with_day_trips: bool = False


class TripBody(BaseModel):
    trip: Trip


class SuggestModeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: tuple[float, float] = Field(alias="from")
    to: tuple[float, float]
    elapsed_hours: float | None = Field(default=None, ge=0)


class SuggestModeResponse(BaseModel):
    mode: Literal["drive", "train", "boat", "flight"]
    reason: str
