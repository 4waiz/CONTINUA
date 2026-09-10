# CONTINUA — progress

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Vehicle, world, route animation, scene components, design system, `/scene-lab` | **complete** |
| 2 | Working application, network engine, controller, experiments | **complete** |
| 3 | Demo video: claim ledger, deterministic capture, narration, edit | **complete** |
| 3.1 | UI/UX overhaul: fixed-viewport shell, 3D hero, redesigned pages | **complete** |

---

# Launch

```bash
npm install
npm run engine              # engine on http://127.0.0.1:8000 — leave running
npm run build && npm start  # app on http://localhost:3000
```

| URL | Section |
| --- | --- |
| <http://localhost:3000> | **Mission** — live run, scene, link cards, health, pipeline |
| <http://localhost:3000/scenario-lab> | Configure failures, congestion, movement, workload |
| <http://localhost:3000/experiments> | Paired comparison + execution capability report |
| <http://localhost:3000/decision-log> | Every action with its observations and reason |
| <http://localhost:3000/capture?run=…> | Fixed 16:9 capture frame |
| <http://localhost:3000/scene-lab> | Phase 1 scene inspector (preview source, no engine) |

---

# Phase 2 — feature matrix

## Implemented and tested

| Feature | Evidence |
| --- | --- |
| Causal network simulator: finite queues, capacity, delay, jitter, correlated burst loss, activation delay, background demand, cost accounting | 36 engine tests |
| Five traffic classes with receiver-side logs: control (acked, deduplicated), voice-like, telemetry (freshness), video (whole-frame delivery, stalls), bulk (deferrable) | `test_engine.py` |
| Metrics computed **only** from delivery, acknowledgement and timeout events | `metrics.py`, tests |
| Controller: Observe→Predict→Prepare→Steer→Explain, 8 states, hysteresis, min dwell, switch penalties | `controller.py`, browser tests |
| Six policies behind one interface (B0, B1, B2, P1, 2 ablations) | `test_policies_differ_only_by_configuration` |
| Heuristic predictor | 20-trial experiments |
| Learned tabular predictor with run-level splits, held-out families, calibration check, documented fallback | `MODEL_CARD.md`, `training_report.json` |
| Deterministic runs, byte-identical for a seed | `test_same_seed_reproduces_identical_run` |
| Policy-independent exogenous trace (paired trials) | `test_exogenous_trace_is_independent_of_policy` |
| No future-information leakage | `test_controller_never_receives_the_trace`, feature allow-list test |
| Genuine outage + safe-stop when all paths fail | `test_total_loss_is_reported_as_a_genuine_outage` |
| FastAPI REST + WebSocket, SQLite metadata, JSONL evidence | Browser tests |
| Reconnect, stale-data, duplicate and out-of-order handling | `useEngineRun.ts`, browser tests |
| Mission / Scenario Lab / Experiments / Decision Log, all controls functional | 11 Phase 2 browser tests |
| Replay of a stored run, identified by source mode/run/time | `test_replaying_a_recorded_run_reproduces_it_exactly` + browser test |
| Capture view: 16:9, ready signal, deterministic seek, no invented LIVE badge | Browser test asserts the ratio and the signal |
| Unavailable measurements render as unavailable, never zero; RSSI only for Wi-Fi | Engine + browser tests |
| 20 paired trials × 6 policies × 6 core scenarios | `data/experiments/` |
| Emulation **capability probe** | `data/emulation_capability.json` |

## Implemented but unverified on this host

| Feature | Why |
| --- | --- |
| Linux emulation topology (namespaces, veth, netem, tbf, both directions) | Scripts written and parse cleanly, **never executed**: no passwordless sudo on the dev host |
| MPTCP endpoint configuration and subflow verification | **Impossible here** — the WSL2 kernel has `CONFIG_MPTCP` unset |
| Mininet-WiFi topologies | Not installed |

## Planned / not done

Emulation execution on a suitable Linux host; calibrating the learned
predictor; a tree model; real propagation modelling; congestion control in the
simulator; multi-user API auth; run-storage retention; Phase 3 video capture.

