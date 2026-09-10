# CONTINUA - architecture

## 1. Shape of the repository

```
apps/web/                Next.js 16 frontend
  src/app/               /, /scenario-lab, /experiments, /decision-log, /capture, /scene-lab
  src/components/        Mission, ScenarioLab, Experiments, DecisionLog, Capture, AppShell, ui
  src/lib/               REST client, useEngineRun (WebSocket, reconnect, staleness)
  public/models/         Runtime .glb assets
services/engine/         The Python engine
  continua_engine/contracts.py     Authoritative event and metric schema (Pydantic)
  continua_engine/world.py         Route, coverage, motion - reads packages/contracts/world.json
  continua_engine/sim/             exogenous trace, network model, simulator loop
  continua_engine/controller/      state machine, policies, predictors, training
  continua_engine/experiments/     metrics, paired runner, CLI
  continua_engine/store/           SQLite metadata + JSONL evidence
  continua_engine/emulation/       capability probe and Linux adapter
  continua_engine/api/             FastAPI REST + WebSocket, run and replay sessions
  continua_engine/scenarios/       scenario specs and link profiles (JSON, not code)
  continua_engine/models/          predictor.json + training_report.json
packages/scene/          The reusable 3D scene
  src/core/clock.ts      Deterministic scene clock
  src/world/             route, terrain, road, sites
  src/preview/           Phase 1 preview state source
  src/engine/            EngineSceneStateSource - the Phase 2 seam
  src/components/        React Three Fiber components
packages/contracts/      Shared types (src/index.ts, src/engine.ts) and world.json
scripts/blender/         Reproducible asset generation and export
scripts/emulation/       setup.sh, verify.sh, cleanup.sh
scripts/                 checkpoint.py, run-blender.mjs, engine_cli.py
data/                    experiments/, emulation_capability.json (runs/ git-ignored)
tests/engine/            pytest engine suite
tests/                   Playwright browser suites
docs/                    This directory
```

npm workspaces only. No Turborepo, no Nx: two source packages consumed through
`transpilePackages` do not justify a build orchestrator.

## 2. The three boundaries that matter

### a. Scene ↔ state source

`packages/contracts` defines `SceneStateSource`:

```ts
interface SceneStateSource {
  readonly kind: 'preview' | 'engine';
  readonly runId: string;
  readonly duration: Seconds;
  sampleAt(simTime: Seconds): SceneState;
  subscribe?(listener: (state: SceneState) => void): () => void;
}
```

Phase 1 ships `PreviewSceneStateSource`, which derives everything from route
geometry and distance-to-infrastructure. Phase 2 supplies a live implementation
of the same interface. **No scene component changes.** `SceneState.source` tells
the UI which it is looking at, and the HUD is required to display it.

### b. Scene ↔ page

`<ContinuaScene>` owns the `<Canvas>` and nothing else. It is mounted by the
dashboard, by `/scene-lab`, and (in Phase 3) by the capture harness. Everything
page-specific - panels, controls, chrome - lives in `apps/web`.

### c. React ↔ render loop

React renders the scene graph once. After that:

* `SceneDriver` runs at `useFrame` priority `-1`, advances the clock, and writes
  `runtime.frame.current = source.sampleAt(t)`.
* Every other `useFrame` consumer reads `frame.current` and mutates three.js
  objects in place. **No React state is set per frame.**
* HUD panels read through `useThrottledSceneState(ms)`, which polls at 120–250 ms
  and also updates immediately on a seek.

This is why the React Compiler lint rules are switched off for
`packages/scene/**` and only there - see the comment in `eslint.config.mjs`.

## 3. Determinism

`setTime(t)` fully determines the frame. Concretely:

* `SceneClock` holds the only mutable time. `advance(dt)` is the sole path from
  wall-clock to simulation time, and it clamps a single step to 0.25 s so a
  backgrounded tab cannot teleport the rover.
