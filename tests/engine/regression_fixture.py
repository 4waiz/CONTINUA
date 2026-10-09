# Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE.
# KS-CONTINUA-873E0731482F
"""
Regression fixture for the Phase 4 guard.

Runs every pre-Phase-4 policy on a fixed set of scenarios at a fixed seed and
records (a) the full metrics document, minus the random run id, and (b) a
digest of the decision stream: time, controller state, carrying path, first
action and the reason recorded at decision time. `test_regression_guard.py`
compares a fresh run against this file.

The fixture was generated from commit 95cdfd0, before any Phase 4 mechanism
existed. Regenerate it only if a deliberate, documented behaviour change to an
existing policy is intended:

    python tests/engine/regression_fixture.py --write
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[2] / "services" / "engine"
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from continua_engine.contracts import PolicyId  # noqa: E402
from continua_engine.sim.exogenous import get_scenario  # noqa: E402
from continua_engine.sim.simulator import Simulation  # noqa: E402

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "phase4_regression.json"

#: Outside every experiment seed block (train 10 000, tune 40 000, test 70 000,
#: test2 100 000), so the guard never touches a reported seed.
GUARD_SEED = 4242

GUARD_SCENARIOS = (
    "wifi-degradation",
    "cellular-congestion",
    "satellite-fallback",
    "flapping",
)

GUARD_POLICIES = (
    PolicyId.B0_SINGLE_REACTIVE,
    PolicyId.B1_REACTIVE_MULTIPATH,
    PolicyId.B2_ALWAYS_REDUNDANT,
    PolicyId.P1_CONTINUA,
    PolicyId.P1_NO_PREDICTION,
    PolicyId.P1_NO_APP_PRIORITY,
)


def strip_metrics(metrics: dict) -> dict:
    out = dict(metrics)
    out.pop("run_id", None)
    return out


def event_digest(events) -> tuple[int, str]:
    hasher = hashlib.sha256()
    for event in events:
        action = event.action
        line = "|".join(
            [
                f"{event.t:.4f}",
                event.controller_state.value,
                event.carrying.value if event.carrying else "-",
                action.kind.value if action else "-",
                (action.link.value if action and action.link else "-"),
                (action.traffic_class.value if action and action.traffic_class else "-"),
                event.reason,
            ]
        )
        hasher.update(line.encode("utf-8"))
        hasher.update(b"\n")
    return len(events), hasher.hexdigest()


def snapshot(scenario_id: str, policy: PolicyId) -> dict:
    sim = Simulation(get_scenario(scenario_id), seed=GUARD_SEED, policy_id=policy)
    result = sim.run()
    count, digest = event_digest(result.events)
    return {
        "metrics": strip_metrics(result.metrics),
        "events": count,
        "event_digest": digest,
    }


def build() -> dict:
    runs: dict[str, dict] = {}
    for scenario_id in GUARD_SCENARIOS:
        for policy in GUARD_POLICIES:
            runs[f"{scenario_id}::{policy.value}"] = snapshot(scenario_id, policy)
    return {
        "seed": GUARD_SEED,
        "scenarios": list(GUARD_SCENARIOS),
        "policies": [policy.value for policy in GUARD_POLICIES],
        "runs": runs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="overwrite the fixture file")
    args = parser.parse_args()
    data = build()
    if args.write:
        FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE_PATH.write_text(json.dumps(data, indent=1, sort_keys=True), encoding="utf-8")
        print(f"wrote {FIXTURE_PATH} ({len(data['runs'])} runs)")
    else:
        print(json.dumps({k: v["event_digest"] for k, v in data["runs"].items()}, indent=1))


if __name__ == "__main__":
    main()
