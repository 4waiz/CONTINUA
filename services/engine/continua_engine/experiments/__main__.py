"""
Experiment CLI.

    python -m continua_engine.experiments --scenario wifi-degradation --trials 20
    python -m continua_engine.experiments --all --trials 20
    python -m continua_engine.experiments --smoke

`--smoke` runs 2 trials on every scenario as a fast sanity pass before
committing to the full matrix, which is what the method in
`docs/EXPERIMENT_METHOD.md` prescribes.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from ..contracts import PolicyId
from ..sim.exogenous import scenario_catalogue
from .runner import DEFAULT_POLICIES, run_comparison

CORE_SCENARIOS = (
    "wifi-degradation",
    "sudden-failure",
    "cellular-congestion",
    "satellite-fallback",
    "flapping",
    "total-loss",
)


def _progress(done: int, total: int, label: str) -> None:
    width = 28
    filled = int(width * done / max(total, 1))
    sys.stdout.write(f"\r  [{'#' * filled}{'.' * (width - filled)}] {done}/{total} {label:<28}")
    sys.stdout.flush()


def headline(summary: dict) -> None:
    aggregate = summary["aggregate"]
    rows = [
        ("session_reconnects", "reconnects", 2),
        ("total_interruption_s", "interruption s", 2),
        ("control_deadline_miss_pct", "ctrl miss %", 2),
        ("video_stall_ms", "video stall ms", 0),
        ("app_health_score", "app health", 1),
        ("satellite_bytes", "sat MB", 1),
        ("cost_units", "cost", 2),
        ("handovers", "handovers", 1),
    ]
    policies = list(aggregate)
    print(f"\n  {'metric':<16}" + "".join(f"{p:>13}" for p in policies))
    print("  " + "-" * (16 + 13 * len(policies)))
    for key, label, digits in rows:
        cells = []
        for policy in policies:
            entry = aggregate[policy].get(key, {})
            mean = entry.get("mean")
            if mean is None:
                cells.append(f"{'—':>13}")
            else:
                value = mean / 1e6 if key == "satellite_bytes" else mean
                cells.append(f"{value:>13.{digits}f}")
        print(f"  {label:<16}" + "".join(cells))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", action="append", default=None)
    parser.add_argument("--all", action="store_true", help="every scenario in the catalogue")
    parser.add_argument("--smoke", action="store_true", help="2 trials on every scenario")
    parser.add_argument("--trials", type=int, default=20)
    parser.add_argument("--block", default="test", choices=["train", "tune", "test"])
    parser.add_argument("--predictor", default="heuristic", choices=["heuristic", "learned", "none"])
    parser.add_argument("--policies", default=None, help="comma-separated policy ids")
    args = parser.parse_args()

    if args.smoke:
        scenarios = list(scenario_catalogue())
        trials = 2
    elif args.all:
        scenarios = list(scenario_catalogue())
        trials = args.trials
    elif args.scenario:
        scenarios = args.scenario
        trials = args.trials
    else:
        scenarios = list(CORE_SCENARIOS)
        trials = args.trials

    policies = (
        tuple(PolicyId(p.strip()) for p in args.policies.split(","))
        if args.policies
        else DEFAULT_POLICIES
    )

    index: list[dict] = []
    for scenario_id in scenarios:
        print(f"\n=== {scenario_id} · {trials} paired trials × {len(policies)} policies "
              f"· seed block {args.block} · predictor {args.predictor}")
        started = time.time()
        summary = run_comparison(
            scenario_id=scenario_id,
            trials=trials,
            policies=policies,
            block=args.block,
            predictor=args.predictor,
            progress=_progress,
        )
        elapsed = time.time() - started
        print(f"\n  completed in {elapsed:.0f}s · experiment {summary['experiment_id']}")
        if summary["failures"]:
            print(f"  ! {len(summary['failures'])} failed runs")
            for failure in summary["failures"][:5]:
                print(f"    {failure}")
        headline(summary)
        index.append(
            {
                "scenario_id": scenario_id,
                "experiment_id": summary["experiment_id"],
                "trials_requested": trials,
                "trials_completed": summary["trials_completed"],
                "predictor": args.predictor,
                "seed_block": args.block,
                "elapsed_s": round(elapsed, 1),
            }
        )

    from ..store.store import default_store

    index_path = default_store().root.parent / "experiments" / "index.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    existing = []
    if index_path.exists():
        try:
            existing = json.loads(index_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = []
    index_path.write_text(json.dumps(existing + index, indent=2), encoding="utf-8")
    print(f"\nindex -> {index_path}")


if __name__ == "__main__":  # pragma: no cover
    main()