* `PreviewSceneStateSource` integrates its speed profile into a time→distance
  table **once**, at construction, and plans every handoff in **one forward pass
  over the whole route**. Scrubbing backwards therefore produces exactly the
  states that playing forwards produced - there is no hysteresis that depends on
  playback history.
* All cameras are pure functions of `t`. There are no springs and no
  lerp-toward-target. Smoothness comes from `route.smoothHeadingAt(d, radius)`,
  which averages the route tangent over a window and is continuous by
  construction.
* Terrain, scatter placement and rock shapes come from a seeded integer hash, so
  the world is byte-identical between runs and machines.

A browser test asserts this: `sampleAt` over a set of timestamps, evaluated
forwards and then backwards, must be deeply equal.

## 4. The world model

One route, one terrain, one truth.

```
route.ts     Catmull-Rom through 24 control points, resampled every 1 m by arc
             length. Yields position, tangent, heading, curvature at any
             distance. 917 m long. Nearest-point queries use an X-bucket index.

terrain.ts   height(x, z) is the single authority for ground elevation.
             baseHeight() is procedural; within 20 m of the route the surface is
             blended toward the route's own smoothed elevation, fully flat
             within 7.5 m.

road.ts      Ribbon geometry generated from the same route samples and the same
             elevation function, offset 6 cm above the flattened corridor.

sites.ts     Where infrastructure stands, and coverageAt(network, x, z).
```

Because the road ribbon, the vehicle's contact point, prop placement and the
camera's ground clamp all call `terrain.height`, nothing can float or sink
relative to anything else. That is the mechanism, not a coincidence.

## 5. Coverage and handoff model (Phase 1)

Geometric, and labelled as such:

| Network | Model |
| --- | --- |
| wired | 1.0 within 14 m of the dock, falling to 0 by 20 m. Binary by nature |
| wifi | Best of three masts, full to 42 % of a 155 m radius then falling off |
| cellular | One three-sector macro site, 330 m radius |
| satellite | 0.42 everywhere, rising to 0.87 in the remote sector (clear horizon) |

Selection prefers the lowest-priority-number usable link (wired 0, wifi 1,
cellular 2, satellite 3), adopts a better link at ≥ 0.42 coverage, and abandons
the current one below 0.20. The resulting plan for the shipped route:

| t | from → to | why |
| --- | --- | --- |
| 0.0 s | - → wired | session established at the dock |
| 9.7 s | wired → wifi | tether released, yard cell takes over |
| 41.6 s | wifi → cellular | leaving Wi-Fi range, macro site available |
| 71.9 s | cellular → satellite | corridor coverage fading in the remote sector |

Each is pre-warmed 55 m ahead, which is what the dashed beam and the
`Pre-warming` chip represent.

## 6. Performance strategy

* **Instancing.** Repeated props (barriers, poles, containers, signs, three rock
  variants, route markers) go through one `InstancedMesh` per glTF primitive.
  Unique structures are cloned once. Measured: 131 draw calls for the full
  scene.
* **Shared materials.** All Blender materials are created once per build and
  reused across props; the glTF exporter deduplicates them, giving 6 textures
  and 93 geometries at runtime.
* **Shadow frustum follows the vehicle.** A 92 m box tracks the rover instead of
  trying to cover 900 m of world.
* **Quality tiers.** `high` / `balanced` / `low` scale terrain resolution, pixel
  ratio, antialiasing, shadows, and swap in the LOD rover.
* **Adaptive pixel ratio** at mount from `hardwareConcurrency` and
  `devicePixelRatio`, plus drei's `AdaptiveDpr` under load.
* **No per-frame React.** See §2c.

## 7. Testing

`tests/scene.spec.ts` - behaviour, run against a production build:

* both pages render, no console errors, `SCENE PREVIEW` present
* the `.glb` assets are actually requested and return 200
* transport advances and resets; cameras, overlays and modes switch
* determinism: forwards and backwards sampling agree
* rig integrity: all four wheels, both steering pivots, body, glass and sensor
  assembly survive export, and the expected material names are present
