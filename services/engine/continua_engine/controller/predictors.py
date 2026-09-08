"""
Predictors.

Both answer exactly one question: **will the path currently carrying the session
violate an application threshold within the next `horizon_s` seconds?**

The threshold is defined once, in `VIOLATION_DEFINITION`, and used identically
by the heuristic, by the learned model and by the offline label generator. If
those three ever disagree about what a violation is, the reported precision and
recall become meaningless.

Neither predictor is given the exogenous trace. Both see only the same windowed
observations the controller sees, which are themselves derived from delivered,
acknowledged and timed-out packets.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

from ..contracts import LinkId, LinkObservation, Prediction, VehicleObservation

VIOLATION_DEFINITION = (
    "The carrying path is in violation when, within the horizon, either "
    "(a) its smoothed RTT exceeds 150 ms — the control-class deadline — or "
    "(b) its windowed loss exceeds 3.0 %, or "
    "(c) it becomes unusable. Identical definition is used for the heuristic, "
    "the learned model and the offline labels."
)

RTT_VIOLATION_MS = 150.0
LOSS_VIOLATION_PCT = 3.0

FEATURE_ORDER = (
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
)


@dataclass(slots=True)
class LinkHistory:
    """A short trailing history per link, used to compute trends."""

    times: list[float] = field(default_factory=list)
    rtt: list[float] = field(default_factory=list)
    loss: list[float] = field(default_factory=list)
    throughput: list[float] = field(default_factory=list)
    coverage: list[float] = field(default_factory=list)
    limit: int = 120

    def push(self, t: float, obs: LinkObservation) -> None:
        self.times.append(t)
        self.rtt.append(obs.rtt_ms if obs.rtt_ms is not None else math.nan)
        self.loss.append(obs.loss_pct if obs.loss_pct is not None else math.nan)
        self.throughput.append(obs.throughput_mbps if obs.throughput_mbps is not None else math.nan)
        self.coverage.append(obs.modelled_coverage if obs.modelled_coverage is not None else math.nan)
        if len(self.times) > self.limit:
            for series in (self.times, self.rtt, self.loss, self.throughput, self.coverage):
                del series[0]

    def slope(self, series: list[float], seconds: float = 2.0) -> float:
        """Least-squares slope per second over the trailing `seconds`."""
        if len(self.times) < 3:
            return 0.0
        cutoff = self.times[-1] - seconds
        xs: list[float] = []
        ys: list[float] = []
        for t, value in zip(self.times, series):
            if t >= cutoff and not math.isnan(value):
                xs.append(t)
                ys.append(value)
        if len(xs) < 3:
            return 0.0
        n = len(xs)
        mean_x = sum(xs) / n
        mean_y = sum(ys) / n
        denominator = sum((x - mean_x) ** 2 for x in xs)
        if denominator < 1e-9:
            return 0.0
        return sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denominator

    def latest(self, series: list[float]) -> float | None:
        for value in reversed(series):
            if not math.isnan(value):
                return value
        return None


def build_features(
    history: LinkHistory,
    obs: LinkObservation,
    vehicle: VehicleObservation | None,
    alt_best_coverage: float,
) -> dict[str, float]:
    rtt = obs.rtt_ms if obs.rtt_ms is not None else 0.0
    loss = obs.loss_pct if obs.loss_pct is not None else 0.0
    throughput = obs.throughput_mbps if obs.throughput_mbps is not None else 0.0
    coverage = obs.modelled_coverage if obs.modelled_coverage is not None else 0.0
    return {
        "rtt_ms": rtt,
        "rtt_slope_ms_per_s": history.slope(history.rtt),
        "jitter_ms": obs.jitter_ms if obs.jitter_ms is not None else 0.0,
        "loss_pct": loss,
        "loss_slope_pct_per_s": history.slope(history.loss),
        "throughput_mbps": throughput,
        "throughput_slope": history.slope(history.throughput),
        "queue_depth_bytes": float(obs.queue_depth_bytes),
        "coverage": coverage,
        "coverage_slope": history.slope(history.coverage),
        "speed_mps": vehicle.speed_mps if vehicle else 0.0,
        "rtt_over_deadline": rtt / RTT_VIOLATION_MS,
        "alt_best_coverage": alt_best_coverage,
    }


# ---------------------------------------------------------------------------


class BasePredictor:
    name = "none"
    calibrated = False

    def predict(
        self,
        t: float,
        link: LinkId,
        history: LinkHistory,
        obs: LinkObservation,
        vehicle: VehicleObservation | None,
        alt_best_coverage: float,
        horizon_s: float,
    ) -> Prediction:
        return Prediction(
            predictor=self.name,
            horizon_s=horizon_s,
            violation_expected=False,
            score=None,
            calibrated=False,
            threshold=VIOLATION_DEFINITION,
            features={},
        )


class NullPredictor(BasePredictor):
    """Used by the reactive baselines and by the `P1-noPred` ablation."""

    name = "none"


class HeuristicPredictor(BasePredictor):
    """Interpretable trend extrapolation.

    Projects the current RTT, loss and coverage forward along their least-squares
    slopes and asks whether the projection crosses a threshold inside the
    horizon. No training, no tuning against the test set, and every input is
    visible in the emitted event.
    """

    name = "heuristic-trend-1.1"
    calibrated = False

    def predict(
        self,
        t: float,
        link: LinkId,
        history: LinkHistory,
        obs: LinkObservation,
        vehicle: VehicleObservation | None,
        alt_best_coverage: float,
        horizon_s: float,
    ) -> Prediction:
        features = build_features(history, obs, vehicle, alt_best_coverage)
        rtt_proj = features["rtt_ms"] + features["rtt_slope_ms_per_s"] * horizon_s
        loss_proj = features["loss_pct"] + features["loss_slope_pct_per_s"] * horizon_s
        cov_proj = features["coverage"] + features["coverage_slope"] * horizon_s

        reasons: list[str] = []
        if rtt_proj > RTT_VIOLATION_MS:
            reasons.append(f"RTT projected to {rtt_proj:.0f} ms")
        if loss_proj > LOSS_VIOLATION_PCT:
            reasons.append(f"loss projected to {loss_proj:.1f} %")
        if cov_proj < 0.15 and features["coverage_slope"] < -0.02:
            reasons.append(f"coverage projected to {cov_proj:.2f}")

        # A bounded severity score. Deliberately NOT called a probability: it is
        # not calibrated, and labelling it one would be a lie the UI would repeat.
        severity = max(
            rtt_proj / RTT_VIOLATION_MS,
            loss_proj / LOSS_VIOLATION_PCT,
            (0.15 - cov_proj) / 0.15 if features["coverage_slope"] < -0.02 else 0.0,
        )
        return Prediction(
            predictor=self.name,
            horizon_s=horizon_s,
            violation_expected=bool(reasons),
            score=round(min(max(severity, 0.0), 4.0), 4),
            calibrated=False,
            threshold=VIOLATION_DEFINITION,
            features={k: round(v, 4) for k, v in features.items()},
        )


class LearnedPredictor(BasePredictor):
    """A small tabular model trained offline on generated runs.

    Loads from `models/predictor.json` (a plain, inspectable export). If the file
    is missing, unreadable or the wrong feature version, this predictor reports
    itself unavailable and the controller falls back to the heuristic — it never
    silently degrades to guessing.
    """

    name = "learned-tabular"

    def __init__(self, model_path: Path | None = None) -> None:
        self.available = False
        self.calibrated = False
        self.threshold = 0.5
        self._trees: list = []
        self._kind = ""
        self._coef: list[float] = []
        self._intercept = 0.0
        self._mean: list[float] = []
        self._scale: list[float] = []
        self.model_version = "unavailable"
        self.model_path = model_path or (
            Path(__file__).resolve().parents[1] / "models" / "predictor.json"
        )
        self._load()

    def _load(self) -> None:
        try:
            with self.model_path.open("r", encoding="utf-8") as handle:
                blob = json.load(handle)
        except (OSError, json.JSONDecodeError):
            return
        if tuple(blob.get("features", ())) != FEATURE_ORDER:
            return
        self._kind = blob.get("kind", "")
        self.model_version = blob.get("version", "unknown")
        self.threshold = float(blob.get("decision_threshold", 0.5))
        self.calibrated = bool(blob.get("calibrated", False))
        self._mean = [float(v) for v in blob.get("standardiser", {}).get("mean", [])]
        self._scale = [float(v) for v in blob.get("standardiser", {}).get("scale", [])]
        if self._kind == "logistic":
            self._coef = [float(v) for v in blob["coef"]]
            self._intercept = float(blob["intercept"])
            self.available = len(self._coef) == len(FEATURE_ORDER)
        self.name = f"learned-{self._kind}-{self.model_version}"

    def _score(self, values: list[float]) -> float:
        if self._mean and self._scale:
            values = [
                (v - m) / (s if abs(s) > 1e-9 else 1.0)
                for v, m, s in zip(values, self._mean, self._scale)
            ]
        z = self._intercept + sum(c * v for c, v in zip(self._coef, values))
        return 1.0 / (1.0 + math.exp(-max(min(z, 60.0), -60.0)))

    def predict(
        self,
        t: float,
        link: LinkId,
        history: LinkHistory,
        obs: LinkObservation,
        vehicle: VehicleObservation | None,
        alt_best_coverage: float,
        horizon_s: float,
    ) -> Prediction:
        features = build_features(history, obs, vehicle, alt_best_coverage)
        if not self.available:
            return Prediction(
                predictor=f"{self.name} (unavailable)",
                horizon_s=horizon_s,
                violation_expected=False,
                score=None,
                calibrated=False,
                threshold=VIOLATION_DEFINITION,
                features={},
            )
        score = self._score([features[name] for name in FEATURE_ORDER])
        return Prediction(
            predictor=self.name,
            horizon_s=horizon_s,
            violation_expected=score >= self.threshold,
            score=round(score, 4),
            calibrated=self.calibrated,
            threshold=VIOLATION_DEFINITION,
            features={k: round(v, 4) for k, v in features.items()},
        )


def make_predictor(kind: str) -> BasePredictor:
    if kind == "heuristic":
        return HeuristicPredictor()
    if kind == "learned":
        learned = LearnedPredictor()
        # Documented fallback: an unavailable model must not silently become a
        # predictor that always says "no violation".
        return learned if learned.available else HeuristicPredictor()
    return NullPredictor()
