#!/usr/bin/env python3
"""
Extract the key moments from a recorded run.

The video's captions must line up with events that actually happened, so the
timings come from here rather than from a storyboard written in advance. Prints
every controller action with its recorded reason, plus the outage windows and
the link-carrying timeline.

    python scripts/analyse_run.py <run_id> [<run_id> ...]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "data" / "runs"


def load(run_id: str) -> list[dict]:
    path = RUNS / run_id / "events.jsonl"
    if not path.exists():
        raise SystemExit(f"no events for {run_id} at {path}")
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def summarise(run_id: str) -> dict:
    events = load(run_id)
    manifest = json.loads((RUNS / run_id / "manifest.json").read_text(encoding="utf-8"))
    metrics_path = RUNS / run_id / "metrics.json"
    metrics = json.loads(metrics_path.read_text(encoding="utf-8")) if metrics_path.exists() else {}

    print(f"\n{'=' * 78}")
    print(f"{run_id}  {manifest['scenario']['id']}  policy {manifest['policy_id']}  seed {manifest['seed']}")
    print(f"mode {manifest['mode']}  predictor {manifest['predictor']}  commit {manifest.get('code_commit', '')[:10]}")
    print(f"{len(events)} events, duration {events[-1]['t']:.1f}s")
    print("=" * 78)

    # --- carrying timeline ---------------------------------------------------
    print("\ncarrying link timeline:")
    carrying = None
    spans: list[tuple[float, str | None]] = []
    for event in events:
        if event["carrying"] != carrying:
            carrying = event["carrying"]
            spans.append((event["t"], carrying))
    for i, (t, link) in enumerate(spans):
        end = spans[i + 1][0] if i + 1 < len(spans) else events[-1]["t"]
        print(f"  {t:6.2f}s -> {end:6.2f}s  {link or 'NONE'}")

    # --- actions -------------------------------------------------------------
    print("\ncontroller actions (reason recorded at decision time):")
    for event in events:
        action = event.get("action") or {}
        if action.get("kind") in (None, "none"):
            continue
        predicted = ""
        if event.get("prediction") and event["prediction"].get("violation_expected"):
            predicted = "  [predicted]"
        print(
            f"  {event['t']:6.2f}s  {action['kind']:<20} {action.get('link') or '':<10}"
            f" {event['controller_state']:<18}{predicted}"
        )
        print(f"           {event['reason']}")

    # --- state changes -------------------------------------------------------
    print("\ncontroller state changes:")
    state = None
    for event in events:
        if event["controller_state"] != state:
            state = event["controller_state"]
            print(f"  {event['t']:6.2f}s  {state}")

    # --- outages -------------------------------------------------------------
    print("\noutage windows (no carrying path):")
    in_outage = False
    start = 0.0
    for event in events:
        app = event.get("app") or {}
        if app.get("in_outage") and not in_outage:
            in_outage, start = True, event["t"]
        elif not app.get("in_outage") and in_outage:
            in_outage = False
            print(f"  {start:6.2f}s -> {event['t']:6.2f}s   ({event['t'] - start:.2f}s)")
    if in_outage:
        print(f"  {start:6.2f}s -> end")

    # --- headline metrics ----------------------------------------------------
    if metrics:
        control = metrics["application"].get("control", {})
        video = metrics["application"].get("video", {})
        print("\nheadline metrics:")
        print(f"  reconnects              {metrics['continuity']['session_reconnects']}")
        print(f"  total interruption      {metrics['continuity']['total_interruption_s']} s")
        print(f"  control deadline miss   {control.get('deadline_miss_pct')} %")
        print(f"  control p99             {control.get('p99_latency_ms')} ms")
        print(f"  video frames delivered  {video.get('frame_delivery_pct')} %")
        print(f"  video stall             {video.get('stall_ms')} ms")
        print(f"  satellite bytes         {metrics['links']['satellite_bytes'] / 1e6:.2f} MB")
        print(f"  cost units              {metrics['links']['cost_units']}")
        print(f"  app health              {metrics['app_health_score']}")

    return {"run_id": run_id, "events": len(events), "spans": spans, "manifest": manifest, "metrics": metrics}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    for run_id in sys.argv[1:]:
        summarise(run_id)
