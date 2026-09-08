# CONTINUA — Phase 2 → Phase 3 handoff

Everything Phase 3 (competition video capture and edit) needs.

---

## 1. What Phase 2 delivered

A working, application-aware connectivity prototype:

* A **causal software network simulator** — finite queues, capacity, delay,
  jitter, correlated burst loss, activation delay, competing background demand,
  and per-byte cost — driving five traffic classes with real receivers.
* A **controller** implementing Observe → Predict → Prepare → Steer → Explain,
  with eight explicit states, hysteresis, minimum dwell time and switching
  penalties.
* **Six policies** behind one interface: B0, B1, B2, CONTINUA (P1) and two
  ablations.
* A **heuristic and a learned predictor**, with the learned one honestly marked
  uncalibrated and falling back when unavailable.
* A **FastAPI backend** with REST control, a WebSocket event stream, SQLite run
  metadata and JSONL evidence.
* A **four-section dashboard** — Mission, Scenario Lab, Experiments, Decision
  Log — plus a fixed 16:9 capture view, all driven by computed engine state.
* **Paired experiments**: 20 trials × 6 policies × 6 core scenarios, 720 runs,
  0 failures.

Phase 1's vehicle, world, design system and scene are unchanged and still
render; the scene is now driven by `EngineSceneStateSource` instead of the
preview source, exactly as the Phase 1 handoff specified.

---

## 2. The capture seam

### `/capture?run=<run_id>`

A fixed 16:9 frame with no navigation and no dev overlays. It always shows the
execution mode, run id, scenario, policy and seed. **There is no "LIVE" badge
during playback** — a replay says REPLAY, with the source run and recording time
in its tooltip.

### Ready signal

```js
document.querySelector('[data-capture-ready]').dataset.captureReady === 'true'
```

True once the glTF assets have loaded, the scene has drawn and the socket is
connected. A browser test asserts it flips to `true`.

### Deterministic control

```js
window.__CONTINUA_CAPTURE__ = {
  ready, runId, mode, scenario, t, duration,
  seek(t),   // absolute seek, awaits the engine
  pause(),
  play(),
}
```

`seek(t)` on a live simulation rebuilds from the same seed and fast-forwards,
which is *exact* rather than approximate because the simulator is deterministic.
On a replay it moves the cursor through the recorded events. Either way the same
`t` produces the same frame.

### Recommended capture procedure

1. Start the engine and the web app.
2. Create the run you want (see §3 for the recommended one).
3. Open `/capture?run=<id>`, wait for `data-capture-ready="true"`.
4. `__CONTINUA_CAPTURE__.pause()`, then step: `seek(t)` → wait ~2 frames →
   grab the frame → `seek(t + 1/fps)`.
5. Assemble with ffmpeg (`ffmpeg -framerate 30 -i frame%05d.png …`).

Frame-stepping rather than real-time recording is what makes the capture
reproducible; the scene's clock resyncs to the engine's authoritative time on
every seek.

---

## 3. A representative run for the video

**Scenario `cellular-congestion`, policy `P1`, seed `70000`, predictor
`heuristic`.**

```bash
curl -s -X POST http://127.0.0.1:8000/api/runs \
  -H 'content-type: application/json' \
  -d '{"control":{"scenario_id":"cellular-congestion","policy_id":"P1","seed":70000,"speed":1,"predictor":"heuristic","horizon_s":3}}'
```

Why this one: it is where CONTINUA's advantage is largest and clearest.
Availability stays high the whole time — a coverage-only policy sees nothing
wrong — while background demand takes 86 % of the cell and queues build.
CONTINUA's application-aware policy defers bulk and adapts video, and the
numbers separate decisively:

| | B0 | B1 | B2 | **P1** |
| --- | --- | --- | --- | --- |
| Control deadline miss % | 54.40 | 52.50 | 49.16 | **31.46** |
| App health | 54.6 | 57.3 | 59.2 | **68.9** |
| Video stall ms | 26 905 | 21 169 | 20 800 | **11 326** |
| Satellite MB | 47.6 | 61.4 | 63.8 | **4.8** |
| Cost units | 3.34 | 4.98 | 4.36 | **1.15** |

