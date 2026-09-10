#!/usr/bin/env python3
"""
Bake the recorded evidence into static files the deployed site plays.

The CONTINUA engine is Python - FastAPI, numpy, scikit-learn - and cannot run on
Cloudflare Workers. Rather than deploy a frontend that asks visitors to install
Python, this script runs **the whole scenario-by-policy matrix through the real
engine** and exports every run, so the deployed site can play any combination a
visitor selects with no backend at all.

That is not a compromise on honesty. Replay is a first-class mode the engine
already supports, every number comes from a run the engine actually executed,
and the interface badges it `REPLAY - SIMULATION` exactly as it does locally.
Re-implementing the simulator in TypeScript would have been the alternative, and
it would have produced a second set of numbers that disagreed with the ones in
every document and every experiment. Recording the real thing does not.

    python scripts/build_demo_data.py            # the full matrix
    python scripts/build_demo_data.py --policies P1,B0

Output: apps/web/public/demo/
    index.json              catalogue: runs, scenarios, experiments, capability
    runs/<id>.json          one run, columnar (see `encode_events`)
    experiments/<id>.json   aggregate results, already small

## Why the run files are columnar

An event is a deep object of about 200 fields, and a run is a thousand events.
Written per event, the field *names* are 78 % of the bytes: forty runs came to
168 MB. Transposed into one array per field path, the names are written once and
the same forty runs come to under 40 MB, with no value altered and none
dropped - `decodeRun` in `apps/web/src/lib/staticDemo.ts` reverses it exactly.
"""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "engine"))

EXPERIMENTS = ROOT / "data" / "experiments"
CAPABILITY = ROOT / "data" / "emulation_capability.json"
OUT = ROOT / "apps" / "web" / "public" / "demo"

#: Every policy a visitor can select. The two ablations are deliberately absent:
#: they exist to answer "does the predictor pay for itself", which is a question
#: about aggregates across twenty trials, not about watching one run. Their
#: results are on the Experiments page, where that comparison belongs.
POLICIES = ["B0", "B1", "B2", "P1"]

#: The seed every demo run uses. One seed, fixed here, so that any two policies
#: a visitor compares faced a byte-identical exogenous trace - the same pairing
#: discipline the experiments use. Taken from the `test` block.
DEMO_SEED = 70009

#: The scenarios a visitor sees first. The rest of the catalogue follows in its
#: own order; naming these here only decides what is at the top of the list.
SCENARIO_FIRST = [
    "wifi-degradation",
    "baseline-journey",
    "sudden-failure",
    "cellular-congestion",
    "satellite-fallback",
]

#: Experiment results worth shipping: the completed 20-trial test-block runs.
DEMO_EXPERIMENTS = [
    "exp-26f132d5d7",  # wifi-degradation
    "exp-64931cf540",  # cellular-congestion
    "exp-966206c65b",  # satellite-fallback
    "exp-657ef4a89a",  # total-loss
    "exp-16354dec23",  # sudden-failure
    "exp-c1ddbbb2ba",  # flapping
    "exp-e70fe761a1",  # learned predictor
]


# ---------------------------------------------------------------------------
# Shrinking, without changing what anything says
# ---------------------------------------------------------------------------


def round_floats(node: Any, digits: int = 3) -> Any:
    """
    The simulator emits full double precision; nothing in the interface renders
    more than two decimals. Rounding to three keeps every displayed value
    identical and takes roughly a third off the wire.
    """
    if isinstance(node, float):
        return round(node, digits)
    if isinstance(node, dict):
        return {key: round_floats(value, digits) for key, value in node.items()}
    if isinstance(node, list):
        return [round_floats(value, digits) for value in node]
    return node


def encode_events(events: list[dict]) -> dict:
    """
    Transpose a list of events into one array per field path.

    Two kinds of column come out:

    * ``columns[path]`` - the leaf values, one entry per event, ``null`` where
      that event did not carry the field.
    * ``objects[path]`` - a 0/1 presence array for every path that holds a
      nested object, because ``prediction: null`` and ``prediction: {...}`` are
      different facts and the decoder has to be able to tell them apart.

    A column whose every entry is ``null`` is dropped: the decoder produces
    ``null`` for a path it never sees, so the round trip is unchanged.
    """
    leaf_paths: dict[str, None] = {}
    object_paths: dict[str, None] = {}

    flattened: list[tuple[dict[str, Any], dict[str, int]]] = []
    for event in events:
        leaves: dict[str, Any] = {}
        objects: dict[str, int] = {}

        def walk(node: dict, prefix: str) -> None:
            for key, value in node.items():
                path = f"{prefix}{key}"
                if isinstance(value, dict):
                    objects[path] = 1
                    object_paths.setdefault(path, None)
                    walk(value, f"{path}.")
                else:
                    leaves[path] = value
                    leaf_paths.setdefault(path, None)

        walk(event, "")
        flattened.append((leaves, objects))

    # A path that is an object in one event and absent in another is an object
    # path, not a leaf: drop it from the leaf set so it is not written twice.
    for path in object_paths:
        leaf_paths.pop(path, None)

    columns: dict[str, list] = {}
    for path in leaf_paths:
        values = [leaves.get(path) for leaves, _ in flattened]
        if any(value is not None for value in values):
            columns[path] = values

    presence = {
        path: [objects.get(path, 0) for _, objects in flattened] for path in object_paths
    }
    return {"count": len(events), "columns": columns, "objects": presence}


# ---------------------------------------------------------------------------
# Running the matrix
# ---------------------------------------------------------------------------


