# VIDEO_CLAIMS - every claim in the demo video, and what backs it

This file was written **before** the video was edited, and it is the gate: a
sentence that cannot be traced to a row in these tables does not go in the
narration, on a caption card, or into the on-screen chrome.

Three things it is designed to prevent:

1. **Numbers with no run behind them.** Every figure below names the run ID or
   experiment ID it came from and the file it can be re-read from.
2. **A simulation described as a network.** The mode column is not decoration.
   Everything in this video is `SIMULATION`. There is no measured hardware, no
   real radio, no live satellite link, and the video says so out loud.
3. **A wish presented as a result.** The status column separates what is
   implemented and measured from what is implemented but *not* measured here,
   from what is only proposed.

Status vocabulary:

| Status | Meaning |
| --- | --- |
| **measured** | Produced by code in this repository, recorded to disk, re-readable from the named file |
| **implemented** | The code exists and runs, but the sentence describes behaviour rather than quoting a measurement |
| **not verified here** | Implemented, but this host cannot execute or confirm it. Named as such on screen |
| **proposed** | Future work. Must be spoken in the future tense |

---

## 0. Provenance of the footage

| Item | Value | Source |
| --- | --- | --- |
| Execution mode of every application shot | `SIMULATION` | `manifest.json` `mode` field of each run |
| Simulator | Discrete-time causal software model, 50 steps/s | `services/engine/continua_engine/sim/simulator.py` |
| Emulation footage | **none** - no emulated run appears in the video | `data/emulation_capability.json` |
| Hardware / radio / satellite footage | **none** | - |
| Code commit at capture | recorded in `video/manifest.json` at build time | `scripts/build-demo.mjs` |
| Predictor in the shown runs | `heuristic-trend-1.1` | run `metrics.json` → `prediction.predictor` |

Every dashboard shot carries the execution-mode chip in frame. The 3D opening
and closing shots are Blender renders of the project's own asset and are
labelled **rendered scene**, not captured telemetry.

### Playback rate

One stretch - the five-step sequence, shot S4 - is played at **0.36x** so that
two controller actions 0.66 s apart in the run are both readable. Whenever the
rate is not 1.0 the frame carries a badge saying so, next to a `t+` readout that
is always the run's own clock, never video time. No other shot is retimed, and
nothing is sped up anywhere.

### How the shown trace was chosen

Not by looking for the best one. `scripts/select_representative.py` fixes the
rule in its docstring and writes the outcome to `video/representative.json`:

> Rank the CONTINUA (P1) trials of the completed 20-trial `test`-block
> experiment by that scenario's primary metric. Take the **lower median**.
> Never the best.

For `wifi-degradation` the primary metric is `continuity.total_interruption_s`;
all 20 P1 trials returned 0.16 s, so the median trial is representative by
construction. Trial 9, seed 70009, was selected. The baseline shot is the **same
seed, same scenario, same exogenous trace** - only the policy differs.

---

## 1. Claims spoken in the narration

Times are the caption cue points in `video/timeline.json`.

Several claims are **shown but not spoken** - the caption cards carry more
precision than a voice-over can. Those rows say so rather than quoting a
sentence nobody says.

