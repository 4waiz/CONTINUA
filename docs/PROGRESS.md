# CONTINUA - progress

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Vehicle, world, route animation, scene components, design system, `/scene-lab` | **complete** |
| 2 | Working application, network engine, controller, experiments | **complete** |
| 3 | Demo video: claim ledger, deterministic capture, narration, edit | **complete** |
| 3.1 | UI/UX overhaul: fixed-viewport shell, 3D hero, redesigned pages | **complete** |
| 4 | Per-class steering, control mode handover, B2-defer, honesty fixes, `test2` comparison | **complete** |
| 7 | Visual overhaul: Mk2 rover, 48-prop world kit, procedural ground and daylight, immersive interface | **complete** |

---

# Launch

```bash
npm install
npm run engine              # engine on http://127.0.0.1:8000 - leave running
npm run build && npm start  # app on http://localhost:3000
```

| URL | Section |
| --- | --- |
| <http://localhost:3000> | **Mission** - live run, scene, link cards, health, pipeline |
| <http://localhost:3000/scenario-lab> | Configure failures, congestion, movement, workload |
| <http://localhost:3000/experiments> | Paired comparison + execution capability report |
| <http://localhost:3000/decision-log> | Every action with its observations and reason |
| <http://localhost:3000/capture?run=…> | Fixed 16:9 capture frame |
| <http://localhost:3000/scene-lab> | Phase 1 scene inspector (preview source, no engine) |

---

# Phase 2 - feature matrix

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
| Emulation **capability probe** | `data/emulation_capability.json` (current) and `data/emulation_capability_2026-09-08.json` |

## Implemented but unverified on this host

| Feature | Why |
| --- | --- |
| Linux emulation topology (namespaces, veth, netem, tbf, both directions) | Scripts written and parse cleanly, **never executed**: no passwordless sudo on the dev host |
| MPTCP endpoint configuration and subflow verification | **Impossible here** - the WSL2 kernel has `CONFIG_MPTCP` unset |
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

## Headline - `wifi-degradation`, 20 paired trials

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

**CONTINUA matches always-on redundancy (B2) on continuity - 0 reconnects,
0.16 s interruption - using 4.8 MB of satellite instead of 61.2 MB (−92 %) and
1.25 cost units instead of 4.31 (−71 %), with 37 % less video stall.**

## Where CONTINUA wins hardest - `cellular-congestion`

Availability stays high, so a coverage-only policy sees nothing wrong while
queues build:

| Metric | B0 | B1 | B2 | **P1** |
| --- | --- | --- | --- | --- |
| Control deadline miss (%) | 54.40 | 52.50 | 49.16 | **31.46** |
| App health | 54.6 | 57.3 | 59.2 | **68.9** |
| Video stall (ms) | 26 905 | 21 169 | 20 800 | **11 326** |
| Satellite (MB) | 47.6 | 61.4 | 63.8 | **4.8** |
| Cost units | 3.34 | 4.98 | 4.36 | **1.15** |

## Negative and inconclusive results - reported, not buried

**1. Prediction does not pay for itself.** The `P1 − P1-noPred` ablation is a
wash at both predictor qualities tested:

| | P1 heuristic | P1 learned | P1-noPred |
| --- | --- | --- | --- |
| Prediction recall | 0.14 | **0.78** | - |
| Prediction precision | - | 0.65 | - |
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
document - a 200 ms drop with no preceding trend is not forecastable.

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
   620 ms RTT retransmitted every control packet forever - 122 491 retransmits
   for 2 100 packets. Replaced with a Jacobson/Karels adaptive RTO, bounded
   attempts, and no retransmission past a deadline.
2. **Switch thrashing.** The controller would move to a backup on any measured
   violation, even when the backup was worse, producing 13 handovers per run. It
   now requires the candidate to actually be better, plus a 0.4 s risk debounce.
3. **Video goodput counted twice** - per packet *and* per completed frame -
   producing a nonsensical **−12.7 % overhead**.
4. **Prediction precision of 0.997 that meant nothing.** Predictions were being
   scored while the carrying path was *already* in violation. Once on satellite
   the path is permanently past the control deadline, so "predicting" it was
   free. Now scored only on transitions; heuristic recall fell to 0.14, which is
   the honest number.
5. **Throttle actions emitted every step** while a throttle stayed in force,
   burying real events under ~2 200 repeats per run.
6. **`rssiDbm` guarded on the wrong field** in `engineSource`, publishing
   `undefined` for links that have no RSSI at all - "present but unknown" rather
   than "does not exist". Caught by a browser test.
7. **React Compiler violations** in five components - setState inside effects and
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

# Phase 3.1 - UI/UX overhaul

The application worked and looked like an internal admin panel: a narrow centre
column, a blank rectangle where the 3D world should be, 10px type, and browser
default form controls. This pass rebuilt the presentation without touching the
engine, the contracts or a single measurement.

## What changed

**A fixed-viewport shell.** `.app-shell` is exactly one screen tall and never
scrolls; only unbounded regions (the decision list, the results column) scroll
inside their own panel. A dashboard the operator has to scroll is one that hides
the thing that just changed. `scripts/ui-screenshots.mjs` asserts this at
1920x1080, 1440x900 and 1366x768 - and separately asserts that **no content is
unreachable**, which is the failure mode a fixed viewport actually risks.

