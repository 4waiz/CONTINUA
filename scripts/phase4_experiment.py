#!/usr/bin/env python3
# Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE.
# KS-CONTINUA-CD9CE8538193
"""
The Phase 4 comparison: every policy, old and new, on the six core scenarios
plus fast-run and reverse-run, 20 paired trials each, on the `test2` seed
block, run exactly once.

Scenarios run in parallel processes because 1 760 runs take about an hour in
one process; pairing is per scenario and per trial, so parallelism across
scenarios changes nothing about the design. Each scenario's result is the
same `run_comparison` document the CLI writes, and this script adds an index
`data/experiments/phase4_index.json` naming every experiment it produced.

    python scripts/phase4_experiment.py --trials 20 --block test2

Re-running this with the same block would be a second look at a block that
was meant to be used once. Do not. A supplementary run, on a fresh block,
with a subset of policies, takes a tag so it can never be mistaken for the
comparison:

    python scripts/phase4_experiment.py --block test3 --policies P2,P2-reactiveMode --tag reactive-fix
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
from continua_engine.experiments.__main__ import PHASE4_SCENARIOS, headline  # noqa: E402


def index_path(tag: str | None) -> Path:
    name = "phase4_index.json" if not tag else f"phase4_index_{tag}.json"
    return ROOT / "data" / "experiments" / name


def _run_scenario(args: tuple[str, int, str, tuple[str, ...], str | None]) -> dict:
    scenario_id, trials, block, policy_ids, tag = args
    from continua_engine.experiments.runner import DEFAULT_POLICIES, run_comparison
    from continua_engine.store.store import RunStore

    policies = tuple(PolicyId(p) for p in policy_ids) if policy_ids else DEFAULT_POLICIES
    store = RunStore(ROOT / "data" / "runs")
    started = time.time()
    summary = run_comparison(
        scenario_id=scenario_id,
        trials=trials,
        policies=policies,
        block=block,
        store=store,
        experiment_id=f"phase4-{tag + '-' if tag else ''}{block}-{scenario_id}",
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trials", type=int, default=20)
    parser.add_argument("--block", default="test2")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--policies", default="", help="comma-separated subset; default every policy")
    parser.add_argument("--tag", default=None, help="names a supplementary run; required with --policies")
    args = parser.parse_args()

    policy_ids = tuple(p.strip() for p in args.policies.split(",") if p.strip())
    if policy_ids and not args.tag:
        raise SystemExit("a policy subset is a supplementary run and needs --tag")
    out = index_path(args.tag)
    if out.exists():
        raise SystemExit(
            f"{out.relative_to(ROOT)} already exists: this comparison was already run. "
            "It runs once; delete the index deliberately if you really mean to redo it."
        )

    print(
        f"Phase 4 {'supplementary run ' + args.tag if args.tag else 'comparison'}: "
        f"{len(PHASE4_SCENARIOS)} scenarios x {args.trials} paired trials x "
        f"{', '.join(policy_ids) if policy_ids else 'every policy'}, seed block {args.block}"
    )
    started = time.time()
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        results = list(
            pool.map(
                _run_scenario,
                [(s, args.trials, args.block, policy_ids, args.tag) for s in PHASE4_SCENARIOS],
            )
        )

    for entry in results:
        print(f"\n=== {entry['scenario_id']} · experiment {entry['experiment_id']} · {entry['elapsed_s']}s")
        if entry["failures"]:
            print(f"  ! {len(entry['failures'])} failed runs")
            for failure in entry["failures"][:5]:
                print(f"    {failure}")
        headline(entry["summary"])

    index = [{k: v for k, v in entry.items() if k != "summary"} for entry in results]
    out.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "tag": args.tag,
                "block": args.block,
                "trials": args.trials,
                "policies": list(policy_ids) or "all",
                "scenarios": list(PHASE4_SCENARIOS),
                "elapsed_s": round(time.time() - started, 1),
                "experiments": index,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nindex -> {out.relative_to(ROOT)}  ({time.time() - started:.0f}s)")


if __name__ == "__main__":
    main()
