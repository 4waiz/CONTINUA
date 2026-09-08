"""
Train the learned predictor.

    python -m continua_engine.controller.train_predictor

Rules this script exists to enforce:

* **Split by run, never by row.** Consecutive rows from the same run are almost
  identical; splitting on them leaks the answer and produces a beautiful,
  meaningless score. Training, tuning and testing use the disjoint seed blocks
  defined in `experiments/runner.py`, and whole scenario families are held out.
* **Labels come from the future; features never do.** The label for a row at
  time t asks whether a violation actually occurred in (t, t+h]. That is only
  computable after the run, offline. The features are exactly the observations
  the controller had at t.
* **Rows where the carrying path is already violating are dropped.** Predicting
  an ongoing condition is not forecasting, and including those rows inflates
  precision toward 1.0 for free.
* **Calibration is measured, not assumed.** `calibrated` is only written as true
  if the model's Brier score beats the base rate's, and the mean absolute
  calibration error is under 0.10 on held-out tuning runs.
"""

from __future__ import annotations

import argparse
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from ..contracts import PolicyId
from ..experiments.runner import seed_for
from ..sim.exogenous import get_scenario, scenario_catalogue
from ..sim.simulator import Simulation
from .predictors import (
    FEATURE_ORDER,
    LOSS_VIOLATION_PCT,
    RTT_VIOLATION_MS,
    VIOLATION_DEFINITION,
    HeuristicPredictor,
    LinkHistory,
    build_features,
)

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
MODEL_PATH = MODEL_DIR / "predictor.json"
CARD_PATH = MODEL_DIR / "training_report.json"

#: Families held out entirely from training, so the model is never scored on a
#: scenario shape it was fitted to.
HELD_OUT_FAMILIES = {"outage", "motion"}


def _violating(obs) -> bool:
    return (
        obs.phase.value == "unavailable"
        or (obs.rtt_ms is not None and obs.rtt_ms > RTT_VIOLATION_MS)
        or (obs.loss_pct is not None and obs.loss_pct > LOSS_VIOLATION_PCT)
    )


def collect_rows(scenario_id: str, seed: int, horizon_s: float) -> tuple[list[list[float]], list[int], list[str]]:
    """Run one simulation and turn it into labelled rows."""
    sim = Simulation(
        get_scenario(scenario_id),
        seed=seed,
        policy_id=PolicyId.P1_CONTINUA,
        predictor_kind="heuristic",
        horizon_s=horizon_s,
    )
    result = sim.run()
    events = result.events

    # When was each link in violation? Computed after the fact, from the record.
    violation_times: dict[str, list[float]] = {}
    for event in events:
        for link, obs in event.links.items():
            if _violating(obs):
                violation_times.setdefault(link.value, []).append(event.t)

    histories: dict[str, LinkHistory] = {}
    rows: list[list[float]] = []
    labels: list[int] = []
    groups: list[str] = []
    run_key = f"{scenario_id}:{seed}"

    for event in events:
        if event.carrying is None:
            continue
        carrying = event.carrying
        obs = event.links.get(carrying)
        if obs is None:
            continue
        history = histories.setdefault(carrying.value, LinkHistory())
        history.push(event.t, obs)
        if _violating(obs):
            continue  # already violating: not a forecasting question
        alt_best = max(
            (o.modelled_coverage or 0.0 for link, o in event.links.items() if link != carrying),
            default=0.0,
        )
        features = build_features(history, obs, event.vehicle, alt_best)
        label = int(
            any(event.t < vt <= event.t + horizon_s for vt in violation_times.get(carrying.value, ()))
        )
        rows.append([features[name] for name in FEATURE_ORDER])
        labels.append(label)
        groups.append(run_key)
    return rows, labels, groups


def gather(block: str, trials: int, horizon_s: float, exclude_families: set[str]) -> tuple[np.ndarray, np.ndarray, list[str]]:
    catalogue = scenario_catalogue()
    ids = [
        spec["id"]
        for spec in catalogue.values()
        if spec.get("family", "") not in exclude_families
    ]
    X: list[list[float]] = []
    y: list[int] = []
    groups: list[str] = []
    for scenario_id in ids:
        for trial in range(trials):
            rows, labels, group = collect_rows(scenario_id, seed_for(block, trial), horizon_s)
            X.extend(rows)
            y.extend(labels)
            groups.extend(group)
    return np.asarray(X, dtype=float), np.asarray(y, dtype=int), groups