| # | Claim, as it appears | Run / experiment | Mode | Source file | Status |
| --- | --- | --- | --- | --- | --- |
| C1 | "A response vehicle drives out of coverage." (N1) | route + coverage model, 24 control points, 917 m | simulation | `packages/contracts/world.json`, `packages/scene/src/world/route.ts` | implemented |
| C2 | "Everything here is a software simulation. No radios, no satellite, no hardware." (N2) | - | - | `docs/ASSUMPTIONS.md` §1 | implemented |
| C3 | "The reactive baseline waits for its link to fail." (N3) | policy `B0` = switch only on measured unusability | simulation | `services/engine/continua_engine/controller/controller.py` → `POLICY_LIBRARY['B0']` | implemented |
| C4 | "The session goes dark four times: seven point three two seconds." (N3) | `run-7d8750c2b7` | simulation | `data/runs/run-7d8750c2b7/metrics.json` → `continuity` | **measured** |
| C5 | "Five steps." plus the five step captions (N5–N8) | controller state machine | simulation | `services/engine/continua_engine/controller/controller.py` | implemented |
| C6 | "Observe: receiver side facts only. The controller never sees the world's script." (N5) | trace isolation | simulation | `tests/engine/test_engine.py::test_controller_cannot_reach_trace` | **measured** (asserted by test) |
| C7 | "Prepare: it warms cellular while Wi-Fi still carries." Caption: "t+28.76 s · duplicate onto cellular while Wi-Fi still carries" | `run-d2819d215c`, action `start_duplication` @ 28.76 s | simulation | `data/evidence/video/run-d2819d215c/`, `data/runs/run-d2819d215c/events.jsonl` | **measured** |
| C8 | "Steer: six tenths of a second later." / "Explain: it records why, at the moment it decided." Caption: "t+29.42 s · session moved on a measured violation" | same run, action `switch` @ 29.42 s, reason recorded at decision time | simulation | `data/evidence/video/run-d2819d215c/`, `data/runs/run-d2819d215c/events.jsonl` | **measured** |
| C9 | "Same seed, same trace, only the policy changed. Seven point three two seconds becomes zero point one six." (N9) | `run-7d8750c2b7` vs `run-d2819d215c` | simulation | both `metrics.json` | **measured** |
| C10 | "…and that remainder is the session starting up." (N9), plus the card footnote | outage window 0.00–0.20 s, present in every policy including the baselines | simulation | `data/runs/*/events.jsonl` → `app.in_outage` | **measured** |
| C11 | "Twenty paired trials say something we did not expect. Preparation is what removes the interruption." (N11) | `exp-26f132d5d7`, policies B2 and P1 | simulation | `data/experiments/exp-26f132d5d7.json` → `aggregate` | **measured** |
| C12 | "What CONTINUA adds is the price: the same continuity at a third of the cost, a twelfth of the satellite data." (N12), with the exact figures on the results card | `exp-26f132d5d7`, P1 vs B2 | simulation | same | **measured** |
| C13 | Ablation card only - not spoken. "…without application-awareness: 4.78 cost units, 62.3 MB satellite" | ablation `P1-noApp` | simulation | same → `aggregate['P1-noApp']` | **measured** |
| C14 | Results and ablation cards only - not spoken. Congestion column, P1 31.5 % vs B2 49.2 % | `exp-64931cf540`, P1 vs B2 | simulation | `data/experiments/exp-64931cf540.json` | **measured** |
| C15 | "Take the predictor out and almost nothing changes." (N11) | ablation `P1-noPred` | simulation | `data/experiments/exp-26f132d5d7.json`, `docs/EXPERIMENT_METHOD.md` | **measured** |
| C16 | Predictor card only - not spoken. Recall 0.140 → 0.782, false positives 7.5 → 101, app health 68.8 → 67.9 | `exp-e70fe761a1` (learned predictor) | simulation | `data/experiments/exp-e70fe761a1.json`, `docs/MODEL_CARD.md` | **measured** |
| C17 | "Total loss: ten point six seconds, every policy." (N13) | `exp-657ef4a89a` (`total-loss`) | simulation | `data/experiments/exp-657ef4a89a.json` | **measured** |
| C18 | "Emulation is unverified here and the kernel has no MPTCP." (N13), and the scope card | capability probe | - | `data/emulation_capability.json`, `docs/ASSUMPTIONS.md` | **not verified here** |
| C19 | Scope card only - not spoken. "Hardware in the loop, a real radio, and a field trial are the next step - not a result." | - | - | `docs/PHASE_2_HANDOFF.md` | **proposed** |

---

## 2. Figures displayed on screen

Any number rendered as a caption card. Same rule: it exists on disk first.

### 2a. The paired comparison card (S5)

`wifi-degradation`, seed 70009, one trial each, identical exogenous trace.

| Displayed | B0 | P1 | Source |
| --- | --- | --- | --- |
| Session reconnects | 1 | 0 | `continuity.session_reconnects` |
| Interruptions | 4 | 1 | `continuity.interruptions` |
| Total interruption | 7.32 s | 0.16 s | `continuity.total_interruption_s` |
| Longest interruption | 4.50 s | 0.16 s | `continuity.longest_interruption_s` |
| Control deadline miss | 34.32 % | 31.97 % | `application.control.deadline_miss_pct` |
| Video frames delivered | 57.97 % | 68.0 % | `application.video.frame_delivery_pct` |
| Satellite bytes | 47.59 MB | 4.79 MB | `links.satellite_bytes` |
| Cost units | 3.44 | 1.19 | `links.cost_units` |

Runs: `run-7d8750c2b7` (B0) and `run-d2819d215c` (P1). Files:
`data/runs/<run_id>/metrics.json`.

**Shown alongside, not hidden:** P1 performed **5** handovers to B0's 3, and
completed **67.8 MB** of bulk transfer against B0's **138.5 MB** - bulk is
deliberately throttled to protect control and video. Both appear on the card.

### 2b. The aggregate card (S7)

`exp-26f132d5d7` - `wifi-degradation`, `test` seed block, 20 paired trials per
policy, heuristic predictor, commit `352acd58a1`. Mean [95 % CI].

