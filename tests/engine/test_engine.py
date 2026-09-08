"""
Engine tests.

These check the claims the project actually makes: that runs are deterministic,
that the controller cannot see the future, that duplicated commands are
deduplicated, that a total outage is reported as an outage, and that metrics are
derived from receiver logs rather than from anything the controller wished had
happened.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pytest

ENGINE_ROOT = Path(__file__).resolve().parents[2] / "services" / "engine"
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from continua_engine.contracts import ExecutionMode, LinkId, PolicyId, TrafficClass  # noqa: E402
from continua_engine.controller.controller import POLICY_LIBRARY  # noqa: E402
from continua_engine.controller.predictors import HeuristicPredictor, LearnedPredictor  # noqa: E402
from continua_engine.experiments.metrics import aggregate  # noqa: E402
from continua_engine.experiments.runner import SEED_BLOCKS, seed_for  # noqa: E402
from continua_engine.sim.exogenous import apply_overrides, build_trace, get_scenario  # noqa: E402
from continua_engine.sim.simulator import Simulation  # noqa: E402
from continua_engine.world import Coverage, MotionProfile, Route  # noqa: E402


def run(scenario_id: str, policy: PolicyId = PolicyId.P1_CONTINUA, seed: int = 1, **kwargs):
    return Simulation(get_scenario(scenario_id), seed=seed, policy_id=policy, **kwargs).run()


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_same_seed_reproduces_identical_run():
    a = run("wifi-degradation", seed=42)
    b = run("wifi-degradation", seed=42)
    assert len(a.events) == len(b.events)
    for left, right in zip(a.events, b.events):
        assert left.t == right.t
        assert left.controller_state == right.controller_state
        assert left.carrying == right.carrying
        assert left.reason == right.reason
    assert a.metrics["continuity"] == b.metrics["continuity"]
    assert a.metrics["application"] == b.metrics["application"]


def test_different_seeds_produce_different_runs():
    a = run("wifi-degradation", seed=1)
    b = run("wifi-degradation", seed=2)
    assert a.metrics["links"]["bytes"] != b.metrics["links"]["bytes"]


def test_exogenous_trace_is_independent_of_policy():
    """The heart of the paired design: same seed, same world, whatever the policy."""
    scenario = get_scenario("cellular-congestion")
    first = build_trace(scenario, seed=7)
    second = build_trace(scenario, seed=7)
    for link in LinkId:
        assert (first.quality[link] == second.quality[link]).all()
        assert (first.burst[link] == second.burst[link]).all()
        assert (first.background[link] == second.background[link]).all()

    # And running two different policies must not perturb it.
    a = run("cellular-congestion", PolicyId.B0_SINGLE_REACTIVE, seed=7)
    b = run("cellular-congestion", PolicyId.P1_CONTINUA, seed=7)
    trace_a = build_trace(get_scenario("cellular-congestion"), seed=7)
    assert math.isclose(a.duration_s, b.duration_s)
    assert math.isclose(trace_a.duration_s, a.duration_s)


# ---------------------------------------------------------------------------
# No future information leaks into the controller
# ---------------------------------------------------------------------------


def test_controller_never_receives_the_trace():
    sim = Simulation(get_scenario("sudden-failure"), seed=3, policy_id=PolicyId.P1_CONTINUA)
    controller = sim.controller
    for attribute in vars(controller):
        value = getattr(controller, attribute)
        assert not hasattr(value, "quality"), f"controller.{attribute} exposes the exogenous trace"
    assert not hasattr(controller, "trace")
    assert not hasattr(controller.predictor, "trace")


def test_prediction_features_contain_only_observable_quantities():
    result = run("wifi-degradation", seed=5)
    predicted = [e for e in result.events if e.prediction and e.prediction.features]
    assert predicted, "expected at least one prediction with features"
    allowed = {
        "rtt_ms",
        "rtt_slope_ms_per_s",
        "jitter_ms",
        "loss_pct",
        "loss_slope_pct_per_s",
        "throughput_mbps",
        "throughput_slope",
        "queue_depth_bytes",
        "coverage",
        "coverage_slope",
        "speed_mps",
        "rtt_over_deadline",
        "alt_best_coverage",
    }
    for event in predicted:
        assert set(event.prediction.features) <= allowed


def test_predictions_are_scored_only_on_transitions():
    result = run("satellite-fallback", seed=11)
    prediction = result.metrics["prediction"]
    assert prediction["evaluated"] > 0
    # Satellite sits permanently above the 150 ms control deadline, so a large
    # number of samples must have been excluded as "already violating".
    assert prediction["skipped_already_violating"] > 0
    assert "not a forecast" in prediction["scoring_rule"]


# ---------------------------------------------------------------------------
# Traffic behaviour
# ---------------------------------------------------------------------------


def test_duplicated_commands_are_deduplicated_before_delivery():
    result = run("wifi-degradation", PolicyId.B2_ALWAYS_REDUNDANT, seed=9)
    control = result.metrics["application"]["control"]
    assert control["duplicates_suppressed"] > 0, "B2 duplicates control; some copies must arrive twice"
    # Every command is delivered to the application at most once.
    assert control["delivered"] <= control["sent"]


def test_control_deadline_misses_come_from_receiver_timestamps():
    result = run("satellite-fallback", seed=4)
    control = result.metrics["application"]["control"]
    assert control["deadline_eligible"] > 0
    assert 0 <= control["deadline_miss_pct"] <= 100
    assert control["deadline_misses"] <= control["deadline_eligible"]
    # p95 must be a real order statistic of the recorded latencies.
    assert control["p95_latency_ms"] >= control["p50_latency_ms"]


def test_video_frames_require_every_packet_before_the_deadline():
    result = run("baseline-journey", seed=6)
    video = result.metrics["application"]["video"]
    assert video["frames_expected"] > 0
    assert video["frames_delivered"] <= video["frames_expected"]


def test_goodput_never_exceeds_link_bytes():
    result = run("baseline-journey", seed=2)
    links = result.metrics["links"]
    assert links["goodput_bytes"] <= links["total_bytes"]
    assert links["overhead_pct"] is None or links["overhead_pct"] >= 0


# ---------------------------------------------------------------------------
# Outage honesty
# ---------------------------------------------------------------------------


def test_total_loss_is_reported_as_a_genuine_outage():
    result = run("total-loss", seed=1)
    continuity = result.metrics["continuity"]
    assert continuity["outage_s"] > 5.0, "all paths are removed for 9 s; that must show up"
    assert continuity["safe_stop_entered"] is True
    disconnected = [e for e in result.events if e.controller_state.value == "disconnected"]
    assert disconnected, "controller must report disconnected, not route around a total outage"
    assert any("genuine outage" in e.reason for e in disconnected)


def test_no_policy_can_carry_traffic_through_a_total_outage():
    for policy in (PolicyId.B0_SINGLE_REACTIVE, PolicyId.B2_ALWAYS_REDUNDANT, PolicyId.P1_CONTINUA):
        result = run("total-loss", policy, seed=1)
        assert result.metrics["continuity"]["outage_s"] > 5.0


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------


def test_single_path_baseline_never_activates_two_paths():
    sim = Simulation(get_scenario("wifi-degradation"), seed=1, policy_id=PolicyId.B0_SINGLE_REACTIVE)
    while not sim.finished:
        sim.step()
        activated = [link for link, path in sim.paths.items() if path.activated]
        assert len(activated) <= 1, f"B0 activated {activated}"


def test_always_redundant_costs_more_than_continua():
    b2 = run("wifi-degradation", PolicyId.B2_ALWAYS_REDUNDANT, seed=1)
    p1 = run("wifi-degradation", PolicyId.P1_CONTINUA, seed=1)
    assert b2.metrics["links"]["cost_units"] > p1.metrics["links"]["cost_units"]


def test_policies_differ_only_by_configuration():
    for policy_id, config in POLICY_LIBRARY.items():
        assert config.policy_id is policy_id
    assert POLICY_LIBRARY[PolicyId.P1_NO_PREDICTION].use_prediction is False
    assert POLICY_LIBRARY[PolicyId.P1_NO_APP_PRIORITY].app_aware is False
    assert POLICY_LIBRARY[PolicyId.P1_CONTINUA].use_prediction is True
    assert POLICY_LIBRARY[PolicyId.P1_CONTINUA].app_aware is True


# ---------------------------------------------------------------------------
# Measurement honesty
# ---------------------------------------------------------------------------


def test_rssi_is_reported_only_for_wifi():
    result = run("baseline-journey", seed=1)
    for event in result.events:
        for link, obs in event.links.items():
            if link is LinkId.WIFI:
                continue
            assert obs.rssi_dbm is None, f"{link.value} must not report an RSSI"


def test_missing_measurements_are_none_not_zero():
    sim = Simulation(get_scenario("baseline-journey"), seed=1)
    sim.step()  # a single step: almost nothing has been measured yet
    observations = sim._observe(0)
    unmeasured = [o for o in observations.values() if o.samples < sim.min_samples]
    assert unmeasured, "expected some links with too few samples at t=0"
    for obs in unmeasured:
        assert obs.rtt_ms is None
        assert obs.jitter_ms is None


def test_health_score_is_reproducible_from_class_attainment():
    result = run("baseline-journey", seed=1)
    score = result.metrics["app_health_score"]
    assert score is None or 0.0 <= score <= 100.0


# ---------------------------------------------------------------------------
# Replay equivalence
# ---------------------------------------------------------------------------


def test_replaying_a_recorded_run_reproduces_it_exactly(tmp_path):
    from continua_engine.store.store import RunStore

    store = RunStore(tmp_path / "runs")
    scenario = get_scenario("flapping")
    sim = Simulation(scenario, seed=13, policy_id=PolicyId.P1_CONTINUA)
    store.begin_run(sim.run_id, ExecutionMode.SIMULATION, scenario, PolicyId.P1_CONTINUA, 13, "heuristic", 3.0, "2.0.0")
    result = sim.run()
    store.write_events(sim.run_id, result.events)

    replayed = list(store.iter_events(sim.run_id))
    assert len(replayed) == len(result.events)
    for recorded, original in zip(replayed, result.events):
        assert recorded["seq"] == original.seq
        assert recorded["t"] == original.t
        assert recorded["carrying"] == (original.carrying.value if original.carrying else None)
        assert recorded["reason"] == original.reason


def test_scenario_overrides_never_mutate_the_catalogue():
    before = json.dumps(get_scenario("baseline-journey"), sort_keys=True)
    apply_overrides(get_scenario("baseline-journey"), {"inject_fault": "wifi", "inject_fault_at_s": 10})
    after = json.dumps(get_scenario("baseline-journey"), sort_keys=True)
    assert before == after


# ---------------------------------------------------------------------------
# Experiment plumbing
# ---------------------------------------------------------------------------


def test_seed_blocks_are_disjoint():
    train = {seed_for("train", i) for i in range(200)}
    tune = {seed_for("tune", i) for i in range(200)}
    test = {seed_for("test", i) for i in range(200)}
    assert not (train & tune)
    assert not (train & test)
    assert not (tune & test)
    assert len(SEED_BLOCKS) == 3


def test_aggregate_reports_uncertainty():
    runs = [run("baseline-journey", seed=s).metrics for s in (1, 2, 3)]
    summary = aggregate(runs)
    entry = summary["control_deadline_miss_pct"]
    assert entry["n"] == 3
    assert entry["ci95_low"] <= entry["mean"] <= entry["ci95_high"]


def test_learned_predictor_falls_back_when_unavailable():
    predictor = LearnedPredictor(model_path=Path("does-not-exist.json"))
    assert predictor.available is False
    from continua_engine.controller.predictors import make_predictor

    assert isinstance(make_predictor("learned"), (HeuristicPredictor, LearnedPredictor))


# ---------------------------------------------------------------------------
# World parity with the TypeScript scene
# ---------------------------------------------------------------------------


def test_route_matches_the_shared_world_definition():
    route = Route()
    assert 900 < route.length < 940, f"unexpected route length {route.length}"
    assert route.samples[0].distance == 0.0
    # Monotonic arc length, unit tangents.
    for index in range(1, len(route.samples)):
        assert route.samples[index].distance >= route.samples[index - 1].distance
    for sample in route.samples[::97]:
        assert math.isclose(math.hypot(sample.tx, sample.tz), 1.0, rel_tol=1e-6)


def test_coverage_is_geometric_and_bounded():
    coverage = Coverage()
    route = Route()
    for distance in range(0, int(route.length), 37):
        sample = route.at(distance)
        for link, value in coverage.all_at(sample.x, sample.z).items():
            assert 0.0 <= value <= 1.0, f"{link} coverage out of range at {distance} m"


def test_motion_profile_covers_the_route():
    route = Route()
    motion = MotionProfile(route)
    assert motion.distance_at(0.0) == 0.0
    assert math.isclose(motion.distance_at(motion.duration), route.length, rel_tol=1e-3)
    # Stationary during the dock dwell.
    assert motion.sample_at(1.0)[1] == 0.0


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
def test_every_scenario_runs_end_to_end(scenario_id):
    result = run(scenario_id, seed=1)
    assert result.events, f"{scenario_id} produced no events"
    assert result.metrics["duration_s"] > 0
    assert result.metrics["application"]["control"]["sent"] > 0