Beats at t ≈ 46 s (congestion ramps), t ≈ 50 s (bulk deferred, video steps
down), t ≈ 76 s (congestion clears).

A good B-roll contrast is the same seed under **B0**, which reconnects once and
loses 7.3 s of session.

---

## 4. Running it

```bash
npm install
npm run engine            # FastAPI on 127.0.0.1:8000  (leave running)
npm run build && npm start  # Next.js on localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run engine` | Start the backend |
| `npm run dev` / `npm run build` / `npm start` | Frontend |
| `npm run lint` · `npm run typecheck` | Static checks, both clean |
| `npm run test:engine` | 36 Python engine tests |
| `npm run test:smoke` | Phase 1 scene tests, 3 viewports |
| `npm run test:phase2` | 11 Phase 2 browser tests (needs the engine) |
| `npm run experiment:smoke` | 2 trials × every scenario, ~3 min |
| `npm run experiment` | 20 paired trials × 6 core scenarios, ~25 min |
| `npm run train:predictor` | Retrain the learned model |
| `npm run emulation:status` | Honest capability report for this host |
| `npm run blender:all` | Regenerate every 3D asset |

Emulation setup/cleanup (Linux, root, **not executed on the dev host**):

```bash
sudo ./scripts/emulation/setup.sh
sudo ./scripts/emulation/verify.sh
sudo ./scripts/emulation/cleanup.sh
```

---

## 5. Where the evidence lives

| Path | Contents |
| --- | --- |
| `data/experiments/*.json` | Per-experiment: seeds, per-run metrics, aggregates with 95 % CIs, paired deltas, commit |
| `data/experiments/index.json` | Which experiments were run, when, and how long they took |
| `data/runs/<run_id>/` | `manifest.json` (scenario, seed, policy, commit, environment), `events.jsonl`, `metrics.json`. Git-ignored — regenerate from the seed |
| `data/emulation_capability.json` | The probe output that says why emulation is unverified here |
| `services/engine/continua_engine/models/` | `predictor.json` and `training_report.json` |
| `tests/output/evidence/` | Browser screenshots |
| `assets/previews/` | Blender renders and promoted browser evidence |

---

## 6. Honest status: what is verified and what is not

### Verified by execution