| Displayed | B0 | B2 | P1 |
| --- | --- | --- | --- |
| Total interruption (s) | 7.32 [7.32, 7.32] | 0.16 [0.16, 0.16] | 0.16 [0.16, 0.16] |
| Control deadline miss (%) | 34.6 [34.5, 34.8] | 31.8 [31.6, 32.0] | 31.5 [31.3, 31.7] |
| Video frames delivered (%) | 57.4 [57.1, 57.7] | 64.4 [64.0, 64.7] | 67.3 [66.8, 67.7] |
| Satellite (MB) | 47.59 | 61.20 [60.57, 61.83] | 4.78 [4.76, 4.80] |
| Cost units | 3.44 [3.44, 3.44] | 4.31 [4.27, 4.35] | 1.25 [1.19, 1.31] |
| App health | 66.4 [66.3, 66.5] | 70.3 [70.1, 70.4] | 68.8 [68.6, 69.0] |

**App health is the row where P1 loses**, and the card says so: B2 scores 70.3
against P1's 68.8 in this scenario, because B2 is buying quality with satellite
bytes P1 refuses to spend. Under `cellular-congestion` the ordering reverses
(`exp-64931cf540`: P1 68.9, B2 59.2). Both are on screen.

### 2c. The ablation card (S6)

`exp-26f132d5d7` and `exp-64931cf540`, means over 20 trials.

| Variant | Interruption | Cost units | Satellite | Control miss (congestion) |
| --- | --- | --- | --- | --- |
| P1 | 0.16 s | 1.25 | 4.78 MB | 31.5 % |
| P1 without prediction | 0.16 s | 1.23 | 4.74 MB | 31.5 % |
| P1 without app-awareness | 0.16 s | 4.78 | 62.33 MB | 51.6 % |

The reading given on screen, in these words: *prediction is not what removed the
interruption; preparation is. Application-awareness is what made it affordable.*

### 2d. The predictor card (S6)

| Displayed | Heuristic | Learned | Source |
| --- | --- | --- | --- |
| Precision | 0.838 | 0.649 | `aggregate.P1.prediction_precision` |
| Recall | 0.140 | 0.782 | `aggregate.P1.prediction_recall` |
| False positives / run | 7.5 | 101.4 | `aggregate.P1.prediction_false_positives` |
| Resulting app health | 68.8 | 67.9 | `aggregate.P1.app_health_score` |

Experiments `exp-26f132d5d7` (heuristic) and `exp-e70fe761a1` (learned), same
scenario, same seed block. Offline model quality is in `docs/MODEL_CARD.md`:
precision 0.874, recall 0.677, Brier 0.1896 against a 0.2485 baseline, mean
absolute calibration error 0.1364, **`calibrated: false`**. The video does not
call the model calibrated.

Scoring rule shown on the card: only transitions into violation are scored;
rows where the carrying path was already in violation are excluded, because
counting them inflates precision to a meaningless 0.997.

---

## 3. Phrases that are banned from this video

Checked mechanically over `video/narration.md` and `video/timeline.json` by
`scripts/check-claims.mjs`, which fails the build on a hit.

| Banned | Why |
| --- | --- |
| 99.99 % uptime | Never measured. It is a number from the design reference |
| zero loss, zero downtime, no interruption | The measured floor is 0.16 s, and `total-loss` reaches 10.6 s |
| works everywhere, works anywhere | Six scenarios on one synthetic route |
| guaranteed / guarantee continuity | Nothing here is guaranteed |
| live satellite, real satellite, field test, field trial, on the road | No hardware was involved |
| 5G | The cellular profile is a shaped software link, not a 5G stack |
| MPTCP (except in the sentence that says it is unavailable) | `CONFIG_MPTCP` is unset on this kernel |
| production-ready, enterprise-grade, battle-tested | Not audited, not deployed |
| secure by design (as evidence) | See `docs/SECURITY.md` |
| AI decides / AI routes / neural network in the loop | No LLM is in the routing loop; the model is a 13-feature logistic regression |
| real-time network, live network, live test | It is a simulation |
| industry-standard, best-in-class, state-of-the-art | Unsupported comparative claims |

---

## 4. What the video must state out loud

Not optional, and each has a caption card as well as narration:

1. **"Software simulation"** - within the first fifteen seconds, before any
   result is shown.
2. **The remaining 0.16 s** - stated when the continuity figure is first shown,
   in the same breath, not in a footnote.
3. **Prediction did not help** - the ablation is in the video, not only in the
   repository.
4. **Emulation is unverified on this host and MPTCP is unavailable** - stated,
   with the reason.
5. **Total loss defeats it** - 10.6 s, all policies.
6. **`by Team Kanban`** on the final card.

---

## 5. Verification

```bash
node scripts/check-claims.mjs          # banned phrases + every claim ID resolves
python scripts/analyse_run.py run-d2819d215c run-7d8750c2b7 run-3c69f9615f
python scripts/select_representative.py
```

The first command is part of `npm run build:demo` and blocks the render.
