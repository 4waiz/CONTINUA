#!/usr/bin/env python3
# Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE.
# KS-CONTINUA-61383F62F049
"""
The Phase 5 comparison: route-aware preparation (P3) against every baseline
and against P1 and P1-noPred, on the five `shadow` scenarios and the eight
Phase 4 scenarios, 20 paired trials each, on the `test4` seed block, run
exactly once. What it tests, and what was expected before it ran, is written
in docs/EXPERIMENT_METHOD.md section 9.

Scenarios run in parallel processes; pairing is per scenario and per trial,
so parallelism across scenarios changes nothing about the design. Each
scenario's result is the same `run_comparison` document the CLI writes; this
script adds `data/experiments/phase5_index.json` naming every experiment.

    python scripts/phase5_experiment.py

Re-running it on the same block would be a second look at a block meant to be
used once. It refuses while its index exists.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "engine"))

from continua_engine.contracts import PolicyId  # noqa: E402
from continua_engine.experiments.__main__ import PHASE4_SCENARIOS  # noqa: E402

SHADOW_SCENARIOS = ("shadow-survey", "shadow-degradation", "shadow-fast", "shadow-reverse", "shadow-stale")
PHASE5_SCENARIOS = SHADOW_SCENARIOS + PHASE4_SCENARIOS
PHASE5_POLICIES = (
    PolicyId.B0_SINGLE_REACTIVE,
    PolicyId.B1_REACTIVE_MULTIPATH,
    PolicyId.B2_ALWAYS_REDUNDANT,
    PolicyId.B2_ALWAYS_REDUNDANT_DEFER,
    PolicyId.P1_CONTINUA,
    PolicyId.P1_NO_PREDICTION,
    PolicyId.P3_ROUTE,
)
INDEX = ROOT / "data" / "experiments" / "phase5_index.json"


def _run_scenario(args: tuple[str, int, str]) -> dict:
    scenario_id, trials, block = args
    from continua_engine.experiments.runner import run_comparison
    from continua_engine.store.store import RunStore

    store = RunStore(ROOT / "data" / "runs")
    started = time.time()
    summary = run_comparison(
        scenario_id=scenario_id,
        trials=trials,
        policies=PHASE5_POLICIES,
        block=block,
        store=store,
        experiment_id=f"phase5-{block}-{scenario_id}",
    )
    return {
        "scenario_id": scenario_id,
        "experiment_id": summary["experiment_id"],
        "seed_block": block,
        "seeds": summary["seeds"],
        "trials_requested": trials,
        "trials_completed": summary["trials_completed"],
        "policies": summary["policies"],
        "failures": summary["failures"],
        "code_commit": summary["code_commit"],
        "elapsed_s": round(time.time() - started, 1),
        "summary": summary,
    }


def _line(summary: dict, policy: str) -> str:
    agg = summary["aggregate"].get(policy, {})

    def mean(key: str) -> float:
        value = agg.get(key, {}).get("mean")
        return float(value) if value is not None else float("nan")

    return (
        f"  {policy:<9} reconnects {mean('session_reconnects'):4.2f}  interruption {mean('total_interruption_s'):5.2f} s"
        f"  safe stops {mean('safe_stop_runs'):4.2f}  cost {mean('cost_units'):4.2f}"
        f"  satellite {mean('satellite_bytes') / 1e6:5.1f} MB  prepared {mean('route_prearms'):4.2f}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trials", type=int, default=20)
    parser.add_argument("--block", default="test4")
    parser.add_argument("--workers", type=int, default=13)
    args = parser.parse_args()
    if INDEX.exists():
        raise SystemExit(
            f"{INDEX.relative_to(ROOT)} already exists: this comparison was already run. "
            "It runs once; delete the index deliberately if you really mean to redo it."
        )
    print(
        f"Phase 5 comparison: {len(PHASE5_SCENARIOS)} scenarios x {args.trials} paired trials x "
        f"{len(PHASE5_POLICIES)} policies, seed block {args.block}"
    )
    started = time.time()
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(_run_scenario, [(s, args.trials, args.block) for s in PHASE5_SCENARIOS]))

    for entry in results:
        print(f"\n=== {entry['scenario_id']} · {entry['experiment_id']} · {entry['elapsed_s']} s")
        for failure in entry["failures"][:5]:
            print(f"  ! {failure}")
        for policy in entry["policies"]:
            print(_line(entry["summary"], policy))

    INDEX.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "block": args.block,
                "trials": args.trials,
                "policies": [p.value for p in PHASE5_POLICIES],
                "scenarios": list(PHASE5_SCENARIOS),
                "elapsed_s": round(time.time() - started, 1),
                "experiments": [{k: v for k, v in e.items() if k != "summary"} for e in results],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\nindex -> {INDEX.relative_to(ROOT)}  ({time.time() - started:.0f} s)")


if __name__ == "__main__":
    main()