---

# Measured results

## Experiment scale actually completed

| | |
| --- | --- |
| Core scenarios | 6 (`wifi-degradation`, `sudden-failure`, `cellular-congestion`, `satellite-fallback`, `flapping`, `total-loss`) |
| Policies per scenario | 6 |
| Paired trials per scenario | **20** (seeds 70 000–70 019, `test` block) |
| Runs completed | **720 / 720**, 0 failures |
| Plus | 10-scenario smoke pass (2 trials), and a 20-trial learned-predictor comparison |
| Wall time | ~25 min for the core matrix |

## Headline — `wifi-degradation`, 20 paired trials

| Metric | B0 | B1 | B2 | **P1** | P1-noPred | P1-noApp |
| --- | --- | --- | --- | --- | --- | --- |
| Session reconnects | 1.00 | 0.00 | 0.00 | **0.00** | 0.00 | 0.00 |
| Total interruption (s) | 7.32 | 1.02 | 0.16 | **0.16** | 0.16 | 0.16 |
| Control deadline miss (%) | 34.63 | 33.32 | 31.81 | **31.54** | 31.50 | 34.70 |
| Control p99 (ms) | 526 | 530 | 531 | **515** | 515 | 535 |
| Video stall (ms) | 24 092 | 18 201 | 18 197 | **11 449** | 11 523 | 19 191 |
| Telemetry miss (%) | 22.86 | 20.01 | 19.85 | **16.96** | 16.77 | 20.62 |
| App health | 66.4 | 69.3 | **70.3** | 68.8 | 69.0 | 68.5 |
| Satellite (MB) | 47.6 | 59.1 | 61.2 | **4.8** | 4.7 | 62.3 |
| Cost units | 3.44 | 4.77 | 4.31 | **1.25** | 1.23 | 4.78 |
| Handovers | 3.0 | 3.6 | 5.5 | 5.3 | 4.3 | 6.2 |

**CONTINUA matches always-on redundancy (B2) on continuity — 0 reconnects,
0.16 s interruption — using 4.8 MB of satellite instead of 61.2 MB (−92 %) and
1.25 cost units instead of 4.31 (−71 %), with 37 % less video stall.**

## Where CONTINUA wins hardest — `cellular-congestion`

Availability stays high, so a coverage-only policy sees nothing wrong while
queues build:

| Metric | B0 | B1 | B2 | **P1** |
| --- | --- | --- | --- | --- |
| Control deadline miss (%) | 54.40 | 52.50 | 49.16 | **31.46** |
| App health | 54.6 | 57.3 | 59.2 | **68.9** |
| Video stall (ms) | 26 905 | 21 169 | 20 800 | **11 326** |
| Satellite (MB) | 47.6 | 61.4 | 63.8 | **4.8** |
| Cost units | 3.34 | 4.98 | 4.36 | **1.15** |

## Negative and inconclusive results — reported, not buried

**1. Prediction does not pay for itself.** The `P1 − P1-noPred` ablation is a
wash at both predictor qualities tested:

| | P1 heuristic | P1 learned | P1-noPred |
| --- | --- | --- | --- |
| Prediction recall | 0.14 | **0.78** | — |
| Prediction precision | — | 0.65 | — |
| False positives / run | 7.5 | **101.4** | 0 |
| Unnecessary handovers | 0.15 | 1.25 | 0 |
| Total interruption (s) | 0.16 | 0.16 | 0.16 |
| Control miss (%) | 31.54 | 31.38 | 31.50 |
| Cost units | 1.25 | **1.08** | 1.23 |
| App health | 68.8 | 67.9 | **69.0** |

Raising recall from 0.14 to 0.78 bought a 12 % cost reduction and cost 1.1
points of app health, for ~101 false alarms per run.

**Why:** both P1 and P1-noPred **pre-warm a backup proactively**. That is what
removes the interruption, with or without a prediction. The predictor only
decides whether to switch *early*, and switching early is not free. **The value
is in preparation and application-awareness, not in prediction.**