**The 3D world became the hero.** Mission and Scenario Lab both mount the scene
as the centre column at full height. With no run it renders from the Phase 1
`previewSource` and is badged `SCENE PREVIEW`, so the first thing a visitor sees
is the vehicle and the route rather than an empty panel.

**New components.** `MetricCard` (big number, sparkline, and a placeholder rather
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
  the link profiles - a leftover from the Phase 1 design reference. The profile
  is a shaped software link; it now reads `Cellular`. `CLAUDE.md` §1 forbids the
  old label.
* Scene Lab printed **"Model confidence 99% · illustrative"**. There is no model
  in the Phase 1 preview and nothing produced a 99: it was decoration wearing the
  clothes of a measurement. Replaced with what the panel can honestly say - the
  handoff plan comes from route geometry and coverage radii.
* The connection badge was briefly renamed `LIVE STREAM`. Reverted: this project
  is deliberate about the word *live*, and the badge describes a socket to a
  simulator, not a live network.

## What did not change

No engine code, no contracts, no metric definitions, no experiment results. The
redesign moved numbers around the screen; it did not produce any.

---

## Public deployment

<https://continua.kanbanstudios.ae>, Cloudflare Workers static assets from
`apps/web/out`. No backend: the Python engine cannot run at the edge.

**How it works.** `scripts/build_demo_data.py` runs all 10 scenarios against
B0, B1, B2 and P1 at seed 70009 - one seed for all of them, so any two policies
a visitor compares faced a byte-identical exogenous trace, the same pairing
discipline the experiments use - and exports 40 recorded runs. The site's
`StaticRunPlayer` emits the same message shapes the engine's WebSocket does, so
`useEngineRun` consumes both through one `applyMessage` and no component knows
which transport it is on. The run bar reads `REPLAY - SIMULATION` with the run
id, seed and recording date.

**Size.** Per-event JSON came to 4.2 MB a run, because roughly three quarters of
it was field names repeated a thousand times. Transposed to one array per field
path it is 0.9-1.7 MB a run, 43 MB for the matrix, and about 0.1 MB gzipped for
the one run a visitor actually loads. No value is altered or dropped;
`decodeRun` reverses the transpose exactly, including the presence markers that
keep `prediction: null` distinct from `prediction: {}`.

**What it cannot do**, and says so on the page: compose a run that was never
recorded. The Scenario Lab's override controls (fault injection, congestion,
workload, seed, speed, duration) derive a scenario spec with no recording behind
it, so they are hidden rather than shown broken. The ten catalogue scenarios
already cover those cases, from a sudden Wi-Fi drop to the loss of every path.

**Two fixes this surfaced.** `useEngineRun` built a new `EngineSceneStateSource`
per run, which changed the identity `SceneRuntimeProvider` memoises on and
reloaded the 3D scene on every run change - now one source for the life of the
hook, emptied by `reset`. And `MissionScene` returned a different element tree
for preview, putting `SceneStage` at a different child index, so arriving at a
run unmounted and rebuilt the canvas; it now renders one tree and swaps only the
`source` prop.

---

# Phase 4 - steering, mode handover, and a fairer comparison

Phase 2's own results showed three weaknesses: control missed its 150 ms
deadline about 31 % of the time under every policy, because one link carried
every class and the satellite profile cannot meet 150 ms; most of the satellite
saving came from pausing bulk, with no baseline isolating that; and the
satellite profile was labelled LEO-like at 620 ms, which is a GEO figure.
Phase 4 added two mechanisms behind flags, a fairer baseline, and ran the
comparison once on a fresh seed block. Full tables: `docs/PHASE_4_RESULTS.md`.

## What was built

| Feature | Evidence |
| --- | --- |
| Regression guard: the six Phase 2 policies produce byte-identical metrics and decision streams with the Phase 4 code in place, against a snapshot taken before any of it existed | `tests/engine/test_regression_guard.py`, 25 cases |
| Per-class steering (`per_class_steering`): `ControllerDecision.class_paths`, the simulator routes, retransmits and duplicates by it; rule, dwell and debounces in `controller.py`; "no carrying path" unchanged | `test_simulator_routes_each_class_on_its_named_path`, `test_class_paths_never_keep_the_session_alive` |
| Control operating mode (`mode_handover`): teleop / waypoint / safe_hold from receiver-side RTT and loss, debounced downshift, 1.0 s upshift hold, MODE_CHANGE emitted before the SWITCH it accompanies, reason recorded at decision time | `test_mode_machine_downshifts_on_measurements_and_upshifts_after_the_hold`, `test_mode_change_precedes_the_switch_it_accompanies` |
| One mode-support definition shared by controller and metrics, with a retransmit-aware loss limit | `controller/modes.py`, `test_mode_support_definition_is_shared_and_honest_about_unknowns` |
| Mode never touches motion or the trace | `test_mode_handover_never_changes_motion_or_the_exogenous_trace` |
| New metrics, all from receiver facts: mode time, mode changes, anticipated vs late, unsupported, unknown, conservative, teleop availability, per-mode control counts | `docs/METRICS.md` section 10, accounting identities tested |
| Baseline B2-defer; `satellite_bytes_excl_bulk` and per-link bulk bytes | `test_b2_defer_adds_bulk_deferral_and_nothing_else` |
| Policies P2, P2-noSteer, P2-noMode, P2-reactiveMode, flags only, same class | `test_new_policies_differ_from_p1_only_by_their_flags` |
| Seed blocks `test2` and `test3`, disjoint from the others | `test_seed_blocks_include_test2_and_stay_disjoint` |
| Satellite profile relabelled GEO-like in profiles, contracts, UI and docs | `link_profiles.json`, `docs/ASSUMPTIONS.md` |
| TypeScript contracts with boundary validation of the new fields; Mission shows the command mode and per-class paths; Decision Log shows every action in order with its own reason; Experiments shows the new policies and P2 pairing | `packages/contracts/src/engine.ts`, browser suites |
| Tuning on the tune block with a selection rule declared before the grid ran | `scripts/phase4_tune.py`, `data/experiments/phase4_tune.json` |
| The comparison, 11 policies x 8 scenarios x 20 paired trials on `test2`, run once | `scripts/phase4_experiment.py`, `data/experiments/phase4-test2-*.json` |

