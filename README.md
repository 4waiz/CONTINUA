# CONTINUA

**Predictive Network Continuity** — by Team Kanban
*The network changes. The session doesn't.*

An interactive 3D scene following an unarmed emergency-response / industrial
inspection rover as it drives from a wired docking facility, through Wi-Fi and
cellular coverage, into a remote satellite-served sector — and shows how the
session survives every handoff.

![CONTINUA dashboard](assets/previews/browser/dashboard-1920.png)

## Run it

```bash
npm install
npm run engine              # engine on 127.0.0.1:8000 — leave this running
npm run build && npm start  # app on localhost:3000
```

| URL | Section |
| --- | --- |
| <http://localhost:3000> | **Mission** — live run, 3D scene, link cards, application health |
| <http://localhost:3000/scenario-lab> | Inject failures and congestion, change speed and workload |
| <http://localhost:3000/experiments> | Paired policy comparison and the execution-capability report |
| <http://localhost:3000/decision-log> | Every controller action with its observations and reason |
| <http://localhost:3000/capture?run=…> | Fixed 16:9 capture frame |
| <http://localhost:3000/scene-lab> | Phase 1 scene inspector |

Node 20.11+ and Python 3.11+ required. Engine dependencies:
`pip install -r services/engine/requirements.txt`.

## What this is

**Phases 1–2 of 3: the vehicle and world, and a working application-aware
connectivity prototype.**

A Python engine simulates four access paths — finite queues, capacity, delay,
jitter, correlated burst loss, activation delay, competing demand and per-byte
cost — and carries five real traffic classes across them. A controller observes,
predicts, prepares a backup, steers, and explains itself. The 3D scene
visualises the experiment; it is not the networking engine.

**Everything here is a deterministic software model.** It is not a live
mobile-network test. The execution mode is stamped on every event, on the
dashboard and in the capture frame. Emulation and MPTCP are **not verified on
this machine** — the reasons were probed, not assumed, and are recorded in
`data/emulation_capability.json`.

![Rover close-up](assets/previews/browser/view-02-vehicle-closeup.png)

## Commands

| Command | What it does |
| --- | --- |
| `npm run engine` | Start the Python engine |
| `npm run dev` / `npm run build` / `npm start` | Frontend |
| `npm run lint` · `npm run typecheck` | Static checks, both clean |
| `npm run test:engine` | 36 engine tests |
| `npm run test:phase2` | 11 browser tests (engine must be running) |
| `npm run test:smoke` | Phase 1 scene tests, 3 viewports |
| `npm run experiment:smoke` | 2 trials × every scenario, ~3 min |
| `npm run experiment` | 20 paired trials × 6 core scenarios, ~25 min |
| `npm run train:predictor` | Retrain the learned predictor |
| `npm run emulation:status` | Honest capability report for this host |
| `npm run blender:all` | Regenerate every 3D asset |

### The demo video

Each step reads the one before it; `video/timeline.json` is the edit decision
list and `docs/VIDEO_CLAIMS.md` is the gate.

| Command | What it does |
| --- | --- |
| `npm run video:cards` | Extract the caption-card figures from recorded runs and experiments |
| `npm run video:renders` | Blender opening and closing shots, 1920×1080 |
| `npm run video:capture:test` | 5 s probe capture — run this before the full one |
| `npm run video:capture` | Deterministic frame capture of every application shot and card (~6 min) |
| `npm run video:narration` | Local TTS, measured and fitted to the timeline; fails if a line does not fit |
| `npm run video:claims` | Banned phrases, claim resolution, timeline integrity |
| `npm run video:build` | Composite, encode, poster, contact sheet, manifest |
| `npm run video:qa` | Inspect the finished MP4 and write `docs/VIDEO_QA.md` |

## Layout

```
apps/web/            Next.js 16 frontend — Mission, Scenario Lab, Experiments, Decision Log
services/engine/     Python engine — simulator, controller, predictors, API, experiments
packages/scene/      Reusable 3D scene, plus the engine-driven scene source
packages/contracts/  Shared types (TypeScript + Python) and world.json
scripts/emulation/   Linux namespace / netem topology scripts
assets/              .blend sources, reference imagery, renders, browser evidence
data/                Experiment results and capability report (run logs are git-ignored)
docs/                Ten documents — see below
tests/               Engine (pytest) and browser (Playwright) suites
```

## Documentation

| Document | Contents |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Project rules and the checkpoint policy used by all phases |
| [`docs/DESIGN_SPEC.md`](docs/DESIGN_SPEC.md) | Reference analysis and design tokens |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Scene and application boundaries, determinism |
| [`docs/ASSET_MANIFEST.md`](docs/ASSET_MANIFEST.md) | Assets, licences, the orientation contract |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Measured results, defects fixed, limitations |
| [`docs/PHASE_1_HANDOFF.md`](docs/PHASE_1_HANDOFF.md) | Everything Phase 2 needed |
| [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) | Everything modelled rather than measured |
| [`docs/METRICS.md`](docs/METRICS.md) | Every metric, unit and measurement window |
| [`docs/EXPERIMENT_METHOD.md`](docs/EXPERIMENT_METHOD.md) | Pairing, seed blocks, and how not to fool yourself |
| [`docs/MODEL_CARD.md`](docs/MODEL_CARD.md) | The learned predictor, including its calibration failure |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model and known weaknesses |
| [`docs/AI_USE.md`](docs/AI_USE.md) | Where ML is used, and why no LLM is in the routing loop |
| [`docs/PHASE_2_HANDOFF.md`](docs/PHASE_2_HANDOFF.md) | Everything Phase 3 needs |
| [`docs/VIDEO_CLAIMS.md`](docs/VIDEO_CLAIMS.md) | Every claim in the video, with its run ID, evidence mode and status |
| [`docs/VIDEO_QA.md`](docs/VIDEO_QA.md) | What was checked in the finished MP4, and what was not |
| [`docs/SUBMISSION_CHECKLIST.md`](docs/SUBMISSION_CHECKLIST.md) | Deliverables, reproduction steps, and what was deliberately not done |

## Measured

**720 paired experiment runs** — 20 trials × 6 policies × 6 core scenarios,
0 failures. On `wifi-degradation`, CONTINUA matches always-on redundancy on
continuity (0 reconnects, 0.16 s interruption) while using **4.8 MB of satellite
instead of 61.2 MB (−92 %)**, **1.25 cost units instead of 4.31 (−71 %)** and
**37 % less video stall**. Under cellular congestion it cuts control deadline
misses from 49 % to **31 %**.

**And an honest negative result:** prediction does not pay for itself. The
`P1 − P1-noPred` ablation is a wash at both predictor qualities tested — the
value is in *preparation* and *application-awareness*, not in prediction. Full
numbers, including where CONTINUA loses, are in `docs/PROGRESS.md`.

Rendering (kept separate from network metrics): 233.8 fps at 1920×1080 on Intel
integrated graphics; 131 draw calls; 2.28 MB of runtime assets.

## Phases

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Vehicle, world, route animation, scene components, design system, `/scene-lab` | **complete** |
| 2 | Network engine, controller, dashboard, experiments | **complete** |
| 3 | Demo video: claim ledger, deterministic capture, narration, edit | **complete** |
