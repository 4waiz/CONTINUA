"""
Run metrics, computed from receiver-side facts only.

Nothing in this module reads the controller's intentions. "Did a handoff
succeed?" is not a question the code asks; it measures interruption duration,
deadline misses and reconnections and lets those speak. Definitions and
measurement windows are in `docs/METRICS.md`.
"""

from __future__ import annotations

import math
import statistics
from typing import TYPE_CHECKING

from ..contracts import ALL_CLASSES, ALL_LINKS, TrafficClass
from ..controller.predictors import LOSS_VIOLATION_PCT, RTT_VIOLATION_MS

if TYPE_CHECKING:  # pragma: no cover
    from ..sim.simulator import Simulation


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(math.ceil(q * len(ordered)) - 1)))
    return round(ordered[index], 3)


def compute_metrics(sim: "Simulation") -> dict:
    plant = sim.plant
    receivers = plant.receivers

    # --- continuity, measured as time with no carrying path -----------------
    interruptions = [duration for _start, duration in sim.interruptions]
    total_interruption = round(sum(interruptions), 3)
    longest = round(max(interruptions), 3) if interruptions else 0.0

    # --- per-class application performance -----------------------------------
    per_class: dict[str, dict] = {}
    for cls in ALL_CLASSES:
        receiver = receivers.get(cls)
        if receiver is None:
            continue
        latencies = receiver.latencies
        entry: dict = {
            "sent": receiver.sent,
            "delivered": receiver.delivered,
            "duplicates_suppressed": receiver.duplicates_suppressed,
            "goodput_bytes": receiver.goodput_bytes,
        }
        if receiver.deadline_eligible > 0:
            entry["deadline_eligible"] = receiver.deadline_eligible
            entry["deadline_misses"] = receiver.deadline_misses
            entry["deadline_miss_pct"] = round(
                100.0 * receiver.deadline_misses / receiver.deadline_eligible, 4
            )
        if latencies:
            entry["mean_latency_ms"] = round(statistics.fmean(latencies), 3)
            entry["p50_latency_ms"] = _percentile(latencies, 0.50)
            entry["p95_latency_ms"] = _percentile(latencies, 0.95)
            entry["p99_latency_ms"] = _percentile(latencies, 0.99)
        if cls is TrafficClass.VIDEO:
            entry["frames_expected"] = receiver.frames_expected
            entry["frames_delivered"] = receiver.frames_delivered
            entry["frame_delivery_pct"] = (
                round(100.0 * receiver.frames_delivered / receiver.frames_expected, 3)
                if receiver.frames_expected
                else None
            )
            entry["stall_ms"] = round(receiver.stall_ms, 1)
        if cls is TrafficClass.TELEMETRY:
            entry["final_freshness_ms"] = (
                round((sim.t - receiver.last_arrival_t) * 1000.0, 1)
                if receiver.last_arrival_t is not None
                else None
            )
        if cls is TrafficClass.BULK:
            entry["bytes_completed"] = int(receiver.bytes_completed)
            entry["completion_pct"] = round(
                100.0 * receiver.bytes_completed / max(float(plant.spec["bulk"]["total_bytes"]), 1.0), 4
            )
        per_class[cls.value] = entry

    # --- link usage and cost -------------------------------------------------
    link_bytes = {link.value: sim.paths[link].link_bytes for link in ALL_LINKS}
    activations = {link.value: sim.paths[link].activations for link in ALL_LINKS}
    cost_units = round(sum(sim.paths[link].cost_units() for link in ALL_LINKS), 4)
    total_link_bytes = sum(link_bytes.values())
    goodput_bytes = sum(r.goodput_bytes for r in receivers.values())
    overhead_pct = (
        round(100.0 * (total_link_bytes - goodput_bytes) / total_link_bytes, 3)
        if total_link_bytes > 0
        else None
    )

    # --- prediction quality, scored against what actually happened ----------
    prediction = _score_predictions(sim)

    return {
        "run_id": sim.run_id,
        "scenario_id": sim.scenario["id"],
        "policy_id": sim.config.policy_id.value,
        "seed": sim.seed,
        "duration_s": round(sim.trace.duration_s, 3),
        "continuity": {
            "session_reconnects": sim.session_reconnects,
            "interruptions": len(interruptions),
            "total_interruption_s": total_interruption,
            "longest_interruption_s": longest,
            "outage_s": round(sim.outage_s, 3),
            "safe_stop_entered": bool(sim.safe_stop or any(d >= 3.0 for d in interruptions)),
        },
        "application": per_class,
        "app_health_score": (sim._app_health().health_score),
        "links": {
            "bytes": link_bytes,
            "activations": activations,
            "satellite_bytes": link_bytes.get("satellite", 0),
            "total_bytes": total_link_bytes,
            "goodput_bytes": goodput_bytes,
            "overhead_pct": overhead_pct,
            "cost_units": cost_units,
        },
        "control_plane": {
            "handovers": sim.controller.handovers,
            "unnecessary_handovers": sim.controller.unnecessary_handovers,
            "backup_activations": sim.controller.backup_activations,
            "duplication_windows": sim.controller.duplication_windows,
            "control_timeouts": plant.control_timeouts,
            "control_retransmits": plant.control_retransmits,
        },
        "prediction": prediction,
    }