**2. B2 scores marginally higher on the composite health score** in four of six
scenarios (e.g. 70.3 vs 68.8). CONTINUA deliberately defers bulk transfer to
protect control and video; bulk carries weight 0.05 in `app_health_v1`, so the
composite penalises the trade that the per-class numbers show is worth making.

**3. `sudden-failure` shows no prediction benefit**, as predicted in the method
document — a 200 ms drop with no preceding trend is not forecastable.

**4. `total-loss` shows no policy difference in outage duration** (10.78 s for
every multipath policy). Correct: no policy can carry a session through a total
outage, and a difference here would be a bug.

**5. Confidence intervals are wide** at 20 trials. Differences under a few
percent are inconclusive and are not claimed as wins.

## Learned predictor

Held-out tuning runs, threshold 0.45 chosen on tuning:

| | Precision | Recall | F1 |
| --- | --- | --- | --- |
| **Learned logistic** | **0.874** | **0.677** | **0.763** |
| Heuristic trend | 0.800 | 0.121 | 0.211 |

Brier 0.1896 vs base-rate 0.2485; **mean absolute calibration error 0.136**, so
`calibrated: false` and the UI labels the score uncalibrated. Details in
[`MODEL_CARD.md`](MODEL_CARD.md).

## Verification

| Suite | Result |
| --- | --- |
| `npm run lint` | clean, zero warnings |
| `npm run typecheck` | clean |
| `npm run build` | 8 routes, compiles |
| `npm run test:engine` | **36 passed** |
| `npm run test:phase2` | **11 passed** |
| `npm run test:smoke` (Phase 1 scene, 3 viewports) | **11 passed** |

## Rendering performance (unchanged from Phase 1, and kept separate from network metrics)

**233.8 / 226.3 fps** at 1920×1080, `high` quality, on ANGLE / Intel(R) Graphics
`0x00007D67` (D3D11, integrated), uncapped rAF. 131 draw calls, 2.28 MB of
runtime assets.

---

# Defects found and fixed in Phase 2

Recorded because each was found by looking at output, not by reading code:

1. **Retransmission storm.** A fixed 120 ms RTO against the satellite path's
   620 ms RTT retransmitted every control packet forever — 122 491 retransmits
   for 2 100 packets. Replaced with a Jacobson/Karels adaptive RTO, bounded
   attempts, and no retransmission past a deadline.
2. **Switch thrashing.** The controller would move to a backup on any measured
   violation, even when the backup was worse, producing 13 handovers per run. It
   now requires the candidate to actually be better, plus a 0.4 s risk debounce.
3. **Video goodput counted twice** — per packet *and* per completed frame —
   producing a nonsensical **−12.7 % overhead**.
4. **Prediction precision of 0.997 that meant nothing.** Predictions were being
   scored while the carrying path was *already* in violation. Once on satellite
   the path is permanently past the control deadline, so "predicting" it was
   free. Now scored only on transitions; heuristic recall fell to 0.14, which is
   the honest number.
5. **Throttle actions emitted every step** while a throttle stayed in force,
   burying real events under ~2 200 repeats per run.
6. **`rssiDbm` guarded on the wrong field** in `engineSource`, publishing
   `undefined` for links that have no RSSI at all — "present but unknown" rather
   than "does not exist". Caught by a browser test.
7. **React Compiler violations** in five components — setState inside effects and
   a ref read during render. Fixed by deriving values instead, not by
   suppressing the rules.
8. **Application health computed 50×/s and discarded.** Building five Pydantic
   models every 20 ms cost more than the rest of the step; now computed only
   when an event is emitted. Run time fell from 9.6 s to ~1.5 s.

---

# Known limitations

* **Emulation is unverified on this host** and MPTCP is impossible here. See
  `docs/ASSUMPTIONS.md` §8.
* **No congestion control** in the simulator. Queueing and loss are modelled;
  TCP's reaction to them is not.
