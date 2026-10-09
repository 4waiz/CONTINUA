#!/usr/bin/env python3
# Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE.
# KS-CONTINUA-46FBF3D44FF1
"""
Render docs/PHASE_5_RESULTS.md from the recorded Phase 5 comparison.

Every number in the tables is read from `data/experiments/phase5_index.json`,
the experiment files it names, and `data/experiments/phase5_headroom.json`.
Nothing is typed in by hand. The reading at the end is written against this
one run and says so.

    python scripts/phase5_results.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPERIMENTS = ROOT / "data" / "experiments"
INDEX = EXPERIMENTS / "phase5_index.json"
HEADROOM = EXPERIMENTS / "phase5_headroom.json"
OUT = ROOT / "docs" / "PHASE_5_RESULTS.md"
READING = ROOT / "docs" / "_phase5_reading.md"

POLICY_ORDER = ["B0", "B1", "B2", "B2-defer", "P1", "P1-noPred", "P3"]
BASELINES = ["P1", "P1-noPred", "B2", "B2-defer", "B1"]

#: (aggregate key, label, unit, scale, lower is better)
TABLE_METRICS = [
    ("session_reconnects", "Session reconnects", "", 1.0, True),
    ("total_interruption_s", "Total interruption", "s", 1.0, True),
    ("longest_interruption_s", "Longest interruption", "s", 1.0, True),
    ("safe_stop_runs", "Runs with a safe stop", "share", 1.0, True),
    ("control_deadline_miss_pct", "Control deadline miss", "%", 1.0, True),
    ("video_stall_ms", "Video stall", "ms", 1.0, True),
    ("bulk_completion_pct", "Bulk completed", "%", 1.0, False),
    ("satellite_bytes", "Satellite", "MB", 1e6, True),
    ("cost_units", "Cost units", "", 1.0, True),
    ("handovers", "Handovers", "", 1.0, True),
    ("route_prearms", "Gaps prepared for", "", 1.0, True),
]

#: (paired-delta key, label, scale, lower is better)
DELTA_METRICS = [
    ("total_interruption_s", "Interruption (s)", 1.0, True),
    ("session_reconnects", "Reconnects", 1.0, True),
    ("safe_stop_runs", "Safe stops", 1.0, True),
    ("control_deadline_miss_pct", "Control miss (pp)", 1.0, True),
    ("video_stall_ms", "Video stall (ms)", 1.0, True),
    ("satellite_bytes", "Satellite (MB)", 1e6, True),
    ("cost_units", "Cost", 1.0, True),
    ("handovers", "Handovers", 1.0, True),
]


def fmt(value: float | None, scale: float) -> str:
    if value is None:
        return "-"
    v = value / scale
    digits = 0 if abs(v) >= 100 else 1 if abs(v) >= 10 else 2
    return f"{v:.{digits}f}"


def cell(agg: dict, key: str, scale: float) -> str:
    stat = agg.get(key) or {}
    mean = stat.get("mean")
    if mean is None:
        return "-"
    low, high = stat.get("ci95_low"), stat.get("ci95_high")
    if low is None or high is None or stat.get("n", 0) < 2 or abs(high - low) < 1e-12:
        return fmt(mean, scale)
    return f"{fmt(mean, scale)} ±{fmt((high - low) / 2, scale)}"


def scenario_table(summary: dict) -> str:
    aggregate = summary["aggregate"]
    policies = [p for p in POLICY_ORDER if p in aggregate]
    lines = ["| Metric | " + " | ".join(policies) + " |", "| --- |" + " ---: |" * len(policies)]
    for key, label, unit, scale, lower in TABLE_METRICS:
        row = [f"{label}{f' ({unit})' if unit else ''} {'↓' if lower else '↑'}"]
        for p in policies:
            row.append(cell(aggregate[p], key, scale))
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def delta_table(summary: dict) -> str:
    deltas = summary.get("paired_deltas_p3") or {}
    lines = ["| P3 minus | " + " | ".join(label for _k, label, _s, _l in DELTA_METRICS) + " |",
             "| --- |" + " ---: |" * len(DELTA_METRICS)]
    for baseline in [b for b in BASELINES if b in deltas]:
        row = [baseline]
        for key, _label, scale, lower in DELTA_METRICS:
            entry = deltas[baseline].get(key)
            if not entry:
                row.append("-")
                continue
            mean = entry["mean_delta_treatment_minus_baseline"] / scale
            low = entry["ci95_low"] / scale
            high = entry["ci95_high"] / scale
            digits = 0 if abs(mean) >= 100 else 1 if abs(mean) >= 10 else 2
            if abs(mean) < 10 ** -digits / 2 and abs(low) < 10 ** -digits / 2 and abs(high) < 10 ** -digits / 2:
                row.append("0")
                continue
            better = (mean < 0) if lower else (mean > 0)
            conclusive = low > 0 or high < 0
            mark = "" if not conclusive else (" ✓" if better else " ✗")
            row.append(f"{'+' if mean > 0 else ''}{mean:.{digits}f} [{low:.{digits}f}, {high:.{digits}f}]{mark}")
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def identical_to_p1(summary: dict) -> tuple[bool, list[str]]:
    """Whether P3 and P1 produced the same numbers in every paired trial."""
    raw = summary.get("raw") or {}
    if "P1" not in raw or "P3" not in raw:
        return False, ["missing"]
    p1 = {run["trial"]: run for run in raw["P1"]}
    differing: set[str] = set()
    for run in raw["P3"]:
        other = p1.get(run["trial"])
        if other is None:
            differing.add("trial missing")
            continue
        for section in ("continuity", "application", "links"):
            if run.get(section) != other.get(section):
                differing.add(section)
    return not differing, sorted(differing)


def headroom_table() -> str:
    data = json.loads(HEADROOM.read_text(encoding="utf-8"))
    lines = [
        "| Scenario | Policy | Lossy-tail time with a clean path ready (s) | Control | Telemetry | Voice | Video stall | Interruption (s) |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for scenario_id, policies in data["scenarios"].items():
        for policy, row in policies.items():
            classes = row["classes"]

            def share(key: str) -> str:
                value = (classes.get(key) or {}).get("avoidable_share_pct")
                return "-" if value is None else f"{value:.2f} %"

            lines.append(
                f"| {scenario_id} | {policy} | {row['avoidable_s']:.2f} | {share('control')} | {share('telemetry')} | "
                f"{share('voice')} | {share('video_stall_ms')} | {row['total_interruption_s']:.2f} |"
            )
    return "\n".join(lines) + f"\n\nTune block, seeds {data['seeds'][0]}-{data['seeds'][-1]}; {data['definition']}."


def main() -> None:
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    summaries: dict[str, dict] = {}
    for entry in index["experiments"]:
        path = EXPERIMENTS / f"{entry['experiment_id']}.json"
        summaries[entry["scenario_id"]] = json.loads(path.read_text(encoding="utf-8"))
    first = next(iter(summaries.values()))
    failures = sum(len(s["failures"]) for s in summaries.values())
    runs = sum(sum(s["trials_completed"].values()) for s in summaries.values())
    shadow = [s for s in index["scenarios"] if s.startswith("shadow-")]
    open_route = [s for s in index["scenarios"] if not s.startswith("shadow-")]

    out: list[str] = [
        "# CONTINUA - Phase 5 results: route-aware preparation",
        "",
        "Generated by `scripts/phase5_results.py` from the recorded experiments; no number below is typed",
        "by hand. The method, the scenarios and the expectations were committed before this block was",
        "used (`docs/EXPERIMENT_METHOD.md` section 9).",
        "",
        "| | |",
        "| --- | --- |",
        f"| Seed block | `{index['block']}` (seeds {first['seeds'][0]}-{first['seeds'][-1]}), used once |",
        f"| Paired trials | {index['trials']} per scenario |",
        f"| Policies | {', '.join(index['policies'])} |",
        f"| Scenarios | {len(index['scenarios'])}: {', '.join(index['scenarios'])} |",
        f"| Runs | {runs}, {failures} failures |",
        f"| Code | `{first['code_commit'][:12] if first['code_commit'] else 'unknown'}` |",
        "",
        "Every number is a simulator result, not a live network test. In the tables, ± is the half-width",
        "of a 95 % confidence interval over trials; in the paired tables, [low, high] is the 95 % interval",
        "of the per-trial difference, ✓ marks an interval wholly on P3's better side and ✗ wholly on its",
        "worse side. Continuity in this simulator is set by geometry and activation delays, which do not",
        "vary between seeds, so many continuity intervals are zero-width.",
        "",
        "## 1. The ceiling: what a better forecast could have bought (tune block)",
        "",
        headroom_table(),
        "",
        "## 2. The shadowed route",
        "",
    ]
    for scenario_id in shadow:
        summary = summaries[scenario_id]
        out += [f"### {scenario_id}", "", scenario_table(summary), "", "Paired per trial:", "", delta_table(summary), ""]
    out += ["## 3. The original scenarios: P3 against P1", ""]
    out += ["| Scenario | P3 identical to P1 in every trial | Differs in | Gaps prepared for (P3 mean) |",
            "| --- | --- | --- | ---: |"]
    for scenario_id in open_route:
        summary = summaries[scenario_id]
        same, where = identical_to_p1(summary)
        prepared = (summary["aggregate"].get("P3", {}).get("route_prearms") or {}).get("mean")
        out.append(f"| {scenario_id} | {'yes' if same else 'no'} | {', '.join(where) or '-'} | {fmt(prepared, 1.0)} |")
    out.append("")
    for scenario_id in open_route:
        summary = summaries[scenario_id]
        out += [f"### {scenario_id}", "", scenario_table(summary), ""]
    if READING.exists():
        out += ["## 4. Reading the results", "", READING.read_text(encoding="utf-8").strip(), ""]
    OUT.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    print(f"-> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
