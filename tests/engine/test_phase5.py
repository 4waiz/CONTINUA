# Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE.
# KS-CONTINUA-713CCF488A8D
"""
Phase 5: route-aware preparation (P3) and the radio map.

What these tests hold the code to:

* a route-anchored shadow is at the same place on the route forward, fast and
  reversed - it is terrain, not a moment;
* the radio map is built from survey drives in the train block, from
  observations, and says where each link was lost;
* P3 is P1 plus one flag, holds no trace, and on the open route behaves
  exactly as P1 does;
* on the shadowed route P3 keeps the session through the cutting that costs
  P1 a reconnect.

Seeds here are below every experiment block, as in test_engine.py.
"""

from __future__ import annotations

import json
import sys
from dataclasses import fields
from pathlib import Path

import pytest

ENGINE_ROOT = Path(__file__).resolve().parents[2] / "services" / "engine"
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from continua_engine.contracts import LinkId, PolicyId  # noqa: E402
from continua_engine.controller.controller import POLICY_LIBRARY  # noqa: E402
from continua_engine.controller.radio_map import MAP_VERSION, MissionPlan, RadioMap, map_path  # noqa: E402
from continua_engine.experiments.runner import SEED_BLOCKS  # noqa: E402
from continua_engine.sim.exogenous import build_trace, get_scenario  # noqa: E402
from continua_engine.sim.simulator import Simulation  # noqa: E402
from continua_engine.world import Route  # noqa: E402

CUTTING = (235.0, 275.0)


def _quality_in_cutting(scenario_id: str) -> tuple[list[float], list[float]]:
    """Wi-Fi and cellular quality at every step the vehicle is inside the cutting."""
    scenario = get_scenario(scenario_id)
    trace = build_trace(scenario, seed=3)
    length = Route().length
    reverse = bool(scenario.get("reverse", False))
    times: list[float] = []
    values: list[float] = []
    for i in range(trace.steps):
        along = length - trace.distance_m[i] if reverse else trace.distance_m[i]
        if CUTTING[0] + 1 <= along <= CUTTING[1] - 1:
            times.append(i * trace.dt)
            values.append(max(trace.quality[LinkId.WIFI][i], trace.quality[LinkId.CELLULAR][i]))
    return times, values


def test_shadows_are_anchored_to_the_route_not_the_clock():
    forward_t, forward_q = _quality_in_cutting("shadow-survey")
    fast_t, fast_q = _quality_in_cutting("shadow-fast")
    reverse_t, reverse_q = _quality_in_cutting("shadow-reverse")
    for values in (forward_q, fast_q, reverse_q):
        assert values and max(values) == 0.0, "Wi-Fi and the cell must both be out inside the cutting"
    # The same place, met at different times.
    assert fast_t[0] < forward_t[0] < reverse_t[0]


def test_original_scenarios_have_no_route_anchored_faults():
    for scenario_id in ("baseline-journey", "wifi-degradation", "sudden-failure", "cellular-congestion",
                        "satellite-fallback", "flapping", "total-loss", "fast-run", "reverse-run"):
        kinds = {fault.get("kind") for fault in get_scenario(scenario_id).get("faults", [])}
        assert "shadow" not in kinds


def test_radio_map_is_a_train_block_survey_of_observations():
    for survey in ("baseline-journey", "shadow-survey"):
        blob = json.loads(map_path(survey).read_text(encoding="utf-8"))
        assert blob["version"] == MAP_VERSION
        assert blob["seed_block"] == "train"
        train = SEED_BLOCKS["train"]
        tune = SEED_BLOCKS["tune"]
        assert all(train <= seed < tune for seed in blob["seeds"]), "survey seeds must come from the train block"
        assert "phase" in blob["observed"] and "coverage" in blob["observed"]
        assert set(blob["links"]) == {link.value for link in LinkId}
        assert set(blob["links"]["wifi"]) == {"unusable_share", "mean_coverage"}


