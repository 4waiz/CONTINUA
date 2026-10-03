# CONTINUA - progress

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Vehicle, world, route animation, scene components, design system, `/scene-lab` | **complete** |
| 2 | Working application, network engine, controller, experiments | **complete** |
| 3 | Demo video: claim ledger, deterministic capture, narration, edit | **complete** |
| 3.1 | UI/UX overhaul: fixed-viewport shell, 3D hero, redesigned pages | **complete** |
| 4 | Per-class steering, control mode handover, B2-defer, honesty fixes, `test2` comparison | **complete** |

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
