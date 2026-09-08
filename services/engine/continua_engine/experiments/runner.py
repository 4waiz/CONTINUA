"""
Paired-trial experiment runner.

For each trial index `i`, a seed is derived once and **every policy runs against
that same seed**. Because the exogenous trace is generated from the seed alone
and never from the policy, all policies in a trial face byte-identical link
conditions, background demand and burst-loss draws. Differences between them are
therefore differences in policy, not in luck.

The runner never inspects results while choosing seeds, and the final test seed
block is disjoint from the block used for model training and tuning.
"""

from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Sequence

from ..contracts import ExecutionMode, PolicyId, RunStatus
from ..sim.exogenous import apply_overrides, get_scenario
from ..sim.simulator import Simulation
from ..store.store import RunStore, code_commit, default_store
from .metrics import aggregate

#: Seeds are drawn from disjoint blocks so a model tuned on `train` can never
#: have been fitted to the data the final comparison is scored on.
SEED_BLOCKS = {
    "train": 10_000,
    "tune": 40_000,
    "test": 70_000,
}

DEFAULT_POLICIES: tuple[PolicyId, ...] = (
    PolicyId.B0_SINGLE_REACTIVE,
    PolicyId.B1_REACTIVE_MULTIPATH,
    PolicyId.B2_ALWAYS_REDUNDANT,
    PolicyId.P1_CONTINUA,
    PolicyId.P1_NO_PREDICTION,
    PolicyId.P1_NO_APP_PRIORITY,
)


def seed_for(block: str, trial: int) -> int:
    if block not in SEED_BLOCKS:
        raise ValueError(f"unknown seed block '{block}'; known: {sorted(SEED_BLOCKS)}")
    return SEED_BLOCKS[block] + trial


def run_single(
    scenario_id: str,
    policy_id: PolicyId,
    seed: int,
    predictor: str = "heuristic",
    horizon_s: float = 3.0,
    overrides: dict | None = None,
    store: RunStore | None = None,
    persist: bool = True,
) -> dict:
    """Run one simulation and, optionally, persist everything about it."""
    scenario = apply_overrides(get_scenario(scenario_id), overrides)
    sim = Simulation(
        scenario,
        seed=seed,
        policy_id=policy_id,
        predictor_kind=predictor,
        horizon_s=horizon_s,
        mode=ExecutionMode.SIMULATION,
    )
    if persist:
        store = store or default_store()
        store.begin_run(
            run_id=sim.run_id,
            mode=ExecutionMode.SIMULATION,
            scenario=scenario,
            policy_id=policy_id,
            seed=seed,
            predictor=predictor,
            horizon_s=horizon_s,
            engine_version=sim.events[0].schema_version if sim.events else "2.0.0",
        )
    started = time.time()
    result = sim.run()
    wall = time.time() - started
    if persist and store is not None:
        store.write_events(sim.run_id, result.events)
        store.finish_run(
            sim.run_id,
            RunStatus.COMPLETED,
            duration_s=result.duration_s,
            event_count=len(result.events),
            metrics=result.metrics,
        )
    payload = dict(result.metrics)
    payload["wall_time_s"] = round(wall, 3)
    payload["events"] = len(result.events)
    return payload