def _score_predictions(sim: "Simulation") -> dict:
    """Compare each prediction against what the carrying path actually did.

    A prediction made at time t with horizon h is *correct* if a violation, as
    defined in `predictors.VIOLATION_DEFINITION`, actually occurred on the path
    that was carrying at t, at some point inside (t, t+h].

    This is scored after the run using the recorded observation series - the
    controller never had access to it at decision time.
    """
    events = sim.events
    if not events:
        return {"evaluated": 0}

    # Reconstruct, from the emitted events only, when each link was in violation.
    violation_times: dict[str, list[float]] = {}
    for event in events:
        for link, obs in event.links.items():
            bad = (
                obs.phase.value == "unavailable"
                or (obs.rtt_ms is not None and obs.rtt_ms > RTT_VIOLATION_MS)
                or (obs.loss_pct is not None and obs.loss_pct > LOSS_VIOLATION_PCT)
            )
            if bad:
                violation_times.setdefault(link.value, []).append(event.t)

    tp = fp = fn = tn = 0
    evaluated = 0
    skipped_already_violating = 0
    scores: list[tuple[float, int]] = []
    for event in events:
        if event.prediction is None or event.carrying is None:
            continue
        # Only score predictions made while the carrying path is *not already*
        # in violation. Scoring the rest inflates precision to ~1.0 for free:
        # once the rover is on satellite the 620 ms base RTT means the path is
        # permanently past the 150 ms control deadline, and "predicting" that is
        # not a forecast. The meaningful question is whether a transition into
        # violation was seen coming.
        carrying_obs = event.links.get(event.carrying)
        already_bad = carrying_obs is not None and (
            carrying_obs.phase.value == "unavailable"
            or (carrying_obs.rtt_ms is not None and carrying_obs.rtt_ms > RTT_VIOLATION_MS)
            or (carrying_obs.loss_pct is not None and carrying_obs.loss_pct > LOSS_VIOLATION_PCT)
        )
        if already_bad:
            skipped_already_violating += 1
            continue
        horizon = event.prediction.horizon_s
        window = (event.t, event.t + horizon)
        actual = any(window[0] < vt <= window[1] for vt in violation_times.get(event.carrying.value, ()))
        predicted = event.prediction.violation_expected
        evaluated += 1
        if predicted and actual:
            tp += 1
        elif predicted and not actual:
            fp += 1
        elif not predicted and actual:
            fn += 1
        else:
            tn += 1
        if event.prediction.score is not None:
            scores.append((event.prediction.score, 1 if actual else 0))

    precision = round(tp / (tp + fp), 4) if (tp + fp) else None
    recall = round(tp / (tp + fn), 4) if (tp + fn) else None
    f1 = (
        round(2 * precision * recall / (precision + recall), 4)
        if precision and recall and (precision + recall) > 0
        else None
    )
    return {
        "predictor": events[-1].prediction.predictor if events[-1].prediction else "none",
        "horizon_s": events[-1].prediction.horizon_s if events[-1].prediction else None,
        "evaluated": evaluated,
        "skipped_already_violating": skipped_already_violating,
        "scoring_rule": (
            "Predictions are scored only while the carrying path is not already "
            "in violation; a forecast of an ongoing condition is not a forecast."
        ),
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "calibrated": bool(events[-1].prediction.calibrated) if events[-1].prediction else False,
    }


