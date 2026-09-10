#!/usr/bin/env python3
"""
Bake the recorded evidence into static files the deployed site can play.

The CONTINUA engine is Python — FastAPI, numpy, scikit-learn — and cannot run on
Cloudflare Workers. A frontend deployed on its own would be honest but inert:
the scene preview, an "engine offline" strip, and an em dash in every metric.

So the public build does not talk to an engine at all. It **replays runs that
were actually recorded**, from JSON served as static assets. That is not a
compromise on honesty: replay is a first-class mode the engine already supports,
every number comes from a real recorded run, and the UI badges it `REPLAY ·
SIMULATION` exactly as it does locally.

What it cannot do, and the deployed site says so: start a new run with a
different scenario, policy or seed, or execute a fresh experiment. Those need
the engine.

    python scripts/build_demo_data.py

Output: apps/web/public/demo/
    index.json          catalogue: runs, scenarios, policies, capability
    runs/<id>.json      full event stream for one recorded run
    experiments/<id>.json  aggregate results, already small
"""

from __future__ import annotations

import json
import gzip
import shutil
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "data" / "runs"
EXPERIMENTS = ROOT / "data" / "experiments"
SCENARIOS = ROOT / "services" / "engine" / "continua_engine" / "scenarios"
OUT = ROOT / "apps" / "web" / "public" / "demo"

#: The runs the public build offers. Chosen for what they demonstrate, and named
#: here so the set is auditable rather than "whatever was on disk".
DEMO_RUNS = [
    ("run-d2819d215c", "CONTINUA holds the session through a Wi-Fi fade"),
    ("run-7d8750c2b7", "The reactive baseline, same seed and same trace"),
    ("run-3c69f9615f", "Satellite fallback on the remote sector"),
]

#: Experiment results worth shipping: the completed 20-trial test-block runs.
DEMO_EXPERIMENTS = [
    "exp-26f132d5d7",  # wifi-degradation
    "exp-64931cf540",  # cellular-congestion
    "exp-966206c65b",  # satellite-fallback
    "exp-657ef4a89a",  # total-loss
    "exp-16354dec23",  # sudden-failure
    "exp-c1ddbbb2ba",  # flapping
    "exp-e70fe761a1",  # learned predictor
]


def round_floats(node: Any, digits: int = 3) -> Any:
    """
    Shrink the payload without changing what it says.

    The simulator emits full double precision; nothing in the interface renders
    more than one or two decimals. Rounding to three keeps every displayed value
    identical and takes roughly a third off the wire.
    """
    if isinstance(node, float):
        return round(node, digits)
    if isinstance(node, dict):
        return {key: round_floats(value, digits) for key, value in node.items()}
    if isinstance(node, list):
        return [round_floats(value, digits) for value in node]
    return node


def export_run(run_id: str, blurb: str) -> dict:
    directory = RUNS / run_id
    events_path = directory / "events.jsonl"
    manifest_path = directory / "manifest.json"
    if not events_path.exists():
        raise SystemExit(
            f"missing {events_path}\n"
            "Recorded runs are git-ignored. Re-create them with the engine running:\n"
            "  python scripts/engine_cli.py ... or start them from the Mission page."
        )

    events = [round_floats(json.loads(line)) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    metrics_path = directory / "metrics.json"
    metrics = json.loads(metrics_path.read_text(encoding="utf-8")) if metrics_path.exists() else None

    payload = {
        "run_id": run_id,
        "blurb": blurb,
        "manifest": manifest,
        "metrics": round_floats(metrics) if metrics else None,
        "duration_s": events[-1]["t"] if events else 0,
        "events": events,
    }

    target = OUT / "runs" / f"{run_id}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"))
    target.write_text(text, encoding="utf-8")

    raw = len(text.encode("utf-8"))
    packed = len(gzip.compress(text.encode("utf-8"), 9))
    print(f"  {run_id}  {len(events):>5} events  {raw / 1e6:.2f} MB raw  {packed / 1e6:.2f} MB gzip")

    return {
        "run_id": run_id,
        "blurb": blurb,
        "scenario_id": manifest["scenario"]["id"],
        "scenario_title": manifest["scenario"].get("title", manifest["scenario"]["id"]),
        "policy_id": manifest["policy_id"],
        "seed": manifest["seed"],
        "predictor": manifest.get("predictor"),
        "mode": manifest.get("mode", "simulation"),
        "started_at": manifest.get("started_at"),
        "duration_s": payload["duration_s"],
        "events": len(events),
    }


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    print("runs:")
    runs = [export_run(run_id, blurb) for run_id, blurb in DEMO_RUNS]

    print("\nexperiments:")
    experiments = []
    (OUT / "experiments").mkdir(parents=True, exist_ok=True)
    for exp_id in DEMO_EXPERIMENTS:
        source = EXPERIMENTS / f"{exp_id}.json"
        if not source.exists():
            print(f"  {exp_id}  MISSING — skipped")
            continue
        data = json.loads(source.read_text(encoding="utf-8"))
        # `raw` holds every individual trial and is only used to recompute the
        # aggregate. The site renders the aggregate and the paired deltas.
        data.pop("raw", None)
        text = json.dumps(round_floats(data), separators=(",", ":"))
        (OUT / "experiments" / f"{exp_id}.json").write_text(text, encoding="utf-8")
        experiments.append(
            {
                "experiment_id": exp_id,
                "scenario_id": data["scenario_id"],
                "trials": data["trials_requested"],
                "completed": sum(data.get("trials_completed", {}).values()),
                "seed_block": data.get("seed_block"),
                "predictor": data.get("predictor"),
                "code_commit": data.get("code_commit"),
            }
        )
        print(f"  {exp_id}  {data['scenario_id']}  {len(text) / 1e3:.0f} kB")

    # --- catalogues the UI asks the engine for -----------------------------
    scenario_specs = []
    catalogue = SCENARIOS / "catalogue.json"
    if catalogue.exists():
        scenario_specs = json.loads(catalogue.read_text(encoding="utf-8")).get("scenarios", [])
    else:
        for path in sorted(SCENARIOS.glob("*.json")):
            if path.name in {"link_profiles.json"}:
                continue
            spec = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(spec, dict) and "id" in spec:
                scenario_specs.append(spec)
            elif isinstance(spec, dict) and "scenarios" in spec:
                scenario_specs.extend(spec["scenarios"])

    capability_path = ROOT / "data" / "emulation_capability.json"
    capability = json.loads(capability_path.read_text(encoding="utf-8")) if capability_path.exists() else None

    index = {
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "note": (
            "Static replay data for the public deployment. Every value here was produced by a "
            "recorded run of the CONTINUA engine; nothing is synthesised for the demo. The "
            "deployed site cannot start new runs or experiments because the engine is Python "
            "and does not run at the edge."
        ),
        "runs": runs,
        "experiments": experiments,
        "scenarios": round_floats(scenario_specs),
        "capability": capability,
    }
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")

    total = sum(p.stat().st_size for p in OUT.rglob("*.json"))
    print(f"\nwrote {OUT.relative_to(ROOT)}  {total / 1e6:.2f} MB across {len(list(OUT.rglob('*.json')))} files")
    print(f"  {len(runs)} runs, {len(experiments)} experiments, {len(scenario_specs)} scenarios")


if __name__ == "__main__":
    main()
