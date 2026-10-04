#!/usr/bin/env python3
"""
Phase 5, step 1: how much could prediction buy at all? (tune block only)

Phase 2 and Phase 4 both found that the trend predictor does not pay for
itself. Before building another predictor, this measures the ceiling: in
every step of a run it asks whether the carrying path was already in its
lossy tail (modelled quality below 0.95) while another path was activated,
validated and clean (0.95 or better). Those are the only steps in which an
earlier switch - the thing a better forecast would have bought - could have
put traffic on a better path. Deadline misses and video stall that land in
them are the most any predictor could have saved by switching sooner.

This is an analyst, not a controller: it reads the trace's modelled quality to
label the steps. Nothing here feeds a policy.

It also records the interruption each policy suffered, because the other
thing foresight can buy is a path prepared before it is needed - which only
matters when the path the policy keeps warm anyway fails too.

    python scripts/phase5_headroom.py              # writes data/experiments/phase5_headroom.json
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "engine"))

from continua_engine.contracts import ALL_LINKS, ExecutionMode, PolicyId, TrafficClass  # noqa: E402
from continua_engine.experiments.metrics import compute_metrics  # noqa: E402
from continua_engine.experiments.runner import seed_for  # noqa: E402
from continua_engine.sim.exogenous import get_scenario  # noqa: E402
from continua_engine.sim.simulator import Simulation  # noqa: E402
from continua_engine.store.store import code_commit  # noqa: E402

SCENARIOS = ("baseline-journey", "wifi-degradation", "sudden-failure", "cellular-congestion",
             "satellite-fallback", "flapping", "total-loss", "fast-run", "reverse-run", "shadow-survey")
POLICIES = (PolicyId.P1_NO_PREDICTION, PolicyId.P1_CONTINUA)
TRIALS = 5
LOSSY = 0.95
OUT = ROOT / "data" / "experiments" / "phase5_headroom.json"


def measure(scenario_id: str, policy: PolicyId, seed: int) -> dict:
    sim = Simulation(get_scenario(scenario_id), seed=seed, policy_id=policy, mode=ExecutionMode.SIMULATION)
    receivers = sim.plant.receivers
    classes = [c for c in (TrafficClass.CONTROL, TrafficClass.TELEMETRY, TrafficClass.VOICE) if c in receivers]
    video = receivers.get(TrafficClass.VIDEO)
    previous = {c: receivers[c].deadline_misses for c in classes}
    previous_stall = video.stall_ms if video else 0.0
    total: dict[str, float] = defaultdict(float)
    avoidable: dict[str, float] = defaultdict(float)
    avoidable_steps = 0
    while not sim.finished:
        sim.step()
        index = min(sim.step_index - 1, sim.trace.steps - 1)
        decision = sim.last_decision
        carrying = decision.carrying if decision else None
        clean_alternative = False
        if carrying is not None and float(sim.trace.quality[carrying][index]) < LOSSY:
            clean_alternative = any(
                link is not carrying
                and sim.paths[link].carrying_ready
                and float(sim.trace.quality[link][index]) >= LOSSY
                for link in ALL_LINKS
            )
        avoidable_steps += clean_alternative
        for cls in classes:
            delta = receivers[cls].deadline_misses - previous[cls]
            previous[cls] = receivers[cls].deadline_misses
            total[cls.value] += delta
            if clean_alternative:
                avoidable[cls.value] += delta
        if video is not None:
            delta = video.stall_ms - previous_stall
            previous_stall = video.stall_ms
            total["video_stall_ms"] += delta
            if clean_alternative:
                avoidable["video_stall_ms"] += delta
    metrics = compute_metrics(sim)
    return {
        "total": dict(total),
        "avoidable": dict(avoidable),
        "avoidable_s": round(avoidable_steps * sim.dt, 3),
        "total_interruption_s": metrics["continuity"]["total_interruption_s"],
        "session_reconnects": metrics["continuity"]["session_reconnects"],
    }


def main() -> None:
    seeds = [seed_for("tune", i) for i in range(TRIALS)]
    result: dict[str, dict] = {}
    for scenario_id in SCENARIOS:
        result[scenario_id] = {}
        print(f"\n{scenario_id}")
        for policy in POLICIES:
            runs = [measure(scenario_id, policy, seed) for seed in seeds]
            keys = sorted({k for run in runs for k in run["total"]})
            row = {
                "avoidable_s": round(sum(r["avoidable_s"] for r in runs) / len(runs), 3),
                "total_interruption_s": round(sum(r["total_interruption_s"] for r in runs) / len(runs), 3),
                "session_reconnects": round(sum(r["session_reconnects"] for r in runs) / len(runs), 3),
                "classes": {},
            }
            for key in keys:
                tot = sum(r["total"].get(key, 0.0) for r in runs) / len(runs)
                avo = sum(r["avoidable"].get(key, 0.0) for r in runs) / len(runs)
                row["classes"][key] = {
                    "total": round(tot, 2),
                    "avoidable": round(avo, 2),
                    "avoidable_share_pct": round(100.0 * avo / tot, 2) if tot else None,
                }
            result[scenario_id][policy.value] = row
            shares = ", ".join(
                f"{k} {v['avoidable_share_pct']}%" for k, v in row["classes"].items()
            )
            print(f"  {policy.value:<10} lossy-tail steps with a clean ready path {row['avoidable_s']:5.2f} s | "
                  f"avoidable share: {shares} | interruption {row['total_interruption_s']} s")
    OUT.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "seed_block": "tune",
                "seeds": seeds,
                "lossy_below": LOSSY,
                "definition": "a step is avoidable when the carrying path's modelled quality is below "
                f"{LOSSY} while another path is activated, validated and at or above {LOSSY}",
                "code_commit": code_commit(),
                "scenarios": result,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\n-> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