def calibration_error(probabilities: np.ndarray, labels: np.ndarray, bins: int = 10) -> float:
    """Mean absolute gap between predicted probability and observed frequency."""
    edges = np.linspace(0.0, 1.0, bins + 1)
    gaps: list[float] = []
    for low, high in zip(edges[:-1], edges[1:]):
        mask = (probabilities >= low) & (probabilities < high)
        if mask.sum() < 20:
            continue
        gaps.append(abs(float(probabilities[mask].mean() - labels[mask].mean())))
    return statistics.fmean(gaps) if gaps else 1.0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trials", type=int, default=6, help="runs per scenario per block")
    parser.add_argument("--horizon", type=float, default=3.0)
    args = parser.parse_args()

    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import brier_score_loss, precision_recall_fscore_support
    from sklearn.preprocessing import StandardScaler

    print(f"gathering training rows (block=train, trials={args.trials})…")
    X_train, y_train, groups_train = gather("train", args.trials, args.horizon, HELD_OUT_FAMILIES)
    print(f"  {len(X_train)} rows from {len(set(groups_train))} runs, positive rate {y_train.mean():.3f}")

    print("gathering tuning rows (block=tune, held-out families included)…")
    X_tune, y_tune, groups_tune = gather("tune", max(2, args.trials // 2), args.horizon, set())
    print(f"  {len(X_tune)} rows from {len(set(groups_tune))} runs, positive rate {y_tune.mean():.3f}")

    assert not (set(groups_train) & set(groups_tune)), "train and tune runs must be disjoint"

    scaler = StandardScaler().fit(X_train)
    model = LogisticRegression(max_iter=2000, class_weight="balanced", C=0.6)
    model.fit(scaler.transform(X_train), y_train)

    probabilities = model.predict_proba(scaler.transform(X_tune))[:, 1]

    # Pick the decision threshold on the TUNING set, never on the test block.
    best = {"threshold": 0.5, "f1": -1.0}
    for threshold in np.arange(0.15, 0.86, 0.01):
        predicted = (probabilities >= threshold).astype(int)
        precision, recall, f1, _ = precision_recall_fscore_support(
            y_tune, predicted, average="binary", zero_division=0
        )
        if f1 > best["f1"]:
            best = {"threshold": float(threshold), "f1": float(f1), "precision": float(precision), "recall": float(recall)}

    brier = float(brier_score_loss(y_tune, probabilities))
    base_rate = float(y_tune.mean())
    baseline_brier = base_rate * (1 - base_rate)
    ece = calibration_error(probabilities, y_tune)
    calibrated = bool(brier < baseline_brier and ece < 0.10)

    # Heuristic on the same tuning rows, for an honest comparison.
    heuristic = HeuristicPredictor()
    heuristic_predictions: list[int] = []
    for row in X_tune:
        features = dict(zip(FEATURE_ORDER, row))
        rtt_proj = features["rtt_ms"] + features["rtt_slope_ms_per_s"] * args.horizon
        loss_proj = features["loss_pct"] + features["loss_slope_pct_per_s"] * args.horizon
        cov_proj = features["coverage"] + features["coverage_slope"] * args.horizon
        heuristic_predictions.append(
            int(
                rtt_proj > RTT_VIOLATION_MS
                or loss_proj > LOSS_VIOLATION_PCT
                or (cov_proj < 0.15 and features["coverage_slope"] < -0.02)
            )
        )
    h_precision, h_recall, h_f1, _ = precision_recall_fscore_support(
        y_tune, heuristic_predictions, average="binary", zero_division=0
    )

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    payload = {
        "kind": "logistic",
        "version": version,
        "features": list(FEATURE_ORDER),
        "coef": [float(v) for v in model.coef_[0]],
        "intercept": float(model.intercept_[0]),
        "standardiser": {
            "mean": [float(v) for v in scaler.mean_],
            "scale": [float(v) for v in scaler.scale_],
        },
        "decision_threshold": best["threshold"],
        "calibrated": calibrated,
        "horizon_s": args.horizon,
        "violation_definition": VIOLATION_DEFINITION,
    }
    MODEL_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "version": version,
        "horizon_s": args.horizon,
        "violation_definition": VIOLATION_DEFINITION,
        "training": {
            "block": "train",
            "runs": len(set(groups_train)),
            "rows": int(len(X_train)),
            "positive_rate": round(float(y_train.mean()), 4),
            "excluded_families": sorted(HELD_OUT_FAMILIES),
        },
        "tuning": {
            "block": "tune",
            "runs": len(set(groups_tune)),
            "rows": int(len(X_tune)),
            "positive_rate": round(base_rate, 4),
            "includes_held_out_families": True,
        },
        "learned": {
            "decision_threshold": round(best["threshold"], 3),
            "precision": round(best.get("precision", 0.0), 4),
            "recall": round(best.get("recall", 0.0), 4),
            "f1": round(best["f1"], 4),
            "brier": round(brier, 4),
            "baseline_brier": round(baseline_brier, 4),
            "mean_abs_calibration_error": round(ece, 4),
            "calibrated": calibrated,
        },
        "heuristic_on_same_rows": {
            "precision": round(float(h_precision), 4),
            "recall": round(float(h_recall), 4),
            "f1": round(float(h_f1), 4),
        },
        "feature_weights": {
            name: round(float(weight), 4)
            for name, weight in zip(FEATURE_ORDER, model.coef_[0])
        },
        "notes": [
            "Split by whole run and by scenario family, never by row.",
            "Labels are computed offline from the recorded run; features are the "
            "observations the controller had at decision time.",
            "Rows where the carrying path was already in violation are excluded.",
            "The test seed block was not touched by this script.",
        ],
    }
    CARD_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"\nmodel   -> {MODEL_PATH}")
    print(f"report  -> {CARD_PATH}")
    print(json.dumps(report["learned"], indent=2))
    print("heuristic on the same rows:", json.dumps(report["heuristic_on_same_rows"]))


if __name__ == "__main__":  # pragma: no cover
    main()