def run_comparison(
    scenario_id: str,
    trials: int = 20,
    policies: Sequence[PolicyId] = DEFAULT_POLICIES,
    block: str = "test",
    predictor: str = "heuristic",
    horizon_s: float = 3.0,
    store: RunStore | None = None,
    persist_runs: bool = False,
    progress: Callable[[int, int, str], None] | None = None,
    experiment_id: str | None = None,
) -> dict:
    """Run `trials` paired trials of every policy on one scenario."""
    store = store or default_store()
    experiment_id = experiment_id or f"exp-{uuid.uuid4().hex[:10]}"
    started = datetime.now(timezone.utc).isoformat()
    per_policy: dict[str, list[dict]] = {policy.value: [] for policy in policies}

    total = trials * len(policies)
    done = 0
    failures: list[str] = []

    for trial in range(trials):
        seed = seed_for(block, trial)
        for policy in policies:
            try:
                metrics = run_single(
                    scenario_id,
                    policy,
                    seed,
                    predictor=predictor,
                    horizon_s=horizon_s,
                    store=store,
                    persist=persist_runs,
                )
                metrics["trial"] = trial
                per_policy[policy.value].append(metrics)
            except Exception as exc:  # noqa: BLE001 - recorded, never hidden
                failures.append(f"trial {trial} {policy.value}: {exc!r}")
            done += 1
            if progress:
                progress(done, total, f"{policy.value} trial {trial + 1}/{trials}")

    summary = {
        "experiment_id": experiment_id,
        "scenario_id": scenario_id,
        "seed_block": block,
        "seeds": [seed_for(block, i) for i in range(trials)],
        "trials_requested": trials,
        "trials_completed": {name: len(runs) for name, runs in per_policy.items()},
        "policies": [policy.value for policy in policies],
        "predictor": predictor,
        "horizon_s": horizon_s,
        "started_at": started,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "code_commit": code_commit(),
        "failures": failures,
        "aggregate": {name: aggregate(runs) for name, runs in per_policy.items()},
        "paired_deltas": _paired_deltas(per_policy),
        "raw": per_policy,
    }

    results_dir = store.root.parent / "experiments"
    results_dir.mkdir(parents=True, exist_ok=True)
    results_path = results_dir / f"{experiment_id}.json"
    results_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    store.record_experiment(
        experiment_id=experiment_id,
        scenario_id=scenario_id,
        trials=trials,
        policies=[p.value for p in policies],
        status="completed" if not failures else "completed_with_failures",
        completed=sum(len(v) for v in per_policy.values()),
        results_path=str(results_path),
    )
    return summary


def _paired_deltas(per_policy: dict[str, list[dict]]) -> dict:
    """Per-trial differences against each baseline, which is the point of pairing.

    Comparing means across policies throws away the pairing. Comparing the
    *same trial* run under two policies is far more sensitive, because the
    exogenous conditions are identical.
    """
    if PolicyId.P1_CONTINUA.value not in per_policy:
        return {}
    treatment = {run["trial"]: run for run in per_policy[PolicyId.P1_CONTINUA.value]}
    metrics_of_interest = [
        (["continuity", "total_interruption_s"], "total_interruption_s"),
        (["continuity", "session_reconnects"], "session_reconnects"),
        (["application", "control", "deadline_miss_pct"], "control_deadline_miss_pct"),
        (["application", "video", "stall_ms"], "video_stall_ms"),
        (["links", "satellite_bytes"], "satellite_bytes"),
        (["links", "cost_units"], "cost_units"),
        (["app_health_score"], "app_health_score"),
        (["control_plane", "handovers"], "handovers"),
    ]

    def dig(run: dict, path: list[str]):
        node = run
        for key in path:
            if not isinstance(node, dict) or key not in node:
                return None
            node = node[key]
        return node if isinstance(node, (int, float)) and not isinstance(node, bool) else None

    out: dict[str, dict] = {}
    for name, runs in per_policy.items():
        if name == PolicyId.P1_CONTINUA.value:
            continue
        deltas: dict[str, dict] = {}
        for path, label in metrics_of_interest:
            paired: list[float] = []
            for run in runs:
                other = treatment.get(run["trial"])
                if other is None:
                    continue
                a = dig(other, path)
                b = dig(run, path)
                if a is None or b is None:
                    continue
                paired.append(a - b)
            if paired:
                mean = sum(paired) / len(paired)
                wins = sum(1 for d in paired if d < 0)
                deltas[label] = {
                    "n_pairs": len(paired),
                    "mean_delta_p1_minus_baseline": round(mean, 4),
                    "p1_lower_in_pairs": wins,
                    "note": "negative means CONTINUA (P1) scored lower on this metric",
                }
        out[name] = deltas
    return out
