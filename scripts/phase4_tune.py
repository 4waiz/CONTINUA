#!/usr/bin/env python3
"""
Phase 4 tuning, on the `tune` seed block only.

Sweeps a small, declared grid of the hysteresis knobs the new mechanisms
introduce and reports every cell. The selection rule is stated here, before
any cell is run, so the choice cannot drift toward whatever happened to look
best afterwards:

    Among cells whose mean `unsupported_mode_s` is within 2x of the smallest
    mean in the grid, choose the cell with the highest mean
    `teleop_availability_pct`; ties go to the fewest mean `mode_changes`.

Nothing here touches the `test` or `test2` blocks. Results land in
`data/experiments/phase4_tune.json` and are summarised in
`docs/PHASE_4_RESULTS.md`.

    python scripts/phase4_tune.py                 # the full grid, 5 trials
    python scripts/phase4_tune.py --trials 3      # quicker look
"""

from __future__ import annotations

import argparse
import itertools
import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "engine"))

OUT = ROOT / "data" / "experiments" / "phase4_tune.json"

#: Scenarios that exercise both mechanisms: a trend, a queue, a long-RTT
#: fallback and a flapping link. The two motion scenarios and the remaining
#: core ones are held back for the single test2 run.
TUNE_SCENARIOS = ("wifi-degradation", "cellular-congestion", "satellite-fallback", "flapping")

#: `measurement_debounce_s` sets both `mode_down_debounce_s` and
#: `class_leave_debounce_s`: the windowed loss estimate over-reads for a few
#: hundred milliseconds after a traffic surge onto a long-delay path (the new
#: sends have not arrived yet), and both debounces exist to ride that out.
GRID = {
    "mode_up_hold_s": (1.0, 2.0, 3.0, 5.0),
    "measurement_debounce_s": (0.3, 0.6, 1.0),
}

SELECTION_RULE = (
    "Among cells whose mean unsupported_mode_s is within 2x of the smallest mean in the grid, "
    "choose the highest mean teleop_availability_pct; ties go to the fewest mean mode_changes."
)


def cell_overrides(cell: dict) -> dict:
    return {
        "mode_up_hold_s": cell["mode_up_hold_s"],
        "mode_down_debounce_s": cell["measurement_debounce_s"],
        "class_leave_debounce_s": cell["measurement_debounce_s"],
    }


def _run_cell(args: tuple[dict, int]) -> dict:
    cell, trials = args
    overrides = cell_overrides(cell)
    from continua_engine.contracts import PolicyId
    from continua_engine.experiments.runner import run_comparison
    from continua_engine.store.store import RunStore

    store = RunStore(ROOT / "data" / "runs")
    per_scenario: dict[str, dict] = {}
    label = "-".join(f"{k}{v}" for k, v in cell.items())
    for scenario_id in TUNE_SCENARIOS:
        summary = run_comparison(
            scenario_id=scenario_id,
            trials=trials,
            policies=(PolicyId.P2_CONTINUA,),
            block="tune",
            store=store,
            experiment_id=f"tune-P2-{label}-{scenario_id}",
            policy_overrides=overrides,
        )
        per_scenario[scenario_id] = summary["aggregate"]["P2"]
    return {"cell": cell, "overrides": overrides, "per_scenario": per_scenario}


def _mean_over_scenarios(cell: dict, metric: str) -> float | None:
    values = [
        agg[metric]["mean"]
        for agg in cell["per_scenario"].values()
        if agg.get(metric, {}).get("mean") is not None
    ]
    return sum(values) / len(values) if values else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trials", type=int, default=5)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    cells = [dict(zip(GRID, values)) for values in itertools.product(*GRID.values())]
    print(f"tune block, {len(cells)} cells x {len(TUNE_SCENARIOS)} scenarios x {args.trials} trials of P2")
    started = time.time()
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(_run_cell, [(cell, args.trials) for cell in cells]))

    rows = []
    for cell in results:
        rows.append(
            {
                "cell": cell["cell"],
                "overrides": cell["overrides"],
                "teleop_availability_pct": _mean_over_scenarios(cell, "teleop_availability_pct"),
                "unsupported_mode_s": _mean_over_scenarios(cell, "unsupported_mode_s"),
                "conservative_mode_s": _mean_over_scenarios(cell, "conservative_mode_s"),
                "mode_changes": _mean_over_scenarios(cell, "mode_changes"),
                "class_steers": _mean_over_scenarios(cell, "class_steers"),
                "control_deadline_miss_pct": _mean_over_scenarios(cell, "control_deadline_miss_pct"),
                "cost_units": _mean_over_scenarios(cell, "cost_units"),
                "per_scenario": cell["per_scenario"],
            }
        )

    smallest = min(row["unsupported_mode_s"] for row in rows)
    admissible = [row for row in rows if row["unsupported_mode_s"] <= 2.0 * max(smallest, 1e-9)]
    chosen = sorted(admissible, key=lambda row: (-row["teleop_availability_pct"], row["mode_changes"]))[0]

    header = (
        f"{'hold':>5} {'debnc':>5} {'teleop%':>8} {'unsup s':>8} {'conserv s':>10} "
        f"{'changes':>8} {'steers':>7} {'ctrl miss%':>11} {'cost':>6}"
    )
    print()
    print(header)
    for row in rows:
        mark = " <- chosen" if row is chosen else ""
        print(
            f"{row['cell']['mode_up_hold_s']:>5} {row['cell']['measurement_debounce_s']:>5} "
            f"{row['teleop_availability_pct']:>8.2f} {row['unsupported_mode_s']:>8.2f} "
            f"{row['conservative_mode_s']:>10.2f} {row['mode_changes']:>8.2f} {row['class_steers']:>7.2f} "
            f"{row['control_deadline_miss_pct']:>11.2f} {row['cost_units']:>6.3f}{mark}"
        )
    print()
    print(f"selection rule: {SELECTION_RULE}")
    print(f"chosen: {chosen['cell']} -> {chosen['overrides']}  ({time.time() - started:.0f}s)")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "block": "tune",
                "scenarios": list(TUNE_SCENARIOS),
                "trials": args.trials,
                "policy": "P2",
                "grid": {k: list(v) for k, v in GRID.items()},
                "selection_rule": SELECTION_RULE,
                "chosen": chosen["cell"],
                "chosen_overrides": chosen["overrides"],
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "cells": rows,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
