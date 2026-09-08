"""
The exogenous trace: everything about the world that the controller cannot change.

This is the single most important idea in the whole experiment design. Link
quality, competing background demand and burst-loss state are generated **once**
per (scenario, seed) and are completely independent of which policy is running.
Every policy under comparison is then replayed against byte-identical
conditions, which is what makes the trials paired.

The controller is never given this object. It only ever sees statistics derived
from packets that were actually delivered, acknowledged or timed out — so it
cannot see a fault coming except through the same signals a real system would
have.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..contracts import ALL_LINKS, LinkId
from ..world import Coverage, MotionProfile, Route

SCENARIO_DIR = Path(__file__).resolve().parent.parent / "scenarios"


@lru_cache(maxsize=1)
def link_profiles() -> dict:
    with (SCENARIO_DIR / "link_profiles.json").open("r", encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def scenario_catalogue() -> dict[str, dict]:
    with (SCENARIO_DIR / "scenarios.json").open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return {entry["id"]: entry for entry in data["scenarios"]}


def get_scenario(scenario_id: str) -> dict:
    catalogue = scenario_catalogue()
    if scenario_id not in catalogue:
        raise KeyError(f"unknown scenario '{scenario_id}'; known: {sorted(catalogue)}")
    # Return a copy: scenario specs are immutable, overrides never mutate them.
    return json.loads(json.dumps(catalogue[scenario_id]))


# ---------------------------------------------------------------------------


@dataclass(slots=True)
class ExogenousTrace:
    """Pre-computed world conditions, sampled at `dt`."""

    dt: float
    steps: int
    duration_s: float
    scenario_id: str
    seed: int
    links: tuple[LinkId, ...]
    #: quality[link] -> array of modelled coverage 0..1 after faults are applied
    quality: dict[LinkId, np.ndarray]
    #: raw geometric coverage before faults, kept for the scene and for analysis
    geometric: dict[LinkId, np.ndarray]
    #: background[link] -> fraction of capacity consumed by competing demand
    background: dict[LinkId, np.ndarray]
    #: burst[link] -> boolean array, True while the path is in a lossy burst
    burst: dict[LinkId, np.ndarray]
    #: jitter[link] -> pre-drawn unit-normal noise, scaled at use time
    jitter_noise: dict[LinkId, np.ndarray]
    #: loss_roll[link] -> pre-drawn uniforms for per-packet loss decisions
    loss_roll: dict[LinkId, np.ndarray]
    #: vehicle motion, sampled per step
    distance_m: np.ndarray
    speed_mps: np.ndarray
    pos_x: np.ndarray
    pos_z: np.ndarray
    heading: np.ndarray
    zone: list[str]

    def index_at(self, t: float) -> int:
        return min(max(int(t / self.dt), 0), self.steps - 1)


def _fault_multiplier(spec: dict, t: float) -> float:
    """1.0 = untouched, 0.0 = fully suppressed. Ramps linearly then holds."""
    start = float(spec["start_s"])
    ramp = max(float(spec.get("ramp_s", 0.0)), 1e-6)
    duration = float(spec["duration_s"])
    severity = float(spec.get("severity", 1.0))
    if t < start:
        return 1.0
    if t >= start + duration:
        return 1.0
    progress = min((t - start) / ramp, 1.0)
    return 1.0 - severity * progress


def _background_load(spec: dict, t: float) -> float:
    start = float(spec["start_s"])
    ramp = max(float(spec.get("ramp_s", 0.0)), 1e-6)
    duration = float(spec["duration_s"])
    load = float(spec["load"])
    if t < start or t >= start + duration:
        return 0.0
    return load * min((t - start) / ramp, 1.0)


def build_trace(
    scenario: dict,
    seed: int,
    dt: float = 0.02,
    route: Route | None = None,
    coverage: Coverage | None = None,
) -> ExogenousTrace:
    """Generate the exogenous trace for one (scenario, seed).

    Uses independent RNG streams per concern so that adding, say, a background
    load to a scenario does not shift the burst-loss draws — otherwise two
    scenarios that should differ in one dimension would differ in all of them.
    """
    route = route or Route()
    coverage = coverage or Coverage()

    duration = float(scenario["duration_s"])
    steps = int(round(duration / dt)) + 1
    links = tuple(LinkId(link) for link in scenario["links"])

    motion = MotionProfile(
        route,
        speed_scale=float(scenario.get("speed_scale", 1.0)),
        reverse=bool(scenario.get("reverse", False)),
    )

    profiles = link_profiles()["profiles"]

    # --- vehicle motion -----------------------------------------------------
    distance = np.zeros(steps)
    speed = np.zeros(steps)
    pos_x = np.zeros(steps)
    pos_z = np.zeros(steps)
    heading = np.zeros(steps)
    zone: list[str] = []
    for i in range(steps):
        t = i * dt
        sample, v = motion.sample_at(t)
        distance[i] = motion.distance_at(t)
        speed[i] = v
        pos_x[i] = sample.x
        pos_z[i] = sample.z
        heading[i] = sample.heading
        zone.append(coverage.zone_at_x(sample.x))

    # --- geometric coverage -------------------------------------------------
    geometric: dict[LinkId, np.ndarray] = {}
    for link in ALL_LINKS:
        values = np.zeros(steps)
        for i in range(steps):
            values[i] = coverage.at(link, pos_x[i], pos_z[i])
        geometric[link] = values

    # --- faults and background ---------------------------------------------
    quality: dict[LinkId, np.ndarray] = {}
    background: dict[LinkId, np.ndarray] = {}
    for link in ALL_LINKS:
        q = geometric[link].copy() if link in links else np.zeros(steps)
        for fault in scenario.get("faults", []):
            if LinkId(fault["link"]) is not link:
                continue
            for i in range(steps):
                q[i] *= _fault_multiplier(fault, i * dt)
        quality[link] = np.clip(q, 0.0, 1.0)

        bg = np.zeros(steps)
        for load in scenario.get("background", []):
            if LinkId(load["link"]) is not link:
                continue
            for i in range(steps):
                bg[i] = max(bg[i], _background_load(load, i * dt))
        background[link] = np.clip(bg, 0.0, 0.98)

    # --- stochastic streams, one generator per link per concern -------------
    burst: dict[LinkId, np.ndarray] = {}
    jitter_noise: dict[LinkId, np.ndarray] = {}
    loss_roll: dict[LinkId, np.ndarray] = {}
    for offset, link in enumerate(ALL_LINKS):
        params = profiles[link.value]["burst_loss"]
        gen_burst = np.random.default_rng([seed, 101, offset])
        gen_jitter = np.random.default_rng([seed, 202, offset])
        gen_loss = np.random.default_rng([seed, 303, offset])

        # Gilbert-Elliott: a two-state chain producing correlated loss bursts.
        # Bad-state entry probability scales with how poor the link currently is,
        # so a degrading path gets burstier as well as lossier.
        state = np.zeros(steps, dtype=bool)
        in_bad = False
        rolls = gen_burst.random(steps)
        for i in range(steps):
            poor = 1.0 - quality[link][i]
            if in_bad:
                if rolls[i] < params["p_exit"] * (0.35 + 0.65 * quality[link][i]):
                    in_bad = False
            else:
                if rolls[i] < params["p_enter"] * (1.0 + 9.0 * poor * poor):
                    in_bad = True
            state[i] = in_bad
        burst[link] = state

        jitter_noise[link] = gen_jitter.standard_normal(steps)
        # Generous pool: one uniform per potential packet transmission.
        loss_roll[link] = gen_loss.random(max(steps * 24, 4096))

    return ExogenousTrace(
        dt=dt,
        steps=steps,
        duration_s=duration,
        scenario_id=scenario["id"],
        seed=seed,
        links=links,
        quality=quality,
        geometric=geometric,
        background=background,
        burst=burst,
        jitter_noise=jitter_noise,
        loss_roll=loss_roll,
        distance_m=distance,
        speed_mps=speed,
        pos_x=pos_x,
        pos_z=pos_z,
        heading=heading,
        zone=zone,
    )


def apply_overrides(scenario: dict, overrides: dict | None) -> dict:
    """Apply validated Scenario Lab overrides to a scenario copy.

    Overrides never mutate the catalogue, and the resulting spec is hashed into
    the run record so a lab run is as reproducible as a catalogue one.
    """
    if not overrides:
        return scenario
    spec = json.loads(json.dumps(scenario))
    if overrides.get("duration_s"):
        spec["duration_s"] = float(overrides["duration_s"])
    if overrides.get("speed_scale"):
        spec["speed_scale"] = float(overrides["speed_scale"])
    if overrides.get("workload"):
        enabled = [name for name, on in overrides["workload"].items() if on]
        if enabled:
            spec["workload"] = enabled
    if overrides.get("inject_fault"):
        spec.setdefault("faults", []).append(
            {
                "link": overrides["inject_fault"],
                "kind": "outage",
                "start_s": float(overrides.get("inject_fault_at_s") or 30.0),
                "ramp_s": 0.3,
                "duration_s": float(overrides.get("inject_fault_duration_s") or 12.0),
                "severity": 1.0,
            }
        )
    if overrides.get("congest_link"):
        spec.setdefault("background", []).append(
            {
                "link": overrides["congest_link"],
                "start_s": 20.0,
                "ramp_s": 3.0,
                "duration_s": max(float(spec["duration_s"]) - 25.0, 5.0),
                "load": 1.0 - float(overrides.get("congest_factor") or 0.3),
            }
        )
    spec["id"] = f"{scenario['id']}+lab"
    spec["title"] = f"{scenario['title']} (lab)"
    return spec