## Measured, `test2`, 20 paired trials, 1 760 runs, 0 failures

The strict figure is teleop availability: the share of the run during which
20 Hz commands against the 150 ms deadline were both offered and supported.
A relaxed deadline cannot raise it.

| Question | Answer, as paired per-trial deltas with 95 % intervals |
| --- | --- |
| Does mode handover keep control out of a mode the path cannot support? | Yes: unsupported time falls from 35–60 s to 2–8 s per run (`P2 − P2-noMode` −35 to −54 s). |
| What does it cost? | Teleop availability −6.5 to −15.3 points against P2-noMode and −4.2 to −14.3 against P1, in every scenario; 8–18 s per run held below a supported mode; 6–12 mode changes; 300–700 ms more video stall than P1 in four scenarios. |
| Is the control miss rate of about 1 % a win? | No. It is the relaxed deadline and the commands not sent in safe hold. `app_health_v1` is inflated the same way and is not comparable across mode policies. |
| Does per-class steering help? | Modestly and consistently. Alone (`P2-noMode − P1`): +0.9 to +3.1 points of teleop availability and 1–3 s less unsupported time in all eight scenarios, at unchanged cost, bytes and misses, with 3–7 steers per run. With mode handover on: +2.0 to +6.8 points. |
| Does anticipating a mode change help? | **No.** `P2 − P2-reactiveMode` is −2.5 to −6.8 points of teleop availability in every scenario on `test2`, and −1.8 to −5.5 points with the corrected ablation on `test3`, for 0.7–2.8 s less unsupported time; the same conclusion Phase 2 reached about prediction. |
| How much of P1's satellite saving was bulk deferral? | Nearly all: `B2-defer − B2` removes 43–69 MB of which at most 0.42 MB is non-bulk. P1's remaining application-aware saving over B2-defer is 3.0–5.0 MB of non-bulk satellite traffic and 1.6–2.2 s less video stall, and P1 costs 0.07–0.82 units **more** than B2-defer. |

Headline, `wifi-degradation`, means over 20 trials:

| Metric | B2 | B2-defer | P1 | P2-noMode | P2 | P2-reactiveMode |
| --- | --- | --- | --- | --- | --- | --- |
| Teleop availability (%) | 51.8 | 52.3 | 50.3 | **53.4** | 42.2 | 46.2 |
| Unsupported-mode time (s) | 50.6 | 50.1 | 52.2 | 48.9 | **3.9** | 5.8 |
| Held below a supported mode (s) | 0 | 0 | 0 | 0 | 13.9 | 8.8 |
| Mode changes | 0 | 0 | 0 | 0 | 11.2 | 6.9 |
| Satellite (MB) | 61.4 | 8.4 | 4.8 | 4.7 | **4.6** | 4.6 |
| Satellite excl. bulk (MB) | 8.4 | 8.4 | 4.8 | 4.7 | **4.6** | 4.6 |
| Cost units | 4.32 | **1.05** | 1.19 | 1.19 | 1.18 | 1.18 |
| Video stall (ms) | 18 820 | 14 016 | 12 152 | **12 161** | 12 520 | 12 273 |

## Defects found and fixed in Phase 4

1. **B2 was not reproducible across processes.** Its duplication target and
   backup-activation order came from iterating a `set[LinkId]`, whose order
   Python randomises per process. Three launches gave three different
   satellite byte counts for the same seed. Found by the regression guard on
   its first run; iteration is now in link-preference order, and a test runs
   B2 and P2 under two hash seeds in subprocesses and compares. The guard's
   B2 entries were re-snapshotted after the fix, which is recorded in the
   fixture itself.
2. **Steering flapped on links that had only just become ready.** A link
   flickering at the usability floor is activated, validated and released
   within a few hundred milliseconds; a class steered onto it bounced back
   60 ms later. A readiness debounce and a leave debounce fixed it.
3. **Satellite could never be a steering target** because "at risk" was the
   predictor's teleop-centric rule (RTT projected past 150 ms), which satellite
   always satisfies. Risk is now judged against the deadline of the level
   being considered: 620 ms is not at risk for 1500 ms.