def test_radio_map_shows_the_cutting_only_on_the_shadowed_route():
    shadowed = RadioMap.load("shadow-survey")
    open_route = RadioMap.load("baseline-journey")
    assert shadowed is not None and open_route is not None
    middle = sum(CUTTING) / 2
    for link in (LinkId.WIFI, LinkId.CELLULAR):
        span = shadowed.lost_span(link, middle)
        assert span is not None and span[0] <= CUTTING[0] + 5 and span[1] >= CUTTING[1] - 5
        assert open_route.lost_span(link, middle) is None
    assert shadowed.lost_span(LinkId.SATELLITE, middle) is None


def test_mission_plan_looks_ahead_in_the_direction_of_travel():
    forward = MissionPlan(length_m=900.0, reverse=False)
    backward = MissionPlan(length_m=900.0, reverse=True)
    assert forward.ahead(100.0, 50.0) == (100.0, 150.0)
    assert backward.ahead(100.0, 50.0) == (750.0, 800.0)


def test_p3_is_p1_plus_route_preparation_only():
    p1 = POLICY_LIBRARY[PolicyId.P1_CONTINUA]
    p3 = POLICY_LIBRARY[PolicyId.P3_ROUTE]
    different = {f.name for f in fields(p1) if getattr(p1, f.name) != getattr(p3, f.name)}
    assert different == {"policy_id", "route_prepare"}
    assert p3.route_prepare is True
    assert all(not config.route_prepare for pid, config in POLICY_LIBRARY.items() if pid is not PolicyId.P3_ROUTE)


def test_route_aware_controller_never_receives_the_trace():
    sim = Simulation(get_scenario("shadow-survey"), seed=3, policy_id=PolicyId.P3_ROUTE)
    controller = sim.controller
    assert controller.radio_map is not None and controller.mission is not None
    for attribute in vars(controller):
        value = getattr(controller, attribute)
        assert not hasattr(value, "quality"), f"controller.{attribute} exposes the exogenous trace"
    for attribute in ("radio_map", "mission"):
        holder = getattr(controller, attribute)
        names = holder.__slots__ if hasattr(holder, "__slots__") else vars(holder)
        for name in names:
            assert not hasattr(getattr(holder, name), "quality"), f"{attribute}.{name} exposes the trace"


def test_other_policies_are_given_no_map():
    sim = Simulation(get_scenario("shadow-survey"), seed=3, policy_id=PolicyId.P1_CONTINUA)
    assert sim.controller.radio_map is None and sim.controller.mission is None


@pytest.mark.parametrize("scenario_id", ["baseline-journey", "sudden-failure"])
def test_p3_matches_p1_exactly_on_the_open_route(scenario_id: str):
    p1 = Simulation(get_scenario(scenario_id), seed=3, policy_id=PolicyId.P1_CONTINUA).run()
    p3 = Simulation(get_scenario(scenario_id), seed=3, policy_id=PolicyId.P3_ROUTE).run()
    assert p3.metrics["control_plane"]["route_prearms"] == 0
    for section in ("continuity", "application", "links"):
        assert p3.metrics[section] == p1.metrics[section], section
    assert [(e.t, e.carrying, e.reason) for e in p3.events] == [(e.t, e.carrying, e.reason) for e in p1.events]


def test_p3_keeps_the_session_through_the_cutting():
    p1 = Simulation(get_scenario("shadow-survey"), seed=3, policy_id=PolicyId.P1_CONTINUA).run()
    p3 = Simulation(get_scenario("shadow-survey"), seed=3, policy_id=PolicyId.P3_ROUTE).run()
    assert p1.metrics["continuity"]["session_reconnects"] >= 1
    assert p1.metrics["continuity"]["longest_interruption_s"] > 3.0
    assert p3.metrics["continuity"]["session_reconnects"] == 0
    assert p3.metrics["continuity"]["longest_interruption_s"] < 1.0
    assert p3.metrics["control_plane"]["route_prearms"] >= 1
    prepared = [e for e in p3.events if e.reason.startswith("Preparing satellite ahead of a known gap")]
    assert prepared, "the decision log must say why satellite was prepared"