def build_run(scenario_id: str, policy_value: str, blurb: str) -> dict:
    """Execute one run through the real engine and write it out."""
    from continua_engine.contracts import ExecutionMode, PolicyId
    from continua_engine.sim.exogenous import get_scenario
    from continua_engine.sim.simulator import Simulation

    # Scenario specs are plain dicts loaded from `scenarios.json`.
    scenario = get_scenario(scenario_id)
    started_at = datetime.now(timezone.utc).isoformat()
    sim = Simulation(
        scenario,
        seed=DEMO_SEED,
        policy_id=PolicyId(policy_value),
        predictor_kind="heuristic",
        horizon_s=3.0,
        mode=ExecutionMode.SIMULATION,
    )
    result = sim.run()

    events = [round_floats(event.model_dump(mode="json")) for event in result.events]
    duration_s = events[-1]["t"] if events else 0.0

    manifest = {
        "run_id": sim.run_id,
        "mode": "simulation",
        "scenario": {
            "id": scenario["id"],
            "title": scenario["title"],
            "family": scenario.get("family", ""),
        },
        "policy_id": policy_value,
        "seed": DEMO_SEED,
        "predictor": "heuristic",
        "horizon_s": 3.0,
        "started_at": started_at,
        "engine_version": events[0]["schema_version"] if events else "2.0.0",
    }

    payload = {
        "run_id": sim.run_id,
        "blurb": blurb,
        "manifest": manifest,
        "metrics": round_floats(result.metrics),
        "duration_s": duration_s,
        "encoding": "columnar-1",
        "events": encode_events(events),
    }

    target = OUT / "runs" / f"{sim.run_id}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"))
    target.write_text(text, encoding="utf-8")

    raw = len(text.encode("utf-8"))
    packed = len(gzip.compress(text.encode("utf-8"), 9))
    print(
        f"  {scenario_id:22} {policy_value:3} {sim.run_id}  "
        f"{len(events):>5} ev  {raw / 1e6:5.2f} MB  {packed / 1e6:4.2f} MB gz"
    )

    return {
        "run_id": sim.run_id,
        "blurb": blurb,
        "scenario_id": scenario["id"],
        "scenario_title": scenario["title"],
        "policy_id": policy_value,
        "seed": DEMO_SEED,
        "predictor": "heuristic",
        "mode": "simulation",
        "started_at": started_at,
        "duration_s": duration_s,
        "events": len(events),
    }


def export_experiments() -> list[dict]:
    summaries = []
    for experiment_id in DEMO_EXPERIMENTS:
        source = EXPERIMENTS / f"{experiment_id}.json"
        if not source.exists():
            print(f"  skipped {experiment_id} (not on disk)")
            continue
        payload = round_floats(json.loads(source.read_text(encoding="utf-8")))
        target = OUT / "experiments" / f"{experiment_id}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        # Match the row shape `/api/experiments` returns, which is the store's
        # index rather than the result document: the Experiments page sorts and
        # labels by `completed` and `trials`, and the result document spells
        # those `trials_completed` (per policy) and `trials_requested`.
        completed = payload.get("trials_completed") or {}
        summaries.append(
            {
                "experiment_id": payload.get("experiment_id"),
                "created_at": payload.get("started_at"),
                "scenario_id": payload.get("scenario_id"),
                "trials": payload.get("trials_requested"),
                "policies": ",".join(payload.get("policies") or []),
                "status": "completed" if not payload.get("failures") else "partial",
                "completed": sum(completed.values()) if isinstance(completed, dict) else 0,
                "predictor": payload.get("predictor"),
                "notes": "",
            }
        )
    return summaries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--policies",
        default=",".join(POLICIES),
        help=f"comma-separated policy ids (default: {','.join(POLICIES)})",
    )
    parser.add_argument(
        "--scenarios",
        default="",
        help="comma-separated scenario ids (default: the whole catalogue)",
    )
    args = parser.parse_args()

    from continua_engine.sim.exogenous import get_scenario, scenario_catalogue

    policies = [entry.strip() for entry in args.policies.split(",") if entry.strip()]
    known = list(scenario_catalogue())
    scenarios = [entry.strip() for entry in args.scenarios.split(",") if entry.strip()] or [
        *[entry for entry in SCENARIO_FIRST if entry in known],
        *[entry for entry in known if entry not in SCENARIO_FIRST],
    ]

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    print(f"Recording {len(scenarios)} scenarios x {len(policies)} policies, seed {DEMO_SEED}")
    summaries = []
    for scenario_id in scenarios:
        scenario = get_scenario(scenario_id)
        for policy in policies:
            summaries.append(build_run(scenario_id, policy, scenario["title"]))

    print("\nExperiments")
    experiments = export_experiments()

    catalogue = list(scenario_catalogue().values())
    capability = (
        json.loads(CAPABILITY.read_text(encoding="utf-8")) if CAPABILITY.exists() else None
    )

    index = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "note": (
            "Every run here was executed by the CONTINUA engine and is replayed exactly as "
            "recorded. Nothing is synthesised for the demo and no value is computed in the "
            "browser. The engine itself is Python and runs locally; this site plays its output."
        ),
        "seed": DEMO_SEED,
        "policies": policies,
        "runs": summaries,
        "experiments": experiments,
        "scenarios": catalogue,
        "capability": capability,
    }
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")

    total = sum(path.stat().st_size for path in OUT.rglob("*") if path.is_file())
    files = sum(1 for path in OUT.rglob("*") if path.is_file())
    print(f"\nwrote {OUT.relative_to(ROOT)}  {total / 1e6:.2f} MB across {files} files")


if __name__ == "__main__":
    main()
