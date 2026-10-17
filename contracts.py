"""API contracts: pydantic request/response models for every JSON endpoint.

Models are permissive (extra="allow", fields typed Any and optional) so adding them changes no runtime behavior;
they document the API and pin the OpenAPI schema (contracts/openapi.json, checked in CI by tests/test_contracts.py).
Regenerate after an intentional API change:  python contracts.py --write
"""

import json
import pathlib
import sys
from typing import Any, Dict, List, Optional, Union

from fastapi import Body
from pydantic import BaseModel, ConfigDict

SCHEMA_PATH = pathlib.Path(__file__).parent / "contracts" / "openapi.json"


class Model(BaseModel):
    model_config = ConfigDict(extra="allow")


# ---- requests ----
class AskRequest(Model):
    question: Any = None
    prev_run_id: Optional[Any] = None


class TtsRequest(Model):
    text: Any = None


class ClaimRequest(Model):
    task: Any = None
    agent: Optional[Any] = None
    force: Optional[Any] = None


class ReleaseRequest(Model):
    task: Any = None
    agent: Optional[Any] = None
    status: Optional[Any] = None
    note: Optional[Any] = None


def body(model):
    """FastAPI dependency: validate the JSON body against `model` and hand the handler a plain dict (as before)."""

    def dep(payload: model = Body(...)) -> dict:  # type: ignore[valid-type]
        return payload.model_dump(exclude_unset=True)  # type: ignore[attr-defined]

    return dep


# ---- responses ----
class HealthResponse(Model):
    ok: Optional[bool] = None
    backend: Optional[str] = None
    nodes: Optional[int] = None
    anthropic: Optional[bool] = None
    elevenlabs: Optional[bool] = None
    arize: Optional[Any] = None
    sandbox: Optional[str] = None


class AskResponse(Model):
    run_id: Optional[str] = None
    deduped: Optional[Any] = None


class RunResponse(Model):
    events: Optional[List[Dict[str, Any]]] = None
    result: Optional[Dict[str, Any]] = None
    partial: Optional[str] = None


class RunSummary(Model):
    run_id: Optional[str] = None
    question: Optional[Any] = None
    n: Optional[int] = None
    ts: Optional[str] = None


class TaskResponse(Model):
    ok: Optional[bool] = None
    task: Optional[Any] = None
    error: Optional[Any] = None


class SttResponse(Model):
    text: Optional[str] = None


class HotloadStatus(Model):
    version: Optional[int] = None
    loaded_at: Optional[str] = None
    watching: Optional[bool] = None
    loaded: Optional[List[str]] = None
    errors: Optional[Dict[str, str]] = None
    seats: Optional[Dict[str, Any]] = None
    changed: Optional[List[str]] = None


class AnyObject(Model):
    """Free-form JSON object (dashboards/boards whose shape is owned by another module)."""


EVENTS = List[Dict[str, Any]]
RUNS = List[RunSummary]
AUDIO: Dict[Union[int, str], Dict[str, Any]] = {200: {"content": {"audio/mpeg": {}}, "description": "MP3 audio"}}


def openapi(app) -> dict:
    return app.openapi()


if __name__ == "__main__":
    import os

    os.environ.setdefault("LLM_MODE", "fake")
    os.environ.setdefault("ACS_HOTLOAD", "0")
    import server

    text = json.dumps(openapi(server.app), indent=2, sort_keys=True) + "\n"
    if "--write" in sys.argv:
        SCHEMA_PATH.parent.mkdir(exist_ok=True)
        SCHEMA_PATH.write_text(text)
        print(f"wrote {SCHEMA_PATH}")
    else:
        print(text)