* **Bulk transfer is fluid**, not packetised, so it has no latency distribution.
* **The learned predictor is uncalibrated** and trained purely on synthetic data.
* **`app_health_v1` weights are a product judgement**, not derived from anything.
* **The strongest model feature (`coverage`) is synthetic** with no real-world
  counterpart as implemented.
* **20 trials** gives wide intervals; treat small gaps as inconclusive.
* **The API is unauthenticated** (loopback-bound) and run storage is unbounded.
* **Live-run seeking rebuilds and fast-forwards**, taking ~1–2 s on a long run.
* **Cellular and satellite are shaped access profiles**, not radio, core-network
  or constellation simulations.

---

# Phase 1 summary (unchanged)

Vehicle: `CONTINUA Rover Mk1`, 38 120 triangles, generated by
`scripts/blender/build_vehicle.py`; hero `.glb` 1.39 MB, LOD 549 KB. World: a
917 m route through four zones with terrain whose `height(x, z)` is the single
elevation authority. Deterministic scene clock, four cameras, all pure functions
of time. Full detail in [`PHASE_1_HANDOFF.md`](PHASE_1_HANDOFF.md).

---

# Phase 3.1 — UI/UX overhaul

The application worked and looked like an internal admin panel: a narrow centre
column, a blank rectangle where the 3D world should be, 10px type, and browser
default form controls. This pass rebuilt the presentation without touching the
engine, the contracts or a single measurement.

## What changed

**A fixed-viewport shell.** `.app-shell` is exactly one screen tall and never
scrolls; only unbounded regions (the decision list, the results column) scroll
inside their own panel. A dashboard the operator has to scroll is one that hides
the thing that just changed. `scripts/ui-screenshots.mjs` asserts this at
1920x1080, 1440x900 and 1366x768 — and separately asserts that **no content is
unreachable**, which is the failure mode a fixed viewport actually risks.

**The 3D world became the hero.** Mission and Scenario Lab both mount the scene
as the centre column at full height. With no run it renders from the Phase 1
`previewSource` and is badged `SCENE PREVIEW`, so the first thing a visitor sees
is the vehicle and the route rather than an empty panel.

**New components.** `MetricCard` (big number, sparkline, and an em dash rather
than a zero when there is no measurement), `NetworkRail` (four candidate paths
to one gateway, never a chain), `PipelineRail` (the five stages, driven by the
engine's reported stage and the reason it wrote at decision time), `HealthPanel`
(per-class bars instead of a paragraph and a table), `LiveTelemetry` (one chart,
four series, an explicit toggle), `EngineStatus`, `ComparisonChart`,
`ScenePerformance`, and the Scenario Lab controls.

**Scenario Lab** became a laboratory: scenario tiles, a policy selector naming
what each baseline actually does, workload chips carrying priority colour, an
amber fault-injection section, a live preview, and a summary that restates the
configuration without predicting an outcome.

**Experiments** landed on results instead of an empty page, and gained summary
counts and six comparison charts with 95 % CI whiskers above the full table.

**Scene Lab** joined the app shell instead of carrying its own header, and gained
a measured renderer readout (FPS, draw calls, triangles, geometries).

## Honesty fixes found along the way

* The cellular link was labelled **5G** across contracts, scene, `world.json` and
  the link profiles — a leftover from the Phase 1 design reference. The profile
  is a shaped software link; it now reads `Cellular`. `CLAUDE.md` §1 forbids the
  old label.
* Scene Lab printed **"Model confidence 99% · illustrative"**. There is no model
  in the Phase 1 preview and nothing produced a 99: it was decoration wearing the
  clothes of a measurement. Replaced with what the panel can honestly say — the
  handoff plan comes from route geometry and coverage radii.
* The connection badge was briefly renamed `LIVE STREAM`. Reverted: this project
  is deliberate about the word *live*, and the badge describes a socket to a
  simulator, not a live network.

## What did not change

No engine code, no contracts, no metric definitions, no experiment results. The
redesign moved numbers around the screen; it did not produce any.