* wheel angle equals `distance / 0.405 m` and steering actually varies

`tests/evidence.spec.ts` - captures the inspection set at deterministic
timestamps into `tests/output/evidence/`.

Three viewport projects (1920×1080, 1440×900, 1280×720) plus a `gpu` project
that runs on real hardware so the frame-rate figure in `PROGRESS.md` is a
measurement rather than a software-rasteriser artefact.

## 8. Phase 2 and 3 seams

* **Phase 2 did exactly this**: `EngineSceneStateSource`
  (`packages/scene/src/engine/engineSource.ts`) implements `SceneStateSource`
  from a buffer of engine events, and `SceneRuntimeProvider` takes it as its
  `source`. **No scene component changed.** The optional `rssiDbm`, `latencyMs`,
  `jitterMs`, `lossPct` and `throughputMbps` fields are now populated - each
  guarded on its own presence, so a link with no RSSI omits the field entirely
  rather than reporting `undefined`.
* **Phase 3** drives `clock.setTime(t)` in fixed steps and reads
  `CaptureFrameRequest`. The canvas is created with `preserveDrawingBuffer: true`
  so frames can be read back, and `window.__CONTINUA__` exposes the clock,
  source, settings and live renderer state.


---

# Phase 2 architecture

## 10. The pipeline

```
scenario spec (JSON, immutable)
        │
        ▼
exogenous trace          ← seeded once per (scenario, seed); policy-independent
        │
        ▼
network adapter          ← LinkPath: queue, capacity, delay, jitter, loss
        │
        ▼
traffic generators  ──►  receivers (dedupe, deadlines, freshness, frames)
        │                        │
        │                        ▼
        │                  observations         ← windowed, from receiver facts only
        │                        │
        │                        ▼
        │                    predictor          ← heuristic | learned | none
        │                        │
        │                        ▼
        └──────────────►  policy controller     ← Observe→Predict→Prepare→Steer→Explain
                                 │
                                 ▼
                             actions
                                 │
                                 ▼
                           event store          ← JSONL + SQLite
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
              dashboard (WS)              replay
```

The one-way arrows matter. The controller sits downstream of observations and
has no path back to the trace.

## 11. Authoritative clock

`Simulation` owns the only clock. `RunSession` advances it in real time at
`speed`; the frontend renders whatever the session publishes and may interpolate
**vehicle motion only**. Metrics are taken verbatim from events.

Seeking a live run **rebuilds the simulation from the same seed and
fast-forwards**. That is exact, not approximate, because the simulation is
deterministic - which is also why replay can be asserted equal to the original.

## 12. Boundaries added in Phase 2

| Boundary | Contract |
| --- | --- |
| Engine ↔ frontend | `EngineEvent` (Pydantic) mirrored by `packages/contracts/src/engine.ts`, **validated at the boundary** by `parseEngineEvent`; an unrecognised payload is rejected, not rendered |
| Engine ↔ scene | `EngineSceneStateSource implements SceneStateSource` - the Phase 1 seam, unchanged |
| Controller ↔ world | `LinkObservation` only. No trace access, enforced by test |
| Predictor ↔ controller | `Prediction`, carrying its own features, threshold and calibration flag |
| Simulator ↔ store | `EngineEvent` JSONL + `manifest.json` with scenario, seed, commit and environment |

## 13. Transport and resilience

WebSocket at `/ws/runs/{run_id}`. Every event carries a monotonic `seq`. The
client drops duplicates by `seq`, counts gaps and reports them, inserts
out-of-order events at the right point in the timeline, and reconnects with
bounded exponential backoff (1 s → 15 s). If nothing arrives for 4 s the UI marks
the data **stale**; if the socket closes it says **disconnected**. It never
extrapolates and never substitutes generated numbers.
