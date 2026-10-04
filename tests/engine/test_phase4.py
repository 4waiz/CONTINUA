"""
Phase 4 engine tests: per-class steering, mode handover, the B2-defer baseline
and the honesty metrics around them.

What these check, in the project's own terms: that the new mechanisms sit
behind flags and leave every older policy alone (the regression guard does the
byte-level version of that), that a class really is routed on the path the
controller named, that the mode machine downshifts on receiver facts and
upshifts only after a hold, that a mode change never touches the vehicle's
motion or the exogenous trace, and that the controller still sees nothing it
should not.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ENGINE_ROOT = Path(__file__).resolve().parents[2] / "services" / "engine"
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from continua_engine.contracts import (  # noqa: E402
    ALL_CLASSES,
    MODE_RANK,
    ActionKind,
    ControlMode,
    EngineEvent,
    LinkId,
    LinkPhase,
    PolicyId,
    TrafficClass,
)
from continua_engine.controller.controller import (  # noqa: E402
    POLICY_LIBRARY,
    ContinuaController,
    PolicyConfig,
)
from continua_engine.controller.modes import mode_supported, mode_table  # noqa: E402
from continua_engine.experiments.runner import (  # noqa: E402
    DEFAULT_POLICIES,
    PHASE2_POLICIES,
    SEED_BLOCKS,
    seed_for,
)
from continua_engine.sim.exogenous import build_trace, get_scenario, link_profiles  # noqa: E402
from continua_engine.sim.simulator import Simulation  # noqa: E402

PHASE4_POLICIES = (
    PolicyId.B2_ALWAYS_REDUNDANT_DEFER,
    PolicyId.P2_CONTINUA,
    PolicyId.P2_NO_STEER,
    PolicyId.P2_NO_MODE,
    PolicyId.P2_REACTIVE_MODE,
)


def run(scenario_id: str, policy: PolicyId = PolicyId.P2_CONTINUA, seed: int = 1, **kwargs):
    return Simulation(get_scenario(scenario_id), seed=seed, policy_id=policy, **kwargs).run()


def actions_of(result, kind: ActionKind):
    return [(event, action) for event in result.events for action in event.actions if action.kind is kind]


# ---------------------------------------------------------------------------
# Flags, policies and the library
# ---------------------------------------------------------------------------


def test_phase4_flags_default_off_on_every_phase2_policy():
    defaults = PolicyConfig(policy_id=PolicyId.P1_CONTINUA)
    assert defaults.per_class_steering is False
    assert defaults.mode_handover is False
    assert defaults.defer_bulk is False
    for policy_id in PHASE2_POLICIES:
        config = POLICY_LIBRARY[policy_id]
        assert config.per_class_steering is False, policy_id
        assert config.mode_handover is False, policy_id
        assert config.defer_bulk is False, policy_id


def test_new_policies_differ_from_p1_only_by_their_flags():
    p1 = POLICY_LIBRARY[PolicyId.P1_CONTINUA]
    expected = {
        PolicyId.P2_CONTINUA: {"per_class_steering": True, "mode_handover": True},
        PolicyId.P2_NO_STEER: {"mode_handover": True},
        PolicyId.P2_NO_MODE: {"per_class_steering": True},
        PolicyId.P2_REACTIVE_MODE: {
            "per_class_steering": True,
            "mode_handover": True,
            "anticipate_mode": False,
        },
    }
    for policy_id, flags in expected.items():
        config = POLICY_LIBRARY[policy_id]
        assert config.policy_id is policy_id
        for field in dataclasses.fields(PolicyConfig):
            if field.name == "policy_id":
                continue
            want = flags.get(field.name, getattr(p1, field.name))
            assert getattr(config, field.name) == want, f"{policy_id.value}.{field.name}"
    b2 = POLICY_LIBRARY[PolicyId.B2_ALWAYS_REDUNDANT]
    defer = POLICY_LIBRARY[PolicyId.B2_ALWAYS_REDUNDANT_DEFER]
    for field in dataclasses.fields(PolicyConfig):
        if field.name in ("policy_id", "defer_bulk"):
            continue
        assert getattr(defer, field.name) == getattr(b2, field.name), field.name
    assert defer.defer_bulk is True and defer.app_aware is False
    # One controller class for every policy, old and new.
    for policy_id in DEFAULT_POLICIES:
        assert type(ContinuaController(POLICY_LIBRARY[policy_id])) is ContinuaController
    assert set(PHASE4_POLICIES) <= set(DEFAULT_POLICIES)


def test_teleop_mode_repeats_the_base_control_parameters():
    control = link_profiles()["workload"]["control"]
    teleop = control["modes"]["teleop"]
    assert teleop["hz"] == control["hz"]
    assert teleop["packet_bytes"] == control["packet_bytes"]
    assert teleop["deadline_ms"] == control["deadline_ms"]
    waypoint = mode_table()[ControlMode.WAYPOINT]
    assert waypoint["deadline_ms"] > teleop["deadline_ms"]
    assert waypoint["hz"] < teleop["hz"]


# ---------------------------------------------------------------------------
# Determinism: B2 across process hash seeds
# ---------------------------------------------------------------------------


def _digest_code(policy: str, scenario: str, seed: int) -> str:
    return (
        "import sys, hashlib; sys.path.insert(0, %r)\n"
        "from continua_engine.contracts import PolicyId\n"
        "from continua_engine.sim.exogenous import get_scenario\n"
        "from continua_engine.sim.simulator import Simulation\n"
        "r = Simulation(get_scenario(%r), seed=%d, policy_id=PolicyId(%r)).run()\n"
        "h = hashlib.sha256()\n"
        "for e in r.events:\n"
        "    h.update(f'{e.t}|{e.controller_state.value}|{e.carrying}|{e.action.kind.value if e.action else None}|{e.reason}'.encode())\n"
        "print(h.hexdigest(), r.metrics['links']['bytes'])\n"
    ) % (str(ENGINE_ROOT), scenario, seed, policy)


@pytest.mark.parametrize("policy", ["B2", "P2"])
def test_runs_are_identical_across_process_hash_seeds(policy: str):
    """Set iteration over link enums once made B2 depend on PYTHONHASHSEED."""
    outputs = []
    for hash_seed in ("1", "2"):
        env = {**os.environ, "PYTHONHASHSEED": hash_seed}
        proc = subprocess.run(
            [sys.executable, "-c", _digest_code(policy, "wifi-degradation", 9)],
            capture_output=True,
            text=True,
            env=env,
            timeout=300,
            check=True,
        )
        outputs.append(proc.stdout.strip())
    assert outputs[0] == outputs[1], f"{policy} differs between hash seeds"


# ---------------------------------------------------------------------------
# B2-defer and the bulk-exclusive satellite metric
# ---------------------------------------------------------------------------


def test_b2_defer_adds_bulk_deferral_and_nothing_else():
    b2 = run("wifi-degradation", PolicyId.B2_ALWAYS_REDUNDANT, seed=3)
    defer = run("wifi-degradation", PolicyId.B2_ALWAYS_REDUNDANT_DEFER, seed=3)
    # Still always-redundant: control is duplicated and some copies are dropped.
    assert defer.metrics["application"]["control"]["duplicates_suppressed"] > 0
    # Bulk is paused at some point, and that is the only shaping it does.
    throttles = actions_of(defer, ActionKind.THROTTLE_CLASS)
    assert any(action.traffic_class is TrafficClass.BULK for _event, action in throttles)
    assert not any(action.traffic_class is TrafficClass.VIDEO for _event, action in throttles)
    assert not actions_of(defer, ActionKind.START_DUPLICATION)
    assert defer.metrics["application"]["bulk"]["bytes_completed"] < b2.metrics["application"]["bulk"]["bytes_completed"]
    assert defer.metrics["links"]["satellite_bytes"] < b2.metrics["links"]["satellite_bytes"]
    # Every event stays in teleop: B2-defer is not mode-aware.
    assert all(event.control_mode is ControlMode.TELEOP for event in defer.events)


@pytest.mark.parametrize("policy", [PolicyId.P1_CONTINUA, PolicyId.B2_ALWAYS_REDUNDANT, PolicyId.P2_CONTINUA])
def test_satellite_bytes_excl_bulk_is_consistent(policy: PolicyId):
    links = run("satellite-fallback", policy, seed=2).metrics["links"]
    assert links["satellite_bytes_excl_bulk"] == links["satellite_bytes"] - links["bulk_bytes"]["satellite"]
    assert 0 <= links["satellite_bytes_excl_bulk"] <= links["satellite_bytes"]
    for link, total in links["bytes"].items():
        assert 0 <= links["bulk_bytes"][link] <= total, link


# ---------------------------------------------------------------------------
# Per-class steering
# ---------------------------------------------------------------------------


def test_without_steering_every_class_rides_the_carrying_path():
    result = run("cellular-congestion", PolicyId.P1_CONTINUA, seed=5)
    for event in result.events:
        if event.carrying is None:
            assert event.class_paths == {}
            continue
        assert set(event.class_paths) == set(ALL_CLASSES)
        assert all(link is event.carrying for link in event.class_paths.values())
    assert result.metrics["steering"]["class_steers"] == 0
    assert result.metrics["steering"]["control_off_primary_s"] == 0.0


def test_simulator_routes_each_class_on_its_named_path():
    """A decision that puts control on a second active path is obeyed by the data plane."""
    sim = Simulation(get_scenario("baseline-journey"), seed=4, policy_id=PolicyId.P2_NO_MODE)
    while sim.t < 20.0:
        sim.step()
    decision = sim.last_decision
    assert decision is not None and decision.carrying is LinkId.WIFI
    # Make cellular a ready subflow and name it as the control path.
    cellular = sim.paths[LinkId.CELLULAR]
    cellular.activated = True
    cellular.validated = True
    cellular.activating_until = None
    cellular.validating_until = None
    decision.want_active = {LinkId.WIFI, LinkId.CELLULAR}
    decision.class_paths = {cls: LinkId.WIFI for cls in ALL_CLASSES}
    decision.class_paths[TrafficClass.CONTROL] = LinkId.CELLULAR
    decision.duplicate_classes = set()
    # Control owes a packet this step (20 Hz against a 20 ms step accrues one
    # every two or three steps); make the next step the one that emits it.
    sim.plant.accum[TrafficClass.CONTROL] = 0.99
    t_before = sim.t
    sim.step()
    created_now = [packet for _arrival, _uid, packet in sim.delivery_heap if packet.created_t == t_before + sim.dt]
    created_now += [entry.packet for entry in sim.plant.outstanding.values() if entry.packet.created_t == t_before + sim.dt]
    control = [p for p in created_now if p.traffic_class is TrafficClass.CONTROL and not p.is_probe]
    others = [p for p in created_now if p.traffic_class is not TrafficClass.CONTROL and not p.is_probe]
    assert control, "a control packet should have been generated in this step"
    assert all(p.link is LinkId.CELLULAR for p in control)
    assert others and all(p.link is LinkId.WIFI for p in others)


@pytest.mark.parametrize("policy", [PolicyId.P2_CONTINUA, PolicyId.P2_NO_MODE])
def test_steering_moves_classes_only_onto_ready_paths_and_records_why(policy: PolicyId):
    total_steers = 0
    off_primary = 0.0
    for scenario_id in ("cellular-congestion", "wifi-degradation", "flapping"):
        result = run(scenario_id, policy, seed=4242)
        steers = actions_of(result, ActionKind.STEER_CLASS)
        for event, action in steers:
            assert action.link is not None and action.traffic_class is not None
            assert action.traffic_class is not TrafficClass.BULK, "bulk always rides the primary path"
            assert event.links[action.link].phase in (LinkPhase.ACTIVE, LinkPhase.CARRYING)
            assert str(action.detail["reason"]).startswith("Steered ")
            assert event.class_paths[action.traffic_class] is action.link
        assert result.metrics["steering"]["class_steers"] == len(steers)
        total_steers += len(steers)
        off_primary += result.metrics["steering"]["control_off_primary_s"]
    assert total_steers > 0, f"{policy.value} never steered a class across three scenarios"
    assert off_primary > 0


def test_class_paths_never_keep_the_session_alive():
    """Continuity is measured on the primary path only, with or without steering."""
    p1 = run("total-loss", PolicyId.P1_CONTINUA, seed=1)
    p2 = run("total-loss", PolicyId.P2_CONTINUA, seed=1)
    no_mode = run("total-loss", PolicyId.P2_NO_MODE, seed=1)
    assert p2.metrics["continuity"]["outage_s"] == p1.metrics["continuity"]["outage_s"]
    assert no_mode.metrics["continuity"]["outage_s"] == p1.metrics["continuity"]["outage_s"]
    assert p2.metrics["continuity"]["interruptions"] == p1.metrics["continuity"]["interruptions"]
    for event in p2.events:
        if event.carrying is None:
            assert event.class_paths == {}
            assert event.app is not None and event.app.in_outage


# ---------------------------------------------------------------------------
# Mode handover
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("policy", [PolicyId.P1_CONTINUA, PolicyId.B2_ALWAYS_REDUNDANT, PolicyId.P2_NO_MODE])
def test_policies_without_the_flag_stay_in_teleop(policy: PolicyId):
    result = run("satellite-fallback", policy, seed=4242)
    assert all(event.control_mode is ControlMode.TELEOP for event in result.events)
    modes = result.metrics["control_mode"]
    assert modes["mode_changes"] == 0
    assert modes["mode_time_s"]["waypoint"] == 0.0 and modes["mode_time_s"]["safe_hold"] == 0.0
    # The strict picture is still reported: on satellite teleop is unsupported.
    assert modes["unsupported_mode_s"] > 10.0
    assert modes["teleop_availability_pct"] < 100.0


def test_mode_machine_downshifts_on_measurements_and_upshifts_after_the_hold():
    result = run("satellite-fallback", PolicyId.P2_NO_STEER, seed=4242)
    hold = POLICY_LIBRARY[PolicyId.P2_NO_STEER].mode_up_hold_s
    changes = actions_of(result, ActionKind.MODE_CHANGE)
    assert changes, "satellite fallback must force at least one mode change"
    downs = [(e, a) for e, a in changes if MODE_RANK[ControlMode(str(a.detail["to"]))] < MODE_RANK[ControlMode(str(a.detail["from"]))]]
    ups = [(e, a) for e, a in changes if MODE_RANK[ControlMode(str(a.detail["to"]))] > MODE_RANK[ControlMode(str(a.detail["from"]))]]
    assert downs and ups
    # Every upshift comes at least the hold time after the previous change.
    times = [e.t for e, _a in changes]
    for index, (event, action) in enumerate(changes):
        if (event, action) in ups and index > 0:
            assert event.t - times[index - 1] >= hold - 1e-6, f"upshift at {event.t} came before the hold elapsed"
            assert action.detail["trigger"] == "hold met"
    # Every change carries a reason recorded at decision time, in the event too.
    for event, action in changes:
        assert str(action.detail["reason"]).startswith("Control mode changed from ")
        assert "Control mode changed" in event.reason
        assert action.traffic_class is TrafficClass.CONTROL
    # On satellite the mode is never teleop: its 620 ms RTT cannot meet 150 ms.
    on_satellite = [e for e in result.events if e.carrying is LinkId.SATELLITE and e.t > changes[0][0].t]
    assert on_satellite
    assert all(e.control_mode is not ControlMode.TELEOP for e in on_satellite)
    # The whole point: far less time in a mode the path could not support.
    p1 = run("satellite-fallback", PolicyId.P1_CONTINUA, seed=4242)
    assert result.metrics["control_mode"]["unsupported_mode_s"] < 0.2 * p1.metrics["control_mode"]["unsupported_mode_s"]


def test_mode_change_precedes_the_switch_it_accompanies():
    found = 0
    for scenario_id in ("sudden-failure", "flapping", "satellite-fallback", "reverse-run"):
        result = run(scenario_id, PolicyId.P2_NO_STEER, seed=4242)
        for event in result.events:
            kinds = [action.kind for action in event.actions]
            if ActionKind.MODE_CHANGE in kinds and ActionKind.SWITCH in kinds:
                found += 1
                assert kinds.index(ActionKind.MODE_CHANGE) < kinds.index(ActionKind.SWITCH)
                assert event.action is not None and event.action.kind is ActionKind.MODE_CHANGE
    assert found > 0, "expected at least one mode change that accompanies a switch"


def test_reactive_mode_never_changes_mode_ahead_of_a_measurement():
    for scenario_id in ("satellite-fallback", "wifi-degradation"):
        result = run(scenario_id, PolicyId.P2_REACTIVE_MODE, seed=4242)
        for _event, action in actions_of(result, ActionKind.MODE_CHANGE):
            assert action.detail["anticipated"] is False
            assert action.detail["trigger"] in ("measured", "hold met")
        assert result.metrics["control_mode"]["anticipated_mode_changes"] == 0


def test_reactive_mode_still_enters_safe_hold_when_every_path_is_gone():
    """Losing the path is a measurement, not a path change the reactive arm defers."""
    result = run("total-loss", PolicyId.P2_REACTIVE_MODE, seed=1)
    disconnected = [event for event in result.events if event.carrying is None]
    assert disconnected, "total-loss must produce a period with no path"
    assert all(event.control_mode is ControlMode.SAFE_HOLD for event in disconnected[1:]), (
        "with no path at all the reactive ablation must hold, not keep offering commands"
    )
    assert result.metrics["control_mode"]["mode_time_s"]["safe_hold"] > 5.0
    assert all(
        action.detail["trigger"] in ("measured", "hold met")
        for _event, action in actions_of(result, ActionKind.MODE_CHANGE)
    )


def test_anticipated_and_late_downshifts_are_counted_from_receiver_facts():
    result = run("satellite-fallback", PolicyId.P2_CONTINUA, seed=4242)
    modes = result.metrics["control_mode"]
    changes = actions_of(result, ActionKind.MODE_CHANGE)
    downs = [a for _e, a in changes if MODE_RANK[ControlMode(str(a.detail["to"]))] < MODE_RANK[ControlMode(str(a.detail["from"]))]]
    assert modes["mode_changes"] == len(changes)
    assert modes["anticipated_mode_changes"] + modes["late_mode_changes"] == len(downs)
    assert modes["anticipated_mode_changes"] > 0, "P2 anticipates at least once in satellite fallback"
    # Accounting identities.
    total = sum(modes["mode_time_s"].values())
    assert abs(total - (result.duration_s + 0.02)) < 1e-6
    assert 0 <= modes["unsupported_mode_s"] <= total
    assert 0 <= modes["conservative_mode_s"] <= total
    # Both sides are rounded to three decimals independently.
    assert abs(modes["teleop_availability_pct"] - 100.0 * modes["teleop_supported_s"] / total) < 0.01
    assert modes["teleop_supported_s"] <= modes["mode_time_s"]["teleop"] + 1e-9
    by_mode = modes["control_by_mode"]
    assert by_mode["safe_hold"]["sent"] == 0
    assert sum(entry["sent"] for entry in by_mode.values()) == result.metrics["application"]["control"]["sent"]


def test_mode_support_definition_is_shared_and_honest_about_unknowns():
    from continua_engine.contracts import LinkObservation

    ready_unmeasured = LinkObservation(link=LinkId.CELLULAR, phase=LinkPhase.ACTIVE, window_s=2.0)
    assert mode_supported(ready_unmeasured, ControlMode.TELEOP) is None
    idle = LinkObservation(link=LinkId.CELLULAR, phase=LinkPhase.AVAILABLE, window_s=2.0, rtt_ms=20.0, loss_pct=0.1)
    assert mode_supported(idle, ControlMode.TELEOP) is False
    satellite = LinkObservation(link=LinkId.SATELLITE, phase=LinkPhase.CARRYING, window_s=2.0, rtt_ms=640.0, loss_pct=0.7)
    assert mode_supported(satellite, ControlMode.TELEOP) is False
    assert mode_supported(satellite, ControlMode.WAYPOINT) is True
    assert mode_supported(None, ControlMode.SAFE_HOLD) is True


# ---------------------------------------------------------------------------
# The hard constraint: the mode never touches motion or the trace
# ---------------------------------------------------------------------------


def test_mode_handover_never_changes_motion_or_the_exogenous_trace():
    scenario = get_scenario("satellite-fallback")
    p1 = Simulation(scenario, seed=4242, policy_id=PolicyId.P1_CONTINUA)
    p2 = Simulation(scenario, seed=4242, policy_id=PolicyId.P2_CONTINUA)
    a, b = p1.run(), p2.run()
    for link in LinkId:
        assert (p1.trace.quality[link] == p2.trace.quality[link]).all()
        assert (p1.trace.burst[link] == p2.trace.burst[link]).all()
        assert (p1.trace.background[link] == p2.trace.background[link]).all()
    assert (p1.trace.distance_m == p2.trace.distance_m).all()
    assert (p1.trace.speed_mps == p2.trace.speed_mps).all()
    # The vehicle sample in every event is identical at identical times.
    by_t = {event.t: event.vehicle for event in a.events}
    compared = 0
    for event in b.events:
        if event.t in by_t:
            assert event.vehicle == by_t[event.t]
            compared += 1
    assert compared > 100
    # And it keeps moving while the command channel is in safe hold.
    held = [event for event in b.events if event.control_mode is ControlMode.SAFE_HOLD and event.vehicle]
    assert held, "P2 enters safe hold at least once in this scenario"
    assert b.metrics["control_mode"]["mode_time_s"]["safe_hold"] > 0
    distances = [event.vehicle.distance_m for event in held]
    assert max(distances) > min(distances)


# ---------------------------------------------------------------------------
# No future information, with the new policies either
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("policy", [PolicyId.P2_CONTINUA, PolicyId.P2_REACTIVE_MODE])
def test_new_controllers_never_receive_the_trace(policy: PolicyId):
    sim = Simulation(get_scenario("sudden-failure"), seed=3, policy_id=policy)
    controller = sim.controller
    for attribute in vars(controller):
        value = getattr(controller, attribute)
        assert not hasattr(value, "quality"), f"controller.{attribute} exposes the exogenous trace"
        if isinstance(value, dict):
            for item in value.values():
                assert not hasattr(item, "quality"), f"controller.{attribute} exposes the exogenous trace"
    assert not hasattr(controller, "trace")


def test_prediction_features_stay_on_the_allow_list_with_mode_and_steering():
    allowed = {
        "rtt_ms", "rtt_slope_ms_per_s", "jitter_ms", "loss_pct", "loss_slope_pct_per_s",
        "throughput_mbps", "throughput_slope", "queue_depth_bytes", "coverage", "coverage_slope",
        "speed_mps", "rtt_over_deadline", "alt_best_coverage",
    }
    result = run("wifi-degradation", PolicyId.P2_CONTINUA, seed=5)
    predicted = [e for e in result.events if e.prediction and e.prediction.features]
    assert predicted
    for event in predicted:
        assert set(event.prediction.features) <= allowed
    # Mode changes and steers explain themselves with measured quantities only.
    for _event, action in actions_of(result, ActionKind.MODE_CHANGE) + actions_of(result, ActionKind.STEER_CLASS):
        reason = str(action.detail["reason"])
        assert "quality[" not in reason and "trace" not in reason


# ---------------------------------------------------------------------------
# Experiment plumbing and contracts
# ---------------------------------------------------------------------------


def test_seed_blocks_include_test2_and_stay_disjoint():
    assert SEED_BLOCKS["test2"] == 100_000
    assert SEED_BLOCKS["test3"] == 130_000
    # Phase 5 added one more fresh block for its comparison.
    assert SEED_BLOCKS["test4"] == 160_000
    assert len(SEED_BLOCKS) == 6
    blocks = {name: {seed_for(name, i) for i in range(200)} for name in SEED_BLOCKS}
    names = list(blocks)
    for i, left in enumerate(names):
        for right in names[i + 1:]:
            assert not (blocks[left] & blocks[right]), f"{left} and {right} overlap"


def test_events_round_trip_with_the_new_fields():
    result = run("satellite-fallback", PolicyId.P2_CONTINUA, seed=4242)
    event = next(e for e in result.events if any(a.kind is ActionKind.MODE_CHANGE for a in e.actions))
    payload = json.loads(event.model_dump_json())
    assert payload["control_mode"] in {mode.value for mode in ControlMode}
    assert set(payload["class_paths"]) == {cls.value for cls in ALL_CLASSES}
    assert payload["actions"][0]["kind"] == payload["action"]["kind"]
    restored = EngineEvent.model_validate(payload)
    assert restored.control_mode is event.control_mode
    assert restored.class_paths == event.class_paths
    assert [a.kind for a in restored.actions] == [a.kind for a in event.actions]


def test_policy_overrides_are_recorded_and_applied():
    sim = Simulation(
        get_scenario("baseline-journey"), seed=1, policy_id=PolicyId.P2_CONTINUA,
        policy_overrides={"mode_up_hold_s": 1.5},
    )
    assert sim.config.mode_up_hold_s == 1.5
    assert sim.controller.config.mode_up_hold_s == 1.5
    with pytest.raises(ValueError):
        Simulation(get_scenario("baseline-journey"), seed=1, policy_id=PolicyId.P2_CONTINUA, policy_overrides={"nope": 1})
    while sim.t < 2.0:
        sim.step()
    from continua_engine.experiments.metrics import compute_metrics

    assert compute_metrics(sim)["policy_overrides"] == {"mode_up_hold_s": 1.5}


def _event_digest(result) -> str:
    hasher = hashlib.sha256()
    for event in result.events:
        hasher.update(f"{event.t}|{event.controller_state.value}|{event.carrying}|{event.control_mode.value}|{event.reason}".encode())
    return hasher.hexdigest()


def test_same_seed_reproduces_identical_p2_run():
    a = run("wifi-degradation", PolicyId.P2_CONTINUA, seed=42)
    b = run("wifi-degradation", PolicyId.P2_CONTINUA, seed=42)
    assert _event_digest(a) == _event_digest(b)
    assert a.metrics["control_mode"] == b.metrics["control_mode"]
    assert a.metrics["steering"] == b.metrics["steering"]


@pytest.mark.parametrize("policy", PHASE4_POLICIES, ids=[p.value for p in PHASE4_POLICIES])
@pytest.mark.parametrize(
    "scenario_id",
    [
        "baseline-journey",
        "wifi-degradation",
        "sudden-failure",
        "cellular-congestion",
        "satellite-fallback",
        "flapping",
        "dock-disconnect",
        "total-loss",
        "fast-run",
        "reverse-run",
    ],
)
def test_every_scenario_runs_end_to_end_under_the_new_policies(scenario_id: str, policy: PolicyId):
    result = run(scenario_id, policy, seed=1)
    assert result.events, f"{scenario_id}/{policy.value} produced no events"
    assert result.metrics["duration_s"] > 0
    modes = result.metrics["control_mode"]
    assert abs(sum(modes["mode_time_s"].values()) - (result.duration_s + 0.02)) < 1e-6
    if not POLICY_LIBRARY[policy].mode_handover:
        assert modes["mode_changes"] == 0