4. **A downshift was followed by an upshift 20 ms later** because the hold
   clock did not restart. Hold clocks are now per path, from each path's own
   probes, and no change may follow another within one hold.
5. **The windowed loss estimate over-reads after a traffic surge onto a
   long-delay path** - for about 0.4 s after a switch to satellite every new
   send is still in flight and counts as lost, reading 80–90 %. The mode
   machine was dropping to safe hold on it. The measurement debounce was
   added to the tuning grid for this reason; the estimator itself is a Phase 2
   definition and was left alone.
6. **A forecast could remove the command channel.** Anticipated downshifts
   went all the way to safe hold on a projected loss burst that was already
   over. Anticipation now stops at waypoint; safe hold is entered on measured
   facts alone.
7. **The reactive ablation ignored a total outage.** Its "judge a new path
   next step" guard also fired with no path at all, so P2-reactiveMode sat in
   waypoint through `total-loss`. Found in the `test2` data after the block
   had been used; fixed, tested, and the corrected ablation compared on the
   fresh `test3` block rather than by re-using `test2`. The `test2` tables are
   left as run and say so.

## Phase 6: emulation, not executed

The plan was to run `scripts/emulation/{setup,verify,cleanup}.sh` through
`wsl -u root`, which removes the sudo blocker the September probe recorded.
On 2026-10-03 WSL 2 was installed on the development host but **no Linux
distribution was** (the September probe had seen a 6.18 WSL2 kernel; it is
gone). No script was executed and no emulated measurement exists. What was
done instead:

* The capability probe was re-run and `data/emulation_capability.json`
  rewritten; the September report is kept as
  `data/emulation_capability_2026-09-08.json`.
* The probe had a defect: with no distribution, `uname -r` returns WSL's error
  text on stdout, which the probe read as a kernel release and then reported
  `iproute2`, `tc`, `sch_netem` and `python3` as missing. It now validates the
  kernel string, names the single true blocker and states that nothing ran.
* The adapter and probe gained a `wsl -u root` route to root, satisfying the
  namespace requirement without passwordless sudo on a host that has a
  distribution. Three tests exercise the probe and adapter against a stubbed
  shell; the route has not been exercised on a real distribution.

Anything measured on that topology in future is netem emulation of shaped
links without MPTCP, and the adapter's status output says so.

## Known limitations added in Phase 4

* **Safe hold does not stop the modelled vehicle.** Motion is exogenous so
  that trials stay paired; the mode describes the command channel. A real
  vehicle would stop.
* **"Supported" is a windowed RTT-and-loss rule**, not observed deadline
  outcomes. On a bursty link it is conservative, which is part of why mode
  handover gives up teleop time.
* **Waypoint and safe-hold parameters are assumptions.**
* **The public demo recordings were not regenerated**; the deployed site
  still plays B0, B1, B2 and P1 only.
* **20 trials** gives wide intervals on the smaller effects; the ablation
  tables show which intervals exclude zero.

## Verification

| Suite | Result |
| --- | --- |
| `npm run lint` | clean, zero warnings |
| `npm run typecheck` | clean |
| `npm run build` | compiles, every route |
| `npm run test:engine` | **142 passed** on the final code (36 Phase 2, 25 regression guard, 81 Phase 4), 6.6 min |
| `npm run test:phase2` | **11 passed**, against the production build and a live engine |
| `npm run test:smoke` | **11 passed**, 10 skipped by project design (capture and rig tests run on the 1920 project only). Two runs made while the 1 760-run comparison occupied eight cores failed on frame count and a canvas screenshot timeout; both passed with the CPU free, and neither is a Phase 4 change |

---

# Phase 7 - visual overhaul

The application was honest and complete, and it looked like it: a dashboard of
bordered cards around a small 3D window, a rover that read as a kit model, and a
world of thirteen primitives on a flat survey grid. This pass rebuilt the 3D
assets in Blender and the interface around them. **No engine code, contract,
metric definition or experiment result changed** - the overhaul moved numbers
around the screen; it did not produce any.

## 3D

* **Rover Mk2** (`build_vehicle.py`, rewritten). The body is one lofted shell
  from a ten-key filleted section, with paint, crease, accent stripe, cladding,
  sill, glazing and roof assigned as face bands; swept arch flares; lofted
  bumpers with skid plates and recovery hooks; a one-piece dark front face with
  round LED lamps and DRL rings; vertical rear lamps, spare wheel and ladder;
  helical coil springs; a sensor crown with LiDAR, mast camera, flat satcom
  panel, MIMO domes and a segmented light bar; tapered-spoke beadlock wheels.
  rear mud flaps and plate registration. 71,998 triangles (budget 30k-80k),
  LOD1 23,266. A tread-lug rotation sign
  error inherited from Mk1 was found and fixed on the way.
* **World kit**, 48 props in three scripts on a shared architectural kit
  (`continua_arch.py`): an operations campus, an industrial corridor and a
  remote sector with a 7.2 m ground station, a pipeline and valve station, wind
  turbines, palms, ghafs and scrub. 97,588 triangles in total.
