#!/usr/bin/env python3
"""
Render docs/PHASE_4_RESULTS.md from the recorded Phase 4 experiments.

Every number in the document is read from `data/experiments/phase4_index.json`,
the experiment files it names, and `data/experiments/phase4_tune.json`. Nothing
is typed in by hand, so the tables cannot drift from the data; the prose
sections at the bottom are written against one specific run and say so.

    python scripts/phase4_results.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPERIMENTS = ROOT / "data" / "experiments"
INDEX = EXPERIMENTS / "phase4_index.json"
TUNE = EXPERIMENTS / "phase4_tune.json"
OUT = ROOT / "docs" / "PHASE_4_RESULTS.md"

POLICY_ORDER = ["B0", "B1", "B2", "B2-defer", "P1", "P1-noPred", "P1-noApp", "P2", "P2-noSteer", "P2-noMode", "P2-reactiveMode"]
BASELINES_FOR_P2 = ["B1", "B2", "B2-defer", "P1"]

#: (aggregate key, label, unit, scale, lower is better)
TABLE_METRICS = [
    ("session_reconnects", "Session reconnects", "", 1.0, True),
    ("total_interruption_s", "Total interruption", "s", 1.0, True),
    ("teleop_availability_pct", "Teleop availability", "%", 1.0, False),
    ("unsupported_mode_s", "Unsupported-mode time", "s", 1.0, True),
    ("conservative_mode_s", "Held below a supported mode", "s", 1.0, True),
    ("mode_changes", "Mode changes", "", 1.0, True),
    ("control_deadline_miss_pct", "Control deadline miss", "%", 1.0, True),
    ("voice_deadline_miss_pct", "Voice deadline miss", "%", 1.0, True),
    ("video_stall_ms", "Video stall", "ms", 1.0, True),
    ("bulk_completion_pct", "Bulk completed", "%", 1.0, False),
    ("app_health_score", "App health", "", 1.0, False),
    ("satellite_bytes", "Satellite", "MB", 1e6, True),
    ("satellite_bytes_excl_bulk", "Satellite excl. bulk", "MB", 1e6, True),
    ("cost_units", "Cost units", "", 1.0, True),
    ("handovers", "Handovers", "", 1.0, True),
    ("class_steers", "Class steers", "", 1.0, True),
]

DELTA_METRICS = [
    ("teleop_availability_pct", "Teleop avail. (pp)", 1.0, False),
    ("unsupported_mode_s", "Unsupported (s)", 1.0, True),
    ("conservative_mode_s", "Held below (s)", 1.0, True),
    ("control_deadline_miss_pct", "Control miss (pp)", 1.0, True),
    ("video_stall_ms", "Video stall (ms)", 1.0, True),
    ("total_interruption_s", "Interruption (s)", 1.0, True),
    ("satellite_bytes", "Satellite (MB)", 1e6, True),
    ("satellite_bytes_excl_bulk", "Sat. excl. bulk (MB)", 1e6, True),
    ("cost_units", "Cost", 1.0, True),
    ("app_health_score", "Health", 1.0, False),
    ("mode_changes", "Mode changes", 1.0, True),
]


def fmt(value: float | None, unit: str, scale: float) -> str:
    if value is None:
        return "-"
    v = value / scale
    digits = 0 if abs(v) >= 100 else 1 if abs(v) >= 10 else 2
    return f"{v:.{digits}f}"


def cell(agg: dict, key: str, unit: str, scale: float) -> str:
    stat = agg.get(key) or {}
    mean = stat.get("mean")
    if mean is None:
        return "-"
    low, high = stat.get("ci95_low"), stat.get("ci95_high")
    if low is None or high is None or stat.get("n", 0) < 2:
        return fmt(mean, unit, scale)
    half = (high - low) / 2
    return f"{fmt(mean, unit, scale)} ±{fmt(half, unit, scale)}"


def scenario_table(summary: dict) -> str:
    aggregate = summary["aggregate"]
    policies = [p for p in POLICY_ORDER if p in aggregate]
    lines = ["| Metric | " + " | ".join(policies) + " |", "| --- |" + " ---: |" * len(policies)]
    for key, label, unit, scale, lower in TABLE_METRICS:
        row = [f"{label}{f' ({unit})' if unit else ''} {'↓' if lower else '↑'}"]
        means = {p: (aggregate[p].get(key) or {}).get("mean") for p in policies}
        present = {p: m for p, m in means.items() if m is not None}
        best = None
        if present:
            best = min(present, key=present.get) if lower else max(present, key=present.get)
        for p in policies:
            text = cell(aggregate[p], key, unit, scale)
            row.append(f"**{text}**" if p == best and text != "-" else text)
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def delta_table(summary: dict) -> str:
    deltas = summary.get("paired_deltas_p2") or {}
    baselines = [b for b in BASELINES_FOR_P2 if b in deltas]
    if not baselines:
        return "_No P2 pairing recorded._"
    lines = ["| P2 minus | " + " | ".join(label for _k, label, _s, _l in DELTA_METRICS) + " |",
             "| --- |" + " ---: |" * len(DELTA_METRICS)]
    for baseline in baselines:
        row = [baseline]
        for key, _label, scale, lower in DELTA_METRICS:
            entry = deltas[baseline].get(key)
            if not entry:
                row.append("-")
                continue
            mean = entry["mean_delta_treatment_minus_baseline"] / scale
            low = entry.get("ci95_low", mean) / scale
            high = entry.get("ci95_high", mean) / scale
            sign = "+" if mean > 0 else ""
            better = (mean < 0) if lower else (mean > 0)
            conclusive = (low > 0 or high < 0)
            mark = "" if not conclusive else (" ✓" if better else " ✗")
            digits = 0 if abs(mean) >= 100 else 1 if abs(mean) >= 10 else 2
            row.append(f"{sign}{mean:.{digits}f} [{low:.{digits}f}, {high:.{digits}f}]{mark}")
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def worse_rows(summaries: dict[str, dict]) -> list[str]:
    """Every (scenario, baseline, metric) where P2's paired 95 % CI is wholly on the worse side."""
    out: list[str] = []
    for scenario_id, summary in summaries.items():
        deltas = summary.get("paired_deltas_p2") or {}
        for baseline in BASELINES_FOR_P2:
            row = deltas.get(baseline) or {}
            for key, label, scale, lower in DELTA_METRICS:
                entry = row.get(key)
                if not entry:
                    continue
                low = entry.get("ci95_low")
                high = entry.get("ci95_high")
                if low is None or high is None:
                    continue
                worse = (low > 0) if lower else (high < 0)
                if worse:
                    mean = entry["mean_delta_treatment_minus_baseline"] / scale
                    digits = 0 if abs(mean) >= 100 else 1 if abs(mean) >= 10 else 2
                    out.append(
                        f"| {scenario_id} | {baseline} | {label} | {'+' if mean > 0 else ''}{mean:.{digits}f} "
                        f"[{low / scale:.{digits}f}, {high / scale:.{digits}f}] |"
                    )
    return out


