# Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE.
# KS-CONTINUA-98C99E060B1B
"""
Control-class operating modes (Phase 4).

One definition of "this path supports this mode", used identically by the
controller when it decides and by the simulator when it measures. If the two
ever disagreed, `unsupported_mode_s` would be measuring the disagreement rather
than the network - the same reason `predictors.VIOLATION_DEFINITION` is shared
by the heuristic, the learned model and the offline labels.
"""

from __future__ import annotations

from functools import lru_cache

from ..contracts import MODE_RANK, ControlMode, LinkObservation, LinkPhase, Prediction
from ..sim.exogenous import link_profiles

#: Modes that carry a deadline, highest first.
DEADLINE_MODES: tuple[ControlMode, ...] = (ControlMode.TELEOP, ControlMode.WAYPOINT)

SUPPORT_DEFINITION = (
    "A path supports a control mode when it is ready to carry traffic (active or "
    "carrying), its windowed RTT from acknowledgements is at or below the mode's "
    "deadline, and its windowed loss is at or below the mode's loss limit. Control "
    "is acknowledged and retransmitted, so where the path's RTT plus the "
    "retransmit floor still fits inside the deadline the mode's recovered loss "
    "limit applies instead: one lost packet is resent and still arrives in time. "
    "A ready path with too few samples supports nothing *yet* (unknown). A path "
    "that is unavailable, idle, activating or validating supports nothing: packets "
    "placed on it would not arrive. safe_hold has no deadline and is always supported."
)


@lru_cache(maxsize=1)
def mode_table() -> dict[ControlMode, dict]:
    """The per-mode assumptions from `link_profiles.json` (rate, size, deadline)."""
    modes = link_profiles()["workload"]["control"]["modes"]
    return {mode: dict(modes[mode.value]) for mode in ControlMode}


def mode_deadline_ms(mode: ControlMode) -> float | None:
    value = mode_table()[mode].get("deadline_ms")
    return float(value) if value is not None else None


@lru_cache(maxsize=1)
def retransmit_floor_ms() -> float:
    """The control class's retransmission timeout floor, from the workload spec."""
    return float(link_profiles()["workload"]["control"].get("retransmit_timeout_ms", 300.0))


def loss_limit_pct(mode: ControlMode, rtt_ms: float) -> float:
    """The windowed loss a mode tolerates on a path with this RTT.

    If a lost packet can be retransmitted and still arrive inside the deadline
    (RTT plus the retransmit floor fits), the recovered limit applies.
    """
    spec = mode_table()[mode]
    limit = float(spec["max_loss_pct"])
    recovered = spec.get("max_loss_pct_recovered")
    if recovered is not None and rtt_ms + retransmit_floor_ms() <= float(spec["deadline_ms"]):
        return float(recovered)
    return limit


def mode_supported(obs: LinkObservation | None, mode: ControlMode) -> bool | None:
    """Receiver-side support of `mode` on one path. See `SUPPORT_DEFINITION`.

    ``True`` and ``False`` are measured facts. ``None`` means the path is ready
    but has not yet accumulated enough acknowledgements or sends for a windowed
    statistic, so nothing can honestly be said either way.
    """
    if mode is ControlMode.SAFE_HOLD:
        return True
    if obs is None or obs.phase not in (LinkPhase.ACTIVE, LinkPhase.CARRYING):
        return False
    spec = mode_table()[mode]
    if obs.rtt_ms is None or obs.loss_pct is None:
        return None
    return obs.rtt_ms <= float(spec["deadline_ms"]) and obs.loss_pct <= loss_limit_pct(mode, obs.rtt_ms)


def projected_violation(
    prediction: Prediction | None, deadline_ms: float, max_loss_pct: float
) -> bool:
    """Trend projection of the recorded prediction features against thresholds.

    Uses exactly the features the predictor recorded at decision time, so the
    judgement can be re-derived from the event. Read against the 150 ms / 3 %
    teleop thresholds this is the heuristic predictor's own violation
    definition; read against another deadline it asks the question that
    matters there: will *this* deadline be missed inside the horizon? A
    satellite path at 620 ms is not "at risk" for a 1500 ms deadline, however
    far past 150 ms it sits.
    """
    if prediction is None or not prediction.features:
        return False
    features = prediction.features
    horizon = prediction.horizon_s
    rtt_proj = features.get("rtt_ms", 0.0) + features.get("rtt_slope_ms_per_s", 0.0) * horizon
    loss_proj = features.get("loss_pct", 0.0) + features.get("loss_slope_pct_per_s", 0.0) * horizon
    coverage_slope = features.get("coverage_slope", 0.0)
    cov_proj = features.get("coverage", 0.0) + coverage_slope * horizon
    return (
        rtt_proj > deadline_ms
        or loss_proj > max_loss_pct
        or (cov_proj < 0.15 and coverage_slope < -0.02)
    )


def mode_projected_violation(prediction: Prediction | None, mode: ControlMode) -> bool:
    """`projected_violation` against a mode, with the loss limit the projected RTT earns."""
    if prediction is None or not prediction.features:
        return False
    spec = mode_table()[mode]
    features = prediction.features
    rtt_proj = features.get("rtt_ms", 0.0) + features.get("rtt_slope_ms_per_s", 0.0) * prediction.horizon_s
    return projected_violation(prediction, float(spec["deadline_ms"]), loss_limit_pct(mode, max(rtt_proj, 0.0)))


def highest_supported(support: dict[ControlMode, bool | None]) -> ControlMode:
    """The most capable mode whose support is a measured ``True``."""
    for mode in sorted(MODE_RANK, key=lambda item: MODE_RANK[item], reverse=True):
        if mode is ControlMode.SAFE_HOLD or support.get(mode) is True:
            return mode
    return ControlMode.SAFE_HOLD


def describe(obs: LinkObservation | None) -> str:
    """Measured RTT and loss for a reason string, honest about absence."""
    if obs is None:
        return "no path"
    if obs.phase not in (LinkPhase.ACTIVE, LinkPhase.CARRYING):
        return f"{obs.phase.value}, not ready to carry"
    rtt = f"RTT {obs.rtt_ms:.0f} ms" if obs.rtt_ms is not None else "RTT unavailable"
    loss = f"loss {obs.loss_pct:.1f} %" if obs.loss_pct is not None else "loss unavailable"
    return f"{rtt}, {loss}"
