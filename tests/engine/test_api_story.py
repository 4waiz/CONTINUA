"""
The API the story mode and the road-ahead strip read.

* A scenario names the radio map a route-aware policy looks its route up in,
  and the map is served exactly as the controller reads it - from the file,
  unchanged - so the strip on screen is the policy's own knowledge.
* A map id is a name, not a path.
* `play` honours the rate it carries: the Mission dock sends its speed that way.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[2] / "services" / "engine"
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from continua_engine.api.app import app  # noqa: E402
from continua_engine.controller.radio_map import MAP_VERSION, map_path  # noqa: E402

client = TestClient(app)


def test_scenarios_name_their_radio_map() -> None:
    scenarios = {spec["id"]: spec for spec in client.get("/api/scenarios").json()["scenarios"]}
    assert scenarios["shadow-survey"]["radio_map"] == "shadow-survey"
    assert scenarios["shadow-stale"]["radio_map"] == "shadow-survey"
    # The original scenarios carry none; nothing is invented for them.
    assert scenarios["baseline-journey"]["radio_map"] is None
    shadows = [fault for fault in scenarios["shadow-survey"]["faults"] if fault["kind"] == "shadow"]
    assert {(fault["from_m"], fault["to_m"]) for fault in shadows} == {(235.0, 275.0), (445.0, 470.0)}


def test_radio_map_is_served_as_the_controller_reads_it() -> None:
    response = client.get("/api/radio-maps/shadow-survey")
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == MAP_VERSION
    assert body == json.loads(map_path("shadow-survey").read_text(encoding="utf-8"))


def test_radio_map_ids_are_names_not_paths() -> None:
    assert client.get("/api/radio-maps/no-such-survey").status_code == 404
    assert client.get("/api/radio-maps/Shadow_Survey").status_code == 422
    assert client.get("/api/radio-maps/..%2Fscenarios").status_code in (404, 422)


def test_play_carries_its_rate() -> None:
    # One event loop for the whole exchange: a live run is a task on it.
    with TestClient(app) as live:
        started = live.post(
            "/api/runs",
            json={"control": {"scenario_id": "baseline-journey", "policy_id": "B0", "seed": 7, "speed": 1}},
        )
        assert started.status_code == 200
        run_id = started.json()["run_id"]
        try:
            live.post(f"/api/runs/{run_id}/control", json={"action": "pause"})
            played = live.post(f"/api/runs/{run_id}/control", json={"action": "play", "speed": 4})
            assert played.status_code == 200
            assert played.json()["state"]["speed"] == 4
        finally:
            live.post(f"/api/runs/{run_id}/control", json={"action": "stop"})
