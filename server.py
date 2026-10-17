"""Compatibility shim: the backend moved into the app/ package. `uvicorn server:app` still works;
new code and the launchd service use `uvicorn app.server:app`."""

from app.server import app

__all__ = ["app"]
