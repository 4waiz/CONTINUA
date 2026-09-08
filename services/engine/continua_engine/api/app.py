"""
CONTINUA engine HTTP/WebSocket API.

Security posture (see `docs/SECURITY.md`):

* Binds to 127.0.0.1 by default. Privileged controls are local-only unless the
  operator deliberately overrides the bind address.
* Every request body is a Pydantic model with explicit ranges. Scenario ids are
  looked up in a fixed catalogue; nothing from the frontend reaches a shell.
* No credentials are read from or written to source control.
* This is a research prototype. It has not been security-audited, and nothing
  in this project claims otherwise.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ..contracts import (
    ALL_LINKS,
    SCHEMA_VERSION,
    ExecutionMode,
    PolicyId,
    RunControl,
    ScenarioOverrides,
)
from ..controller.controller import POLICY_LIBRARY
from ..controller.predictors import VIOLATION_DEFINITION, LearnedPredictor
from ..emulation.capability import probe as capability_probe
from ..experiments.runner import DEFAULT_POLICIES, run_comparison, seed_for
from ..sim.exogenous import link_profiles, scenario_catalogue
from ..store.store import RunStore, default_store
from .sessions import ReplaySession, RunSession

MAX_LIVE_SESSIONS = 4

_sessions: dict[str, RunSession | ReplaySession] = {}
_experiments: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    for session in list(_sessions.values()):
        await session.stop()
    _sessions.clear()


app = FastAPI(
    title="CONTINUA engine",
    version=SCHEMA_VERSION,
    description="Scenario generator, network simulator, controller and experiment runner.",
    lifespan=lifespan,
)

# The frontend runs on a different port in development. Restricted to localhost
# origins: this API exposes run control, which is not something to hand out.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["content-type"],
)


def store() -> RunStore:
    return default_store()


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health() -> dict:
    learned = LearnedPredictor()
    return {
        "ok": True,
        "engine_version": SCHEMA_VERSION,
        "schema_version": SCHEMA_VERSION,
        "time": datetime.now(timezone.utc).isoformat(),
        "live_sessions": len(_sessions),
        "learned_predictor_available": learned.available,
        "learned_predictor_version": learned.model_version,
    }


@app.get("/api/scenarios")
def scenarios() -> dict:
    catalogue = scenario_catalogue()
    return {
        "scenarios": [
            {
                "id": spec["id"],
                "title": spec["title"],
                "family": spec.get("family", ""),
                "description": spec.get("description", ""),
                "duration_s": spec["duration_s"],
                "links": spec["links"],
                "workload": spec["workload"],
                "faults": spec.get("faults", []),
                "background": spec.get("background", []),
                "speed_scale": spec.get("speed_scale", 1.0),
                "reverse": spec.get("reverse", False),
            }
            for spec in catalogue.values()
        ]
    }


@app.get("/api/policies")
def policies() -> dict:
    return {
        "policies": [
            {
                "id": policy.value,
                "multipath": config.multipath,
                "proactive_warm": config.proactive_warm,
                "use_prediction": config.use_prediction,
                "always_redundant": config.always_redundant,
                "app_aware": config.app_aware,
                "min_dwell_s": config.min_dwell_s,
                "predictor": config.predictor_kind,
            }
            for policy, config in POLICY_LIBRARY.items()
        ],
        "violation_definition": VIOLATION_DEFINITION,
    }


@app.get("/api/profiles")
def profiles() -> dict:
    """Link and workload assumptions, served so the UI can label them as such."""
    data = link_profiles()
    return {
        "version": data["version"],
        "disclaimer": data["$comment"],
        "profiles": data["profiles"],
        "workload": data["workload"],
        "quality_response": data["quality_response"],
        "probing": data["probing"],
    }


@app.get("/api/capability")
def capability() -> dict:
    """Live emulation capability probe. Read-only; runs no privileged command."""
    return capability_probe().to_dict()


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


class StartRunRequest(BaseModel):
    control: RunControl
    overrides: ScenarioOverrides | None = None


@app.post("/api/runs")
async def start_run(request: StartRunRequest) -> dict:
    if request.control.mode is not ExecutionMode.SIMULATION:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only simulation mode can be started from the API on this host. "
                "See /api/capability for why emulation is unavailable."
            ),
        )
    if request.control.scenario_id not in scenario_catalogue():
        raise HTTPException(status_code=404, detail="unknown scenario")
    live = [s for s in _sessions.values() if isinstance(s, RunSession)]
    if len(live) >= MAX_LIVE_SESSIONS:
        oldest = live[0]
        await oldest.stop()
        _sessions.pop(oldest.run_id, None)

    session = RunSession(request.control, request.overrides, store())
    _sessions[session.run_id] = session
    session.start()
    return {"run_id": session.run_id, "state": session.state().to_dict()}


class ControlRequest(BaseModel):
    action: str = Field(pattern="^(play|pause|reset|seek|speed|stop)$")
    t: float | None = Field(default=None, ge=0.0, le=3600.0)
    speed: float | None = Field(default=None, ge=0.0, le=64.0)


@app.post("/api/runs/{run_id}/control")
async def control_run(run_id: str, request: ControlRequest) -> dict:
    session = _sessions.get(run_id)
    if session is None:
        raise HTTPException(status_code=404, detail="no live session with that run id")
    if request.action == "play":
        session.resume()
        session.start()
    elif request.action == "pause":
        session.pause()
    elif request.action == "reset":
        session.seek(0.0)
        session.pause()
    elif request.action == "seek":
        if request.t is None:
            raise HTTPException(status_code=422, detail="seek requires t")
        session.seek(request.t)
    elif request.action == "speed":
        if request.speed is None:
            raise HTTPException(status_code=422, detail="speed requires a value")
        session.set_speed(request.speed)
    elif request.action == "stop":
        await session.stop()
        _sessions.pop(run_id, None)
    return {"state": session.state().to_dict()}


@app.get("/api/runs")
def list_runs(limit: int = Query(default=40, ge=1, le=500), scenario_id: str | None = None) -> dict:
    rows = store().list_runs(limit=limit, scenario_id=scenario_id)
    return {"runs": rows, "live": [s.state().to_dict() for s in _sessions.values()]}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict:
    session = _sessions.get(run_id)
    if session is not None:
        return {"live": True, "state": session.state().to_dict(), "snapshot": session.snapshot()}
    row = store().get_run(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="unknown run")
    return {"live": False, "run": row, "manifest": store().get_manifest(run_id)}


@app.get("/api/runs/{run_id}/events")
def get_events(
    run_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=2000, ge=1, le=20000),
) -> dict:
    events = list(store().iter_events(run_id))
    if not events:
        raise HTTPException(status_code=404, detail="no recorded events for that run")
    window = events[offset : offset + limit]
    return {"run_id": run_id, "total": len(events), "offset": offset, "events": window}


@app.get("/api/runs/{run_id}/metrics")
def get_metrics(run_id: str) -> dict:
    metrics = store().read_metrics(run_id)
    if metrics is None:
        raise HTTPException(status_code=404, detail="no metrics recorded for that run")
    return metrics


@app.delete("/api/runs/{run_id}")
async def delete_run(run_id: str) -> dict:
    session = _sessions.pop(run_id, None)
    if session is not None:
        await session.stop()
    store().delete_run(run_id)
    return {"deleted": run_id}


# ---------------------------------------------------------------------------
# Replay
# ---------------------------------------------------------------------------


@app.post("/api/runs/{run_id}/replay")
async def start_replay(run_id: str) -> dict:
    row = store().get_run(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="unknown run")
    events = list(store().iter_events(run_id))
    if not events:
        raise HTTPException(status_code=409, detail="that run has no recorded events to replay")
    session = ReplaySession(row, events, store())
    _sessions[session.run_id] = session
    session.start()
    return {"run_id": session.run_id, "state": session.state().to_dict()}


# ---------------------------------------------------------------------------
# Experiments
# ---------------------------------------------------------------------------


class ExperimentRequest(BaseModel):
    scenario_id: str
    trials: int = Field(default=20, ge=1, le=200)
    policies: list[PolicyId] | None = None
    block: str = Field(default="test", pattern="^(train|tune|test)$")
    predictor: str = Field(default="heuristic", pattern="^(heuristic|learned|none)$")
    horizon_s: float = Field(default=3.0, ge=0.5, le=15.0)


def _run_experiment_blocking(experiment_id: str, request: ExperimentRequest) -> None:
    policies = tuple(request.policies) if request.policies else DEFAULT_POLICIES
    _experiments[experiment_id] = {"status": "running", "done": 0, "total": request.trials * len(policies)}

    def progress(done: int, total: int, label: str) -> None:
        _experiments[experiment_id] = {
            "status": "running",
            "done": done,
            "total": total,
            "label": label,
        }

    try:
        summary = run_comparison(
            scenario_id=request.scenario_id,
            trials=request.trials,
            policies=policies,
            block=request.block,
            predictor=request.predictor,
            horizon_s=request.horizon_s,
            store=store(),
            progress=progress,
            experiment_id=experiment_id,
        )
        _experiments[experiment_id] = {
            "status": "completed",
            "done": _experiments[experiment_id]["total"],
            "total": _experiments[experiment_id]["total"],
            "summary": summary,
        }
    except Exception as exc:  # noqa: BLE001 - surfaced, not swallowed
        _experiments[experiment_id] = {"status": "failed", "error": repr(exc)}


@app.post("/api/experiments")
async def start_experiment(request: ExperimentRequest, background: BackgroundTasks) -> dict:
    if request.scenario_id not in scenario_catalogue():
        raise HTTPException(status_code=404, detail="unknown scenario")
    experiment_id = f"exp-{uuid.uuid4().hex[:10]}"
    _experiments[experiment_id] = {"status": "queued", "done": 0, "total": 0}
    # Runs in a worker thread: the simulation is CPU-bound and must not block
    # the event loop that is serving live runs.
    background.add_task(asyncio.to_thread, _run_experiment_blocking, experiment_id, request)
    return {"experiment_id": experiment_id, "status": "queued"}


@app.get("/api/experiments")
def list_experiments() -> dict:
    return {
        "stored": store().list_experiments(),
        "in_flight": {
            key: {k: v for k, v in value.items() if k != "summary"}
            for key, value in _experiments.items()
        },
    }


@app.get("/api/experiments/{experiment_id}")
def get_experiment(experiment_id: str) -> dict:
    live = _experiments.get(experiment_id)
    stored = store().experiment_results(experiment_id)
    if live is None and stored is None:
        raise HTTPException(status_code=404, detail="unknown experiment")
    if stored is not None:
        return {"status": "completed", "results": stored}
    return live or {"status": "unknown"}


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------


@app.websocket("/ws/runs/{run_id}")
async def run_socket(websocket: WebSocket, run_id: str) -> None:
    await websocket.accept()
    session = _sessions.get(run_id)
    if session is None:
        await websocket.send_json(
            {"type": "error", "detail": "no live session with that run id", "run_id": run_id}
        )
        await websocket.close()
        return

    queue = session.broadcaster.subscribe()
    try:
        await websocket.send_json(session.snapshot())
        while True:
            message = await queue.get()
            await websocket.send_json(message)
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except RuntimeError:
        # Socket closed underneath us mid-send.
        pass
    finally:
        session.broadcaster.unsubscribe(queue)


def main() -> None:  # pragma: no cover
    import uvicorn

    host = os.environ.get("CONTINUA_API_HOST", "127.0.0.1")
    port = int(os.environ.get("CONTINUA_API_PORT", "8000"))
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":  # pragma: no cover
    main()