* Simulation mode, all ten scenarios, all six policies.
* 720 paired experiment runs, 0 failures.
* Determinism: same seed → identical event stream (test).
* No future-information leakage (test walks the controller's attributes).
* Command deduplication, outage reporting, replay equivalence (tests).
* 36 engine tests, 11 Phase 2 browser tests, 11 Phase 1 scene tests — all pass.
* The learned predictor's precision/recall/calibration on held-out tuning runs.

### NOT verified here

* **Emulation.** The adapter, topology scripts and verification script exist and
  parse cleanly. **They have not been run.** The dev host lacks passwordless
  sudo, so namespaces cannot be created non-interactively.
* **MPTCP.** The WSL2 kernel has `CONFIG_MPTCP` unset. Verified MPTCP is
  **impossible** on this machine, and no result here should be described as
  MPTCP. The multipath behaviour in the simulator is an MPTCP-*inspired model*.
* **Transfer of the learned model to a real network.** Trained purely on
  synthetic data; assume it does not transfer.
* **Anything about real 5G or real satellite systems.** Those are shaped access
  profiles, not radio or constellation simulations.

---

## 7. The result that most needs stating

**Application-awareness is doing the work. Prediction, as currently
implemented, is not.**

On `wifi-degradation`, 20 paired trials:

| Comparison | Interruption Δ | Satellite Δ | Cost Δ | Health Δ |
| --- | --- | --- | --- | --- |
| P1 − B0 | **−7.16 s** | **−42.8 MB** | **−2.18** | +2.42 |
| P1 − B1 | −0.86 s | **−54.3 MB** | **−3.52** | −0.51 |
| P1 − B2 | 0.00 s | **−56.4 MB** | **−3.06** | −1.47 |
| P1 − P1-noApp | 0.00 s | **−57.5 MB** | **−3.53** | +0.27 |
| **P1 − P1-noPred** | **0.00 s** | **0.0 MB** | **+0.02** | **−0.21** |

The prediction ablation is a wash, or very slightly negative: CONTINUA with
prediction produced 7.5 false positives and 0.15 unnecessary handovers per run
and bought nothing measurable for them. The heuristic predictor's recall on
transitions is only ~0.14, so it rarely fires before the reactive trigger would
have.

### The learned predictor was tested too, and it did not rescue prediction

`wifi-degradation`, 20 paired trials, `--predictor learned`:

| | P1 (learned) | P1-noPred |
| --- | --- | --- |
| Prediction recall | **0.782** | — |
| Prediction precision | 0.648 | — |
| False positives per run | **101.4** | 0 |
| Unnecessary handovers | 1.25 | 0 |
| Total interruption | 0.16 s | 0.16 s |
| Control deadline miss | 31.38 % | 31.50 % |
| Video stall | 11 481 ms | 11 523 ms |
| Cost units | **1.084** | 1.232 |
| App health | 67.9 | **69.0** |

Raising recall from 0.14 to 0.78 bought a **12 % cost reduction** and a
**1.1-point drop in app health**, at the price of ~101 false alarms per run.
Prediction still does not pay for itself.

### Why — the mechanism worth understanding

Both P1 and P1-noPred **pre-warm a backup path proactively**. That is what
removes the interruption; it happens whether or not anything is predicted. The
predictor's only remaining job is to decide *when to switch early*, and
switching early has a real cost (activation, duplicate bytes, a handover).

**The value in CONTINUA is in preparation and application-awareness, not in
prediction.** That is the honest headline, and it is a more interesting claim
than the one the project set out to make.

**Do not present prediction as a demonstrated win in the video.** It is not one,
at either predictor quality tested. The demonstrated wins are:

1. **Multipath** eliminates session reconnects (1.0 → 0.0 per run vs B0).
2. **Proactive pre-warming** removes the interruption (7.32 s → 0.16 s vs B0;
   matching always-on redundancy).
3. **Application-awareness** cuts satellite usage ~92 %, cost ~71 % and video
   stall ~37 % against always-on redundancy, and cuts control deadline misses
   from 49 % to 31 % under congestion.

---

## 8. Things Phase 3 should not do

* **Do not add a "LIVE" badge to a replay.** The mode badge is load-bearing.
* **Do not crop out the identity strip.** Mode, run id and scenario must be
  visible in the recorded frame.
* **Do not present the reference mock's numbers** (99.99 % uptime, 24 ms,
  0.01 % loss, 12 handoffs, 96 QoS). None of them are measurements. The real
  ones are in `data/experiments/`.
* **Do not describe the simulator as a network test**, or the shaped cellular
  profile as 5G, or anything here as MPTCP.
* **Do not re-run the comparison until a better number appears.** The test seed
  block is fixed at 70 000–70 019 and was used once.
* **Do not put an LLM in the routing loop.** See `docs/AI_USE.md`.

---

## 9. Known limitations carried into Phase 3

* Emulation unverified (above).
* No congestion control in the model — see `docs/ASSUMPTIONS.md` §2.
* Bulk transfer is fluid, not packetised.
* The learned predictor is uncalibrated (mean absolute calibration error 0.136).
* `app_health_v1` weights are a product judgement, not derived.
* 20 trials gives wide confidence intervals; small gaps are inconclusive.
* Run storage is unbounded and the API is unauthenticated (loopback only) —
  see `docs/SECURITY.md`.
* Live-run seeking rebuilds and fast-forwards, which takes ~1–2 s for a long
  scenario.