def ablation_table(summaries: dict[str, dict], left: str, right: str, metrics: list[tuple[str, str, float, bool]]) -> str:
    """Mean-of-means difference `left − right` per scenario, from aggregates."""
    lines = ["| Scenario | " + " | ".join(label for _k, label, _s, _l in metrics) + " |",
             "| --- |" + " ---: |" * len(metrics)]
    for scenario_id, summary in summaries.items():
        agg = summary["aggregate"]
        if left not in agg or right not in agg:
            continue
        row = [scenario_id]
        for key, _label, scale, _lower in metrics:
            a = (agg[left].get(key) or {}).get("mean")
            b = (agg[right].get(key) or {}).get("mean")
            if a is None or b is None:
                row.append("-")
                continue
            d = (a - b) / scale
            digits = 0 if abs(d) >= 100 else 1 if abs(d) >= 10 else 2
            row.append(f"{'+' if d > 0 else ''}{d:.{digits}f}")
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def tune_table(tune: dict) -> str:
    lines = ["| hold s | debounce s | teleop avail % | unsupported s | held below s | mode changes | class steers | control miss % | cost |",
             "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    chosen = tune["chosen"]
    for row in tune["cells"]:
        c = row["cell"]
        mark = " **(chosen)**" if c == chosen else ""
        lines.append(
            f"| {c['mode_up_hold_s']} | {c['measurement_debounce_s']} | {row['teleop_availability_pct']:.2f} | "
            f"{row['unsupported_mode_s']:.2f} | {row['conservative_mode_s']:.2f} | {row['mode_changes']:.2f} | "
            f"{row['class_steers']:.2f} | {row['control_deadline_miss_pct']:.2f} | {row['cost_units']:.3f}{mark} |"
        )
    return "\n".join(lines)


def main() -> None:
    if not INDEX.exists():
        raise SystemExit(f"{INDEX} not found: run scripts/phase4_experiment.py first")
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    tune = json.loads(TUNE.read_text(encoding="utf-8")) if TUNE.exists() else None
    summaries: dict[str, dict] = {}
    for entry in index["experiments"]:
        path = EXPERIMENTS / f"{entry['experiment_id']}.json"
        summaries[entry["scenario_id"]] = json.loads(path.read_text(encoding="utf-8"))

    first = next(iter(summaries.values()))
    trials = index["trials"]
    policies = first["policies"]
    total_runs = sum(sum(s["trials_completed"].values()) for s in summaries.values())
    failures = sum(len(s["failures"]) for s in summaries.values())
    seeds = first["seeds"]

    parts: list[str] = []
    parts.append(f"""# CONTINUA - Phase 4 results

Generated by `scripts/phase4_results.py` from `data/experiments/phase4_index.json`.
Every figure below is read from the recorded experiment files; none is typed
in. Means carry a 95 % confidence interval on the mean (normal approximation,
`±` is the half-width); paired deltas carry the interval on the per-trial
difference, which is the sensitive comparison.

| | |
| --- | --- |
| Seed block | `{index['block']}` (seeds {seeds[0]}–{seeds[-1]}), used once |
| Scenarios | {len(summaries)}: {', '.join(summaries)} |
| Policies | {len(policies)}: {', '.join(policies)} |
| Paired trials per scenario | {trials} |
| Runs completed | **{total_runs}**, {failures} failures |
| Code commit | `{(first.get('code_commit') or 'unknown')[:12]}` |
| Execution mode | simulation (deterministic software model; not a live network, not emulation) |
| Wall time | {index.get('elapsed_s', 0) / 60:.0f} min, {len(summaries)} scenarios in parallel processes |

What the policies are is in `docs/EXPERIMENT_METHOD.md`; what every metric
means is in `docs/METRICS.md` (section 10 for the mode metrics). The strict
figure to compare across policies with and without mode handover is
**teleop availability**: a relaxed deadline cannot raise it.

Marking: **bold** is the best mean in a row. Marking is not a significance
test. In the paired-delta tables ✓ marks a difference whose 95 % interval
excludes zero in P2's favour and ✗ one that excludes zero against P2; an
unmarked delta is inconclusive at 20 trials.
""")

    if tune is not None:
        parts.append(f"""## 1. Tuning, on the tune block only

Grid over the two hysteresis constants, {tune['trials']} paired trials of P2 on
{', '.join(tune['scenarios'])}, seed block `{tune['block']}`. The selection
rule was written in `scripts/phase4_tune.py` before the grid ran:

> {tune['selection_rule']}

{tune_table(tune)}

Chosen: upshift hold **{tune['chosen']['mode_up_hold_s']} s**, measurement
debounce **{tune['chosen']['measurement_debounce_s']} s** (applied to both the
mode downshift and the steering leave debounce). The table shows the trade the
rule made: a longer hold buys fewer mode changes and less unsupported time at
the cost of teleop availability. Nothing on `test` or `test2` was touched
during tuning.
""")

    parts.append("## 2. Per-scenario results, means with 95 % CI\n")
    for scenario_id, summary in summaries.items():
        completed = summary["trials_completed"]
        parts.append(f"""### {scenario_id}

Experiment `{summary['experiment_id']}`, {min(completed.values())}–{max(completed.values())} completed trials per policy.

{scenario_table(summary)}

Paired per-trial deltas, P2 minus baseline (mean [95 % CI]):

{delta_table(summary)}
""")

    worse = worse_rows(summaries)
    parts.append("""## 3. Where P2 is worse

Every scenario, baseline and metric where the paired 95 % interval of
`P2 − baseline` lies wholly on the worse side. Nothing is filtered out of this
list; if it is empty, no conclusive loss was recorded.

| Scenario | Baseline | Metric | P2 − baseline [95 % CI] |
| --- | --- | --- | ---: |
""" + ("\n".join(worse) if worse else "| - | - | - | - |") + "\n")

    abl_metrics = [
        ("teleop_availability_pct", "Teleop avail. (pp)", 1.0, False),
        ("unsupported_mode_s", "Unsupported (s)", 1.0, True),
        ("conservative_mode_s", "Held below (s)", 1.0, True),
        ("control_deadline_miss_pct", "Control miss (pp)", 1.0, True),
        ("video_stall_ms", "Video stall (ms)", 1.0, True),
        ("cost_units", "Cost", 1.0, True),
        ("mode_changes", "Mode changes", 1.0, True),
        ("class_steers", "Class steers", 1.0, True),
    ]
    parts.append(f"""## 4. Ablations, differences of means per scenario

Does steering help? `P2 − P2-noSteer`:

{ablation_table(summaries, "P2", "P2-noSteer", abl_metrics)}

Does anticipation help? `P2 − P2-reactiveMode`:

{ablation_table(summaries, "P2", "P2-reactiveMode", abl_metrics)}

Does mode handover help, with steering held fixed? `P2 − P2-noMode`:

{ablation_table(summaries, "P2", "P2-noMode", abl_metrics)}

How much of P1's satellite saving was bulk deferral? `B2-defer − B2` and `P1 − B2-defer`:

{ablation_table(summaries, "B2-defer", "B2", [("satellite_bytes", "Satellite (MB)", 1e6, True), ("satellite_bytes_excl_bulk", "Sat. excl. bulk (MB)", 1e6, True), ("cost_units", "Cost", 1.0, True), ("bulk_completion_pct", "Bulk completed (pp)", 1.0, False), ("app_health_score", "Health", 1.0, False)])}

{ablation_table(summaries, "P1", "B2-defer", [("satellite_bytes", "Satellite (MB)", 1e6, True), ("satellite_bytes_excl_bulk", "Sat. excl. bulk (MB)", 1e6, True), ("cost_units", "Cost", 1.0, True), ("control_deadline_miss_pct", "Control miss (pp)", 1.0, True), ("video_stall_ms", "Video stall (ms)", 1.0, True), ("app_health_score", "Health", 1.0, False)])}
""")

    reading = (ROOT / "docs" / "_phase4_reading.md")
    if reading.exists():
        parts.append(reading.read_text(encoding="utf-8"))

    OUT.write_text("\n".join(parts), encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({total_runs} runs, {failures} failures)")


if __name__ == "__main__":
    main()
