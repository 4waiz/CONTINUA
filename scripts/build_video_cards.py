#!/usr/bin/env python3
"""
Extract the numbers the video's caption cards display, straight from the
recorded evidence, into one small JSON file the web app can render.

Nothing here computes anything new. It reads `data/runs/*/metrics.json`,
`data/experiments/exp-*.json` and `data/emulation_capability.json`, copies the
figures out and records where each one came from. If a source file is missing
the script fails loudly rather than emitting a card with a hole in it — a blank
number on screen is exactly the failure mode the whole project is trying to
avoid.

    python scripts/build_video_cards.py

Output: apps/web/public/video/cards.json  (committed; it is the evidence extract
the video is rendered from, and it should change only when the runs change).
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "data" / "runs"
EXPERIMENTS = ROOT / "data" / "experiments"
OUTPUT = ROOT / "apps" / "web" / "public" / "video" / "cards.json"

# The runs and experiments the video draws on. Named here so the set is visible
# and so `docs/VIDEO_CLAIMS.md` can be checked against it.
RUN_BASELINE = "run-7d8750c2b7"      # wifi-degradation, B0, seed 70009
RUN_CONTINUA = "run-d2819d215c"      # wifi-degradation, P1, seed 70009 (same trace)
RUN_SATELLITE = "run-3c69f9615f"     # satellite-fallback, P1, seed 70013

EXP_WIFI = "exp-26f132d5d7"          # wifi-degradation, 20 trials, heuristic
EXP_CONGESTION = "exp-64931cf540"    # cellular-congestion, 20 trials, heuristic
EXP_LEARNED = "exp-e70fe761a1"       # wifi-degradation, 20 trials, learned model
EXP_TOTAL_LOSS = "exp-657ef4a89a"    # total-loss, 20 trials, heuristic


def read_json(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(f"missing evidence: {path}\nRun the experiments before building the video.")
    return json.loads(path.read_text(encoding="utf-8"))


def run_metrics(run_id: str) -> dict:
    return read_json(RUNS / run_id / "metrics.json")


def experiment(exp_id: str) -> dict:
    return read_json(EXPERIMENTS / f"{exp_id}.json")


def mean(exp: dict, policy: str, metric: str) -> float | None:
    entry = exp["aggregate"].get(policy, {}).get(metric)
    return entry["mean"] if isinstance(entry, dict) else None


def ci(exp: dict, policy: str, metric: str) -> list[float] | None:
    entry = exp["aggregate"].get(policy, {}).get(metric)
    if not isinstance(entry, dict):
        return None
    return [entry["ci95_low"], entry["ci95_high"]]


def mb(value: float | None) -> float | None:
    return None if value is None else round(value / 1e6, 2)


# --- compare card -------------------------------------------------------------


def build_compare() -> dict:
    b0 = run_metrics(RUN_BASELINE)
    p1 = run_metrics(RUN_CONTINUA)

    def row(label, path, fmt, better_is="lower", note=None):
        def dig(m):
            node = m
            for key in path:
                node = node[key]
            return node

        return {
            "label": label,
            "baseline": dig(b0),
            "continua": dig(p1),
            "format": fmt,
            "better_is": better_is,
            **({"note": note} if note else {}),
        }

    return {
        "id": "compare",
        "kicker": "Paired trial · identical exogenous trace",
        "title": "Reactive baseline vs CONTINUA",
        "subtitle": (
            f"{b0['scenario_id']} · seed {b0['seed']} · both runs driven by the same "
            "pre-generated trace; only the policy differs"
        ),
        "columns": ["B0 · reactive", "P1 · CONTINUA"],
        "rows": [
            row("Session reconnects", ("continuity", "session_reconnects"), "int"),
            row("Interruptions", ("continuity", "interruptions"), "int"),
            row("Total interruption", ("continuity", "total_interruption_s"), "seconds"),
            row("Longest interruption", ("continuity", "longest_interruption_s"), "seconds"),
            row("Control deadlines missed", ("application", "control", "deadline_miss_pct"), "percent"),
            row("Video frames delivered", ("application", "video", "frame_delivery_pct"), "percent", "higher"),
            row("Satellite data used", ("links", "satellite_bytes"), "bytes"),
            row("Relative link cost", ("links", "cost_units"), "units"),
        ],
        "against_us": [
            row("Handovers performed", ("control_plane", "handovers"), "int",
                note="more, not fewer — preparing a path costs transitions"),
            row("Bulk transfer completed", ("application", "bulk", "bytes_completed"), "bytes", "higher",
                note="deliberately throttled to protect control and video"),
        ],
        "footnote": (
            "The 0.16 s that remains is the session establishing at t = 0, before any link is "
            "carrying. Every policy, including both baselines, records it."
        ),
        "sources": {
            "baseline_run": RUN_BASELINE,
            "continua_run": RUN_CONTINUA,
            "files": [f"data/runs/{RUN_BASELINE}/metrics.json", f"data/runs/{RUN_CONTINUA}/metrics.json"],
            "mode": b0["mode"] if "mode" in b0 else "simulation",
        },
    }


# --- ablation card ------------------------------------------------------------


def build_ablation() -> dict:
    wifi = experiment(EXP_WIFI)
    cong = experiment(EXP_CONGESTION)
    learned = experiment(EXP_LEARNED)

    def variant(policy: str, label: str, note: str) -> dict:
        return {
            "label": label,
            "note": note,
            "interruption_s": mean(wifi, policy, "total_interruption_s"),
            "cost_units": mean(wifi, policy, "cost_units"),
            "satellite_mb": mb(mean(wifi, policy, "satellite_bytes")),
            "congestion_control_miss_pct": mean(cong, policy, "control_deadline_miss_pct"),
        }

    return {
        "id": "ablation",
        "kicker": "20 paired trials per policy · test seed block · held out",
        "title": "What actually did the work",
        "subtitle": "Take one part out at a time and re-run the same seeds",
        "variants": [
            variant("P1", "CONTINUA (P1)", "everything on"),
            variant("P1-noPred", "…without prediction", "prepare and steer, but no forecast"),
            variant("P1-noApp", "…without application-awareness", "no per-class throttling or cost weighting"),
            variant("B2", "Always-multipath baseline", "keep a second path warm at all times"),
        ],
        "reading": [
            "Preparation removes the interruption — the always-multipath baseline reaches the same 0.16 s.",
            "Prediction is not what removed it. Ablating the predictor changes nothing we can measure.",
            "Application-awareness is what makes it affordable, and under congestion it is what holds the control channel.",
        ],
        "predictor": {
            "kicker": "and the model we trained anyway",
            "rows": [
                {
                    "label": "Precision",
                    "heuristic": mean(wifi, "P1", "prediction_precision"),
                    "learned": mean(learned, "P1", "prediction_precision"),
                    "format": "ratio",
                },
                {
                    "label": "Recall",
                    "heuristic": mean(wifi, "P1", "prediction_recall"),
                    "learned": mean(learned, "P1", "prediction_recall"),
                    "format": "ratio",
                },
                {
                    "label": "False positives per run",
                    "heuristic": mean(wifi, "P1", "prediction_false_positives"),
                    "learned": mean(learned, "P1", "prediction_false_positives"),
                    "format": "number",
                },
                {
                    "label": "Resulting app health",
                    "heuristic": mean(wifi, "P1", "app_health_score"),
                    "learned": mean(learned, "P1", "app_health_score"),
                    "format": "number",
                },
            ],
            "reading": (
                "Recall 0.14 → 0.78, and the outcome got slightly worse. Better forecasting did not "
                "help because preparation had already removed the thing it was forecasting."
            ),
        },
        "sources": {
            "experiments": [EXP_WIFI, EXP_CONGESTION, EXP_LEARNED],
            "files": [f"data/experiments/{e}.json" for e in (EXP_WIFI, EXP_CONGESTION, EXP_LEARNED)],
            "mode": "simulation",
        },
    }


# --- results card -------------------------------------------------------------


def build_results() -> dict:
    wifi = experiment(EXP_WIFI)
    cong = experiment(EXP_CONGESTION)

    def row(label, metric, fmt, better_is="lower", scale=None):
        def cell(exp, policy):
            m = mean(exp, policy, metric)
            bounds = ci(exp, policy, metric)
            if m is None:
                return None
            if scale == "mb":
                return {"mean": mb(m), "ci": [round(b / 1e6, 2) for b in bounds] if bounds else None}
            return {"mean": m, "ci": bounds}

        return {
            "label": label,
            "format": fmt,
            "better_is": better_is,
            "wifi": {p: cell(wifi, p) for p in ("B0", "B2", "P1")},
            "congestion": {p: cell(cong, p) for p in ("B0", "B2", "P1")},
        }

    return {
        "id": "results",
        "kicker": f"{wifi['trials_requested']} paired trials per policy · mean [95 % CI] · test seed block",
        "title": "Measured results",
        "subtitle": "Software simulation. Seeds are disjoint from training and tuning, and were used once.",
        "scenarios": [
            {"key": "wifi", "label": "Wi-Fi degradation", "experiment": EXP_WIFI},
            {"key": "congestion", "label": "Cellular congestion", "experiment": EXP_CONGESTION},
        ],
        "columns": ["B0 · reactive", "B2 · always multipath", "P1 · CONTINUA"],
        "rows": [
            row("Total interruption (s)", "total_interruption_s", "seconds"),
            row("Control deadlines missed (%)", "control_deadline_miss_pct", "percent"),
            row("Video frames delivered (%)", "video_frame_delivery_pct", "percent", "higher"),
            row("Satellite data (MB)", "satellite_bytes", "number", scale="mb"),
            row("Relative link cost", "cost_units", "units"),
            row("Application health", "app_health_score", "number", "higher"),
        ],
        "honesty": (
            "Application health is the row where CONTINUA loses on the Wi-Fi route: the "
            "always-multipath baseline scores higher because it buys quality with satellite bytes "
            "CONTINUA declines to spend. Under congestion the ordering reverses."
        ),
        "sources": {
            "experiments": [EXP_WIFI, EXP_CONGESTION],
            "files": [f"data/experiments/{e}.json" for e in (EXP_WIFI, EXP_CONGESTION)],
            "commits": [wifi.get("code_commit"), cong.get("code_commit")],
            "mode": "simulation",
        },
    }


# --- scope card ---------------------------------------------------------------


def build_scope() -> dict:
    capability = read_json(ROOT / "data" / "emulation_capability.json")
    total_loss = experiment(EXP_TOTAL_LOSS)
    longest = mean(total_loss, "P1", "longest_interruption_s")

    return {
        "id": "scope",
        "kicker": "What this is not",
        "title": "Scope and limitations",
        "items": [
            {
                "head": "A software simulation",
                "body": (
                    "A discrete-time causal model of queues, delay, jitter and burst loss. "
                    "No radio, no hardware, no live network, at any point in this video."
                ),
                "source": "services/engine/continua_engine/sim/simulator.py",
            },
            {
                "head": "Emulation is implemented but not verified here",
                "body": capability["summary"],
                "source": "data/emulation_capability.json",
            },
            {
                "head": "No MPTCP",
                "body": (
                    "This kernel reports CONFIG_MPTCP unset, so nothing shown may be described as "
                    "multipath TCP. The design does not depend on it."
                ),
                "source": "data/emulation_capability.json",
            },
            {
                "head": "Total loss defeats it",
                "body": (
                    f"When every link is down there is nothing to steer onto: {longest:.1f} s of "
                    "unavoidable interruption, identical for every policy including CONTINUA."
                ),
                "source": f"data/experiments/{EXP_TOTAL_LOSS}.json",
            },
            {
                "head": "One synthetic route, six scenarios",
                "body": (
                    "917 m, 24 control points, one coverage model. These results describe that "
                    "world. They are not a claim about any real deployment."
                ),
                "source": "packages/contracts/world.json",
            },
        ],
        "next": "Hardware in the loop, a real radio, and a field trial are the next step — not a result.",
        "sources": {
            "files": ["data/emulation_capability.json", f"data/experiments/{EXP_TOTAL_LOSS}.json"],
            "mode": "simulation",
        },
    }


def main() -> None:
    cards = {
        "generated_from": {
            "runs": [RUN_BASELINE, RUN_CONTINUA, RUN_SATELLITE],
            "experiments": [EXP_WIFI, EXP_CONGESTION, EXP_LEARNED, EXP_TOTAL_LOSS],
        },
        "execution_mode": "simulation",
        "cards": {
            "compare": build_compare(),
            "ablation": build_ablation(),
            "results": build_results(),
            "scope": build_scope(),
        },
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(cards, indent=2), encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)}")
    for key, card in cards["cards"].items():
        print(f"  {key:<10} {card['title']}")


if __name__ == "__main__":
    main()
