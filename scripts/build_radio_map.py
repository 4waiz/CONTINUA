"""
Build a radio map from survey drives (Phase 5).

    python scripts/build_radio_map.py                     # every survey below
    python scripts/build_radio_map.py --survey shadow-survey --drives 10

A fleet learns where each network drops out by driving the route. This script
does the same: it drives a survey scenario on seeds from the `train` block -
never `tune`, never a test block - and records, at every 20 ms step, what the
controller itself observed: each link's phase (unavailable or not) and its
reported coverage, with the vehicle's progress along its planned route. Those
observations are binned by route position and written to
`services/engine/continua_engine/models/radio_map-<survey>.json`, with the
seeds, the policy that drove and the commit, so the map can be rebuilt.

It reads observations only. The exogenous trace is never opened here; the
controller wrapper below sees exactly the arguments the controller is called
with, and nothing else.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "engine"))

from continua_engine.contracts import ALL_LINKS, ExecutionMode, LinkPhase, PolicyId  # noqa: E402
from continua_engine.controller.radio_map import MAP_VERSION, MissionPlan, map_path  # noqa: E402
from continua_engine.experiments.runner import seed_for  # noqa: E402
from continua_engine.sim.exogenous import get_scenario  # noqa: E402
from continua_engine.sim.simulator import Simulation  # noqa: E402
from continua_engine.store.store import code_commit  # noqa: E402
from continua_engine.world import Route  # noqa: E402

#: The surveys, one per world: the open route the original scenarios share,
#: and the shadowed route of the Phase 5 family.
SURVEYS = ("baseline-journey", "shadow-survey")
#: Survey drives use the policy that changes nothing about what is observed:
#: phase and reported coverage do not depend on which path carries traffic.
SURVEY_POLICY = PolicyId.P1_NO_PREDICTION
BIN_M = 5.0


def survey(survey_id: str, drives: int) -> dict:
    scenario = get_scenario(survey_id)
    length = Route().length
    mission = MissionPlan(length_m=length, reverse=bool(scenario.get("reverse", False)))
    bins = int(length // BIN_M) + 1
    seen = {link: [0] * bins for link in ALL_LINKS}
    unusable = {link: [0] * bins for link in ALL_LINKS}
    coverage = {link: [0.0] * bins for link in ALL_LINKS}
    seeds = [seed_for("train", i) for i in range(drives)]

    for seed in seeds:
        sim = Simulation(scenario, seed=seed, policy_id=SURVEY_POLICY, mode=ExecutionMode.SIMULATION)
        decide = sim.controller.decide

        def record(t, observations, app, vehicle, _decide=decide):
            if vehicle is not None:
                index = min(max(int(mission.route_coordinate(vehicle.distance_m) // BIN_M), 0), bins - 1)
                for link, obs in observations.items():
                    seen[link][index] += 1
                    if obs.phase is LinkPhase.UNAVAILABLE:
                        unusable[link][index] += 1
                    coverage[link][index] += obs.modelled_coverage or 0.0
            return _decide(t, observations, app, vehicle)

        sim.controller.decide = record
        sim.run()

    links: dict[str, dict] = {}
    for link in ALL_LINKS:
        share: list[float | None] = [
            unusable[link][i] / seen[link][i] if seen[link][i] else None for i in range(bins)
        ]
        mean: list[float | None] = [
            coverage[link][i] / seen[link][i] if seen[link][i] else None for i in range(bins)
        ]
        links[link.value] = {
            "unusable_share": [round(v, 4) for v in _fill(share)],
            "mean_coverage": [round(v, 4) for v in _fill(mean)],
        }
    return {
        "version": MAP_VERSION,
        "survey_scenario": survey_id,
        "seed_block": "train",
        "seeds": seeds,
        "survey_policy": SURVEY_POLICY.value,
        "observed": "each link's phase (unavailable or not) and reported coverage, per 20 ms step, "
        "binned by the vehicle's position along its planned route",
        "bin_m": BIN_M,
        "length_m": round(length, 3),
        "code_commit": code_commit(),
        "links": links,
    }


def _fill(values: list[float | None]) -> list[float]:
    """A bin no survey sample landed in takes its nearest neighbour's value."""
    known = [i for i, v in enumerate(values) if v is not None]
    if not known:
        return [0.0] * len(values)
    out: list[float] = []
    for i, value in enumerate(values):
        if value is not None:
            out.append(value)
            continue
        nearest = min(known, key=lambda k: abs(k - i))
        out.append(values[nearest])  # type: ignore[arg-type]
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--survey", choices=SURVEYS, action="append")
    parser.add_argument("--drives", type=int, default=10)
    args = parser.parse_args()
    for survey_id in args.survey or SURVEYS:
        blob = survey(survey_id, args.drives)
        path = map_path(survey_id)
        path.write_text(json.dumps(blob, indent=1) + "\n", encoding="utf-8", newline="\n")
        print(f"{survey_id}: {len(blob['seeds'])} drives -> {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
