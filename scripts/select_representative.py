#!/usr/bin/env python3
"""
Pick the representative trial for the demo video.

**The rule, fixed before looking at any result:**

    For a given scenario, take the completed 20-trial experiment on the `test`
    seed block. Rank the CONTINUA (P1) trials by the primary metric for that
    scenario. Choose the trial at the MEDIAN - the lower-median when the count
    is even. Never the best.

Using the median is the whole point. Picking the best-looking run would make
the video an advertisement for an outlier; the median is what a viewer should
expect a typical run to look like, and the aggregate figures shown in the
results section describe the whole distribution rather than this one trial.

Output is written to `video/representative.json` so the capture and build
scripts, and `docs/VIDEO_CLAIMS.md`, all read the same decision.
"""

from __future__ import annotations

import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPERIMENTS = ROOT / "data" / "experiments"
OUTPUT = ROOT / "video" / "representative.json"

#: Primary metric per scenario, chosen for what that scenario is designed to
#: exercise. Declared here so the choice is visible rather than implicit.
PRIMARY = {
    "wifi-degradation": ("continuity", "total_interruption_s"),
    "cellular-congestion": ("application", "control", "deadline_miss_pct"),
    "satellite-fallback": ("application", "control", "deadline_miss_pct"),
    "sudden-failure": ("continuity", "total_interruption_s"),
    "flapping": ("control_plane", "handovers"),
    "total-loss": ("continuity", "outage_s"),
}


def dig(run: dict, path: tuple[str, ...]):
    node = run
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    return node if isinstance(node, (int, float)) and not isinstance(node, bool) else None


def load_experiments() -> list[dict]:
    out = []
    for path in sorted(EXPERIMENTS.glob("exp-*.json")):
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            continue
    return out


def pick(scenario_id: str, experiments: list[dict]) -> dict | None:
    candidates = [
        e
        for e in experiments
        if e["scenario_id"] == scenario_id
        and e["trials_requested"] >= 20
        and e["seed_block"] == "test"
        and e.get("predictor") == "heuristic"
        and "P1" in e.get("raw", {})
    ]
    if not candidates:
        return None
    experiment = max(candidates, key=lambda e: len(e["raw"]["P1"]))
    path = PRIMARY.get(scenario_id, ("continuity", "total_interruption_s"))

    scored = []
    for run in experiment["raw"]["P1"]:
        value = dig(run, path)
        if value is None:
            continue
        scored.append((value, run["trial"], run["seed"]))
    if not scored:
        return None
    scored.sort()
    # Lower median: index (n-1)//2. Deterministic for even counts.
    median_index = (len(scored) - 1) // 2
    value, trial, seed = scored[median_index]

    return {
        "scenario_id": scenario_id,
        "experiment_id": experiment["experiment_id"],
        "primary_metric": ".".join(path),
        "selection_rule": "lower-median P1 trial by the primary metric; never the best",
        "trials_considered": len(scored),
        "chosen_trial": trial,
        "chosen_seed": seed,
        "chosen_value": round(value, 4),
        "distribution": {
            "min": round(scored[0][0], 4),
            "median": round(value, 4),
            "max": round(scored[-1][0], 4),
            "mean": round(statistics.fmean(v for v, _t, _s in scored), 4),
        },
        "code_commit": experiment.get("code_commit"),
        "seeds": experiment["seeds"],
    }


def main() -> None:
    experiments = load_experiments()
    selections = {}
    for scenario_id in ("wifi-degradation", "satellite-fallback", "cellular-congestion"):
        chosen = pick(scenario_id, experiments)
        if chosen:
            selections[scenario_id] = chosen

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({"rule": __doc__.strip(), "selections": selections}, indent=2), encoding="utf-8")
    print(f"wrote {OUTPUT}")
    for scenario_id, entry in selections.items():
        print(
            f"\n{scenario_id}: trial {entry['chosen_trial']} seed {entry['chosen_seed']} "
            f"({entry['primary_metric']} = {entry['chosen_value']})"
        )
        print(f"  distribution {entry['distribution']}")


if __name__ == "__main__":
    main()
