"""The FastAPI application factory."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import router

ALLOWED_ORIGINS = ["http://localhost:5173"]


def create_app() -> FastAPI:
    app = FastAPI(title="tripmap", summary="Draft and render trip route maps")
    app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type"])
    app.include_router(router)
    return app