* **Baked AO** on every mesh (Cycles, into a vertex-colour attribute), so
  contact shading costs nothing at runtime.
* **Draco**: the three GLBs total 2.07 MB with the decoder served locally.
  Model URLs carry content hashes, because `/models` is cached as immutable.
* **Layout** (`world/layout.ts`): every building sits on a graded pad with a
  service road; perimeter fence, palm avenue, light poles along the route,
  pylons with catenary conductors, a pipe rack and a distant skyline.
  `world.json` and every network site position are untouched.
* **Ground and light.** Procedural terrain, asphalt and concrete shaders replace
  the survey wireframe; a sky shader doubles as the environment map; the sun
  shadow is texel-snapped so it does not crawl; Neutral tone mapping.
* **Links.** The carrying beam fades from the rover to the site, with a soft
  halo so a link to a tower 300 m away still reads, and carries small packets;
  the wired tether hangs from the dock gantry.
* **Handoffs you can see.** Each source now reports the latest change of
  carrying link (`SceneState.handoff`). The new link reaches out from its site
  to the rover over 0.7 s behind a bright head, the link it replaced lingers as
  a fading ghost, the site and the rover's antenna ping, and the serving site
  pings gently while it carries. All of it is a pure function of the clock, so
  a scrubbed or captured frame is exact.
* **Grounded props.** One instanced draw lays a soft occlusion footprint under
  every solid prop, sized from its bounding box, so buildings and tanks sit in
  the sand rather than on it. A lower, warmer sun (41° rather than 53°), a
  deeper sky, gravel plains and wind ripples give the ground form.
* **A cinematic camera.** A deterministic director - follow, side tracking,
  high orbit, low lead, crane - with eased blends; the preview opens on it.
* **Life in the world**: two vans and a car shuttle on service roads, clear
  of the carriageway, as a pure function of the clock.

## Interface

* **Immersive run pages.** Mission, Scenario Lab and Scene Lab put the scene
  edge to edge under a slim top bar, with legible glass panels floating over it
  and a bottom dock. Mission's dock holds the run controls and a timeline
  painted with the link that carried the session, with a tick per decision.
* **Mission**: one links panel (all four links, the selected link's
  measurements, telemetry and session), one application-health panel and a
  collapsible camera tile, instead of a grid of cards. A toast names each
  handoff as it happens.
* **Experiments**: one header strip (what the page is, what is on disk, the
  one action it offers) replaces a toolbar and four stat cards.
* **Decision Log**: a timeline. Handoffs are listed by default with nodes in
  the colour of the link they moved to; a ribbon above shows which link carried
  the session over the whole run and jumps to the nearest decision; ↑ ↓ step
  through decisions; a run-outcome panel shows the recorded metrics with the
  raw file one click away.
* **A route map** on Mission and Scenario Lab: the whole route, its zones,
  every network site and the session gateway, the rover at the engine's
  reported distance, and one line in the carrying link's colour to the site it
  reaches. The road already driven is painted with the link that carried the
  session along each stretch, with a dot at every handoff - where on the
  ground the network changed - from recorded events. It draws no coverage:
  the scene's coverage model does not know a scenario's injected faults and
  would contradict the run beside it.
* **A camera switch** on Mission (follow, overview, close-up). A camera
  changes the picture, never the data.
* **Replay from a decision.** Each decision in the log links to Mission, which
  replays that recorded run from four seconds before it, so the handoff is
  seen to happen. Local engine only; the public build has no engine to start a
  replay.
* **A first-visit card** on Mission saying what the scene is and offering the
  one action that matters, only while no run exists.
* **The end of a run, stated.** When a run completes, a card shows what the
  session went through - reconnects, interruption, application health,
  handovers (and how many were unnecessary), satellite bytes, overhead -
  from the metrics file the engine wrote, with the decision log and a replay
  one click away.
* **The promise in the HUD**: `SESSION CONTINUOUS · 0 reconnects`, from the
  receiver's application health, beside the carrying link and command mode.
* **A loader worth looking at** for the first seconds: the wordmark, the
  tagline, and the four links lighting up side by side as the world arrives.
* Six components the redesign replaced were deleted rather than left behind.

## Smoothness, measured

On this machine (RTX 4070 Laptop GPU, Chromium on ANGLE / D3D11), Mission
with a run in progress, 1920×1080, 8 s, uncapped frame rate
(`node scripts/perf-probe.mjs`):

| | before | after |
| --- | --- | --- |
| Frames per second | 277 | 323 |
| Renders per displayed frame | 3.2 | 1.0 |
| Frame time p99 / worst | 8.9 / 18.6 ms | 8.0 / 12.7 ms |
| Rover frames with no movement (3 s, 60 fps) | 34 of 181 | 0 |
| Largest per-frame jump in rover speed | 202 m/s (true ~12) | 20 m/s |
| First load to a drawn scene | 7.2 s | 3.5 s |
| Page switch to first scene frames | ~1.5 s | 0.4-0.7 s |
| Long main-thread tasks | 0 | 0 |

What it took:

1. **The environment map was rebuilt about twenty times a second.** Every
   engine update re-rendered the scene tree; the sky environment's children
   changed identity, and drei re-captured the cube and re-ran the PMREM
   filter - some 700 extra render passes a second. The scene stage is now
   memoised and the environment's children are stable.