def aggregate(runs: list[dict]) -> dict:
    """Aggregate paired trials with an uncertainty estimate.

    Reports mean, standard deviation and a 95 % confidence interval on the mean
    (normal approximation). With ~20 trials that interval is wide; it is
    reported rather than hidden so nobody reads a 3 % difference as a result.
    """

    def collect(path: list[str]) -> list[float]:
        values: list[float] = []
        for run in runs:
            node: object = run
            for key in path:
                if not isinstance(node, dict) or key not in node:
                    node = None
                    break
                node = node[key]
            if isinstance(node, (int, float)) and not isinstance(node, bool):
                values.append(float(node))
        return values

    tracked: dict[str, list[str]] = {
        "session_reconnects": ["continuity", "session_reconnects"],
        "total_interruption_s": ["continuity", "total_interruption_s"],
        "longest_interruption_s": ["continuity", "longest_interruption_s"],
        "control_deadline_miss_pct": ["application", "control", "deadline_miss_pct"],
        "control_p95_latency_ms": ["application", "control", "p95_latency_ms"],
        "control_p99_latency_ms": ["application", "control", "p99_latency_ms"],
        "voice_deadline_miss_pct": ["application", "voice", "deadline_miss_pct"],
        "telemetry_deadline_miss_pct": ["application", "telemetry", "deadline_miss_pct"],
        "video_stall_ms": ["application", "video", "stall_ms"],
        "video_frame_delivery_pct": ["application", "video", "frame_delivery_pct"],
        "bulk_bytes_completed": ["application", "bulk", "bytes_completed"],
        "app_health_score": ["app_health_score"],
        "satellite_bytes": ["links", "satellite_bytes"],
        "total_link_bytes": ["links", "total_bytes"],
        "overhead_pct": ["links", "overhead_pct"],
        "cost_units": ["links", "cost_units"],
        "handovers": ["control_plane", "handovers"],
        "unnecessary_handovers": ["control_plane", "unnecessary_handovers"],
        "backup_activations": ["control_plane", "backup_activations"],
        "prediction_precision": ["prediction", "precision"],
        "prediction_recall": ["prediction", "recall"],
        "prediction_false_positives": ["prediction", "false_positives"],
        "prediction_false_negatives": ["prediction", "false_negatives"],
    }

    out: dict[str, dict] = {}
    for name, path in tracked.items():
        values = collect(path)
        if not values:
            out[name] = {"n": 0, "mean": None, "note": "no samples"}
            continue
        mean = statistics.fmean(values)
        sd = statistics.stdev(values) if len(values) > 1 else 0.0
        half = 1.96 * sd / math.sqrt(len(values)) if len(values) > 1 else 0.0
        out[name] = {
            "n": len(values),
            "mean": round(mean, 4),
            "sd": round(sd, 4),
            "ci95_low": round(mean - half, 4),
            "ci95_high": round(mean + half, 4),
            "min": round(min(values), 4),
            "max": round(max(values), 4),
        }
    return out