2. **The rover stuttered.** Past the newest engine sample the scene holds
   position, and the clock was snapped back whenever it drifted 0.35 s, so the
   rover froze and lurched. The scene now plays a quarter of a simulated second
   behind the newest sample and steers the clock's rate (within 30 %) instead
   of snapping it. The run's playback speed, which never reached the clock,
   now does.
3. **Shaders compiled synchronously, then the scene rendered six more times.**
   drei's `<Preload all />` compiled ~100 programs on the main thread and
   warmed textures with a cube-camera render; the scene has no textures. A
   `compileAsync` precompile with the render loop held replaces it.
4. **A WebGL context leaked on every page switch** (the capability probe never
   released its context; browsers drop the oldest context past about sixteen).
5. **Settings reset when a run started**, because a new runtime brought a new
   settings store: the chosen camera snapped back and a software-rendered
   machine went back to the high tier. One store now lives for the page.

## Known limitations of Phase 7

* **Each scene page builds its own WebGL context.** Switching between Mission,
  Scenario Lab and Scene Lab shows the loader for about half a second to a
  second while the context, the models' GPU buffers and the sky environment
  are rebuilt; one canvas shared across pages would remove that.
* **Ambient occlusion costs about half the frame rate** on the development GPU
  (still 146-175 fps there). A slower GPU steps itself down to the balanced
  tier, which has none.
* **The cinematic camera does not test for occlusion**: for a moment a palm or
  a building can pass between it and the rover.
* **The service-road traffic is decoration.** It is not part of the
  simulation and nothing measures it.

## Defects found and fixed in Phase 7

1. **The follow camera drove through the dock gantry.** The camera rides
   5.2 m above the road and the gantry beam sat at 4.6 m, so for the first
   seconds of every run, as the rover pulled away, the beam filled the frame.
   The portal is now 6.4 m clear and the camera passes under it; the gatehouse
   canopy, at 5.6 m, got the same headroom, and its raised booms were
   shortened because they speared through its roof.
2. **Capture readiness ignored the scene.** `data-capture-ready` meant "run
   data has arrived", so a capture could start while the loading overlay still
   covered the frame - the Phase 2 evidence shot showed exactly that. It now
   also requires the scene's own first-frame signal (models decoded, three
   frames drawn).
3. **Software rendering at a few frames a second.** Under SwiftShader - also
   what a VM or a remote desktop without GPU acceleration gets - a screenshot
   of Scene Lab took 15 s and two smoke tests timed out. Hiding parts of the
   scene one at a time showed a fixed cost dominating: with nothing visible it
   still drew at 3.5 fps, because the canvas was created with 4x MSAA at full
   resolution, and multisampling can only be chosen when a context is created.
   A throwaway context now identifies a software rasteriser (SwiftShader,
   llvmpipe, softpipe, the Microsoft Basic Render Driver) *before* the canvas
   exists; it is then created without MSAA at a 0.6 pixel ratio and starts on
   the low tier. Same machine, same page: a screenshot 15.3 s → 4.4 s, an empty
   frame 3.5 → 15.5 fps. The quality control still offers every tier.
4. **A test that raced the dock dwell.** "The vehicle must actually travel"
   sampled distance over a fixed 3.5 s window right after the first link was
   assigned, which on a fast page landed inside the rover's 5 s dock dwell. It
   now waits, bounded at 20 s, for the distance to grow.
5. **A test that had stopped testing.** The offline check counted numbers in
   `article.card` metric cards, which the redesign removed, so it passed by
   counting nothing. It now targets the two measurement panels and asserts
   they are present first.
6. **Packet markers grew near the camera.** The markers on the carrying beam
   were world-sized spheres, so one passing close to the camera became a large
   disc in the frame. They are now a constant few pixels at any distance.
7. **Duplicate "unavailable".** An unavailable link said so twice, and an
   available link with no samples read "Available … unavailable". The row now
   shows the phase alone, or names the missing measurement ("RTT
   unavailable").
8. **The final frame showed the rover back at the dock.** The scene clock
   looped for every source, so a finished run's last timestamp wrapped to zero
   while every panel said the rover had arrived. Only the preview loops now.
9. **An invisible halo.** drei's `<Line>` spreads extra props onto its material
   as well as the object, so a `visible={false}` prop hid the *material* for
   good. Visibility is now set on the object, in the frame loop.

## Verification

| Suite | Result |
| --- | --- |
| `npm run lint` | clean, zero warnings |
| `npm run typecheck` | clean |
| `npm run build` | compiles, every route |
| `npm run test:engine` | **145 passed** (no engine code changed in this phase) |
| `npm run test:phase2` | **11 passed**, against the production build and a live engine |
| `npm run test:smoke` | **11 passed**, 10 skipped by project design, at 1920, 1440 and 1280 |

Looked at in a browser at 1920×1080, 1440×900, 1366×768 and 1280×720
(`node scripts/ui-screenshots.mjs`): no page scrolls, nothing is unreachable,
no text is smaller than 11 px.

# Phase 8 - a coastal island, one canvas, a rover camera

The owner's verdict on Phase 7 was that it was better but not yet a leap, that
the beige desert everywhere was the wrong world, and that the app still felt
laggy in places. This pass changes the world's character and removes the last
rebuild from navigation. **No engine code, contract, metric definition or
experiment result changed.** Nothing in the network model knows about the sea,
the mountains or the planting: coverage is still the geometric model in
`world.json`, and the landscape cannot move a measured number.

## The world

* **An island instead of a desert.** The terrain is a broad island: sea along
  the south shore, a headland past the ground station, a strait to the north,
  the town on the west coast. Every shore is at least a hundred metres from the
  route, so the road's elevation profile and everything the engine shares are
  unchanged by it. A 6 % beach runs down through the waterline to a shelf.
* **The sea** is one plane whose colour comes from the depth of water under
  each point - the island's own heights, sampled once into a small texture -
  turquoise over the shelf to sapphire offshore, with surf that breathes at the
  waterline and waves that are a function of the scene clock.
* **Meadows and lawns.** The ground shader is a field-scale patchwork of
  greens with wildflowers that resolve into single blooms close up; the campus
  is a mown, striped lawn; steep ground turns to rock; the beach is pale above
  the waterline and wet at it. Grass tufts, flowering tufts in four colours and
  gravel fringe the open road and sway with the scene clock.
* **Mountains across the water.** The flat-shaded ridge curtain, which read as
  grey boxes on the horizon, is replaced by two solid ranges with spurs and
  gullies shaped in world space, so the sun models them: woods and rock near,
  haze-blue far. The south is open sea to the horizon.
* **A sky with weather.** A deep blue zenith, a bright coastal haze at the
  horizon and fair-weather cumulus, white where the sun reaches them and
  blue-grey underneath. The environment map is captured from the same sky, so
  the rover's paint and the sea reflect the clouds.
* **Colour from planting, not from neon.** New Blender props: scarlet flame
  trees, violet jacarandas, bougainvillea in four colours and kerbed flower
  beds along the campus road; the broadleaf trees and palms are lusher; the
  boulders are granite. 55 props, 113,222 triangles, 1.19 MB with Draco.

## Smoothness

* **One canvas for the whole app.** Mission, Scenario Lab and Scene Lab each
  built their own canvas, so every switch between them created a WebGL context,
  re-uploaded every model, re-captured the sky and showed the loader for half a
  second to a second. The canvas now lives in the root layout and is moved into
  the page's own box (`SceneHost`); a switch swaps the runtime it draws.
  Measured with an instrumented `getContext` (Scene Lab, Experiments,
  Mission, Decision Log, Scenario Lab, Mission): after the first load, the
  tour creates **no new WebGL context**, the same canvas element is on screen
  on every scene page, and the worst frame in the 1.2 s after any switch is
  17 ms - one frame at 60 Hz.
* **The render loop is a prop.** The precompile hold was set from inside the
  canvas, and the canvas re-applies its props on every render, so any unrelated
  re-render could release it early. `frameloop` is now passed in.

## The rover camera

The Mission camera tile showed a drawn test pattern. It is now the simulated
world rendered from the camera windows on the rover's sensor crown - tone-
mapped exactly as the main view, 480×270, at most 15 pictures a second (3 on
the low tier), reusing the main view's shadow map, read back without stalling
the GPU, and only while the tile is open during a run. It is labelled a
synthetic stream, and it behaves like the video class it stands for: it moves
only while the engine keeps reporting newly delivered video frames, it freezes
the moment the receiver reports the stream stalled, and its frame counter is
the engine's own count.

## Defects found and fixed in Phase 8

1. **A null stall rendered as "0 ms".** The camera tile printed a missing
   `stall_ms` as zero. It now reads "unavailable", as the hard rules require.
2. **A dark square under every palm.** The ground-contact footprint, meant for
   buildings, drew a dark rectangle under plants and boulders - invisible on
   sand, a stain on a lawn. Plants and boulders no longer get one.
3. **A camera could have gone under the sea.** The camera clamp kept cameras
   above the ground, which offshore is the seabed. Cameras and coverage
   footprints now stay above the water's surface.
4. **The first island was too heavy for a software rasteriser.** Under
   SwiftShader it drew 1.9 fps, below the smoke suite's floor of 2: the new
   trees nearly tripled the low tier's triangles (239k to 642k), and the
   clouds, the meadow and the sea added per-pixel noise. The low tier now
   gets a lighter sky (three octaves, no sunward sample), the meadow without
   its detail layers, a one-octave sea, half-resolution mountains and two in
   five of the meadow trees: 3.3 fps, inside the 2.4-3.8 fps the desert world
   measured on the same machine. The high and balanced tiers are unchanged.
5. **The capture view hung on a software rasteriser.** Its own canvas started
   on the high tier and switched to low a moment later, and the switch freed
   a material that was still drawing: the mountains' cleanup disposed their
   material together with the geometry it replaced. three's `compileAsync`,
   polling that material from a timer, then threw and never settled, so the
   render loop stayed held and the frame never became ready - the phase 2
   capture test caught it, stuck on "preparing shaders". Now the mountains'
   geometry and material have separate lifetimes; every Mission runtime starts
   at the device's quality ceiling, so a software rasteriser never compiles the
   high tier first; a tier change only changes how many instances an
   instanced mesh draws, never the mesh, whose rebuild would release the
   glTF's shared materials; shared glTF resources are never disposed with a
   mesh; and the precompile hold gives up after 8 s whatever happens. On the
   same software rasteriser the capture frame is now ready in about 2 s.

## Known limitations of Phase 8

* **The demo video predates Phases 7 and 8.** `deliverables/CONTINUA_Team_Kanban_Demo.mp4`
  shows the Phase 3 desert world and interface; re-capturing it is a separate
  job.
* **The landscape is not in the network model.** Mountains do not shadow a
  link and the sea does not attenuate one; coverage is the same geometric model.
* **The rover camera is synthetic.** It is a render of the simulated world,
  never transported video; only its motion is tied to the engine's video
  figures.

## The waterfront

* **A lighthouse** on the headland's high ground past the ground station: a
  21 m tower in red and white bands, a railed gallery, a glazed lantern and
  the keeper's house.
* **A jetty** below the campus, 44 m out from the waterline on piles, with
  bollards, fenders and lamps, and the rescue boat moored alongside - the boat
  that answers to the same operations centre as the rover.
* **Lifeguard towers** on the south beach.
* **Boats on fixed courses**: two yachts and a patrolling rescue boat sail
  slow ellipses offshore and ride a gentle swell (heave, pitch, roll), all as
  a pure function of the scene clock - scrub to a time and every boat is where
  it was. Decoration only.
* The sea's depth now carries on past the modelled ground, shelving away,
  instead of jumping to deep water at its edge (a visible seam); the power line
  south of the corridor moved inland off the beach.

## The opening

* **The introduction was a still.** Mission opens on the director's cut, but
  nothing ever started the preview's clock, so the cut sat on its first frame -
  a follow shot of the rover parked at the dock - for as long as the page was
  open. The preview now plays its own loop behind the introduction, badged
  SCENE PREVIEW as before, until a run takes the clock.
* **An aerial opens the cut**: high over the island's north-west shore,
  looking across the rover to the coast, the sea, the wind farm and the
  mountains, then a long descent to the rover; the crane at the end of the
  cycle climbs back into it. Every shot is still a pure function of time.
* **Cloud shadows** drift over the land and the sea on the breeze, a function
  of the scene clock; the low tier skips them.
* **The tracking shot rides inside the planting.** It ran 10 m off the road,
  between the flower beds and the palm avenue, so palms swept across the rover
  on the campus road; at 6.4 m nothing passes between camera and rover there.

## Measured

On this machine (RTX 4070 Laptop GPU, Chromium on ANGLE / D3D11), 1920×1080,
high tier with ambient occlusion:

| | Phase 7 | Phase 8 |
| --- | --- | --- |
| Mission with a run, frames per second (`perf-probe.mjs`, uncapped) | 146-175 | 238 |
| Frame time p50 / p95 / p99 | - | 3.8 / 6.2 / 8.1 ms |
| Long main-thread tasks | 0 | 0 |
| Page switch to a drawn scene | 0.4-0.7 s, loader shown | no loader, worst frame 17 ms |
| New WebGL contexts on a tour of every page | one per scene page | 0 |
| First load to a drawn scene | 3.5 s | 2.5 s |
| Models, Draco | 2.07 MB | 2.23 MB |
| SwiftShader, Scene Lab, low tier | 2.4-3.8 fps | 3.3 fps |

The richer world first made the first load a second slower (4.6 s); the fix
below brought it to 2.5 s. Every load after it is a runtime swap.

## First load: the precompile compiled the wrong programs

The scene compiles its programs ahead of the first frame, in parallel, while
the loader shows. Instrumenting `linkProgram` showed the first frame still
linking 37 programs one after another on the main thread - a single 1.8 s
frame, the loader frozen for all of it. Diffing their cache keys against the
precompiled ones found one flag: **fog**. The fog was set in a passive effect,
which runs after the precompile's layout effect, so every material was
compiled without fog and compiled again, with it, on the first frame. The fog
is now set in a layout effect, ahead of the precompile; the sky's environment
map is filtered synchronously at mount instead of on the first frame (drei's
`<Environment>` captured it there); and the precompile builds the variant
each frame draws (into the post-processing target on the high tier, onto the
canvas otherwise). The first frame now links 13 programs (shadow depth, the
post-processing passes, line variants) and takes 0.22 s instead of 1.8 s; the
scene is drawn about 1.5 s sooner.

## Verification

| Suite | Result |
| --- | --- |
| `npm run lint` | clean, zero warnings |
| `npm run typecheck` | clean |
| `npm run build` | compiles, every route |
| `npm run test:engine` | **145 passed** (no engine code changed in this phase) |
| `npm run test:phase2` | **11 passed**, against the production build and a live engine |
| `npm run test:smoke` | **11 passed**, 10 skipped by project design, at 1920, 1440 and 1280 |

Looked at in a browser at 1920×1080, 1440×900, 1366×768 and 1280×720, idle and
during a run (`node scripts/ui-screenshots.mjs`, with and without `--run`): no
page scrolls, nothing is unreachable, no text is smaller than 11 px.
