# CONTINUA — Phase 1 → Phase 2 handoff

Everything Phase 2 needs to attach a real predictive network engine without
touching the 3D scene.

## 1. Where to plug in

One interface, in `packages/contracts/src/index.ts`:

```ts
export interface SceneStateSource {
  readonly kind: 'preview' | 'engine';
  readonly runId: string;
  readonly duration: Seconds;
  sampleAt(simTime: Seconds): SceneState;
  subscribe?(listener: (state: SceneState) => void): () => void;
}
```

Implement it, then pass it in:

```tsx
<SceneRuntimeProvider source={myEngineSource}>
  <SceneLab />
</SceneRuntimeProvider>
```

That is the whole integration. `SceneRuntimeProvider` already takes a `source`
prop and defaults to `previewSource`. No component in `packages/scene` refers to
`PreviewSceneStateSource` except the default argument and the timeline's handoff
markers (which feature-detect it with `instanceof`).

### What the scene reads from `SceneState`

| Field | Consumed by | Required? |
| --- | --- | --- |
| `vehicle.position` / `heading` / `pitch` / `roll` | `Rover`, all cameras, `Lighting` shadow target | **yes** |
| `vehicle.distance` | Wheel rotation, camera anchoring, HUD | **yes** |
| `vehicle.wheelAngle` | Wheel spin — must equal `distance / 0.405` | **yes** |
| `vehicle.steerAngle` | Front-wheel steering, suspension roll | **yes** |
| `vehicle.speedMps` | Suspension trim, HUD | **yes** |
| `links[network].state` | Link beams, panels, the link fan | **yes** |
| `links[network].coverage` | Coverage bars, beam visibility | **yes** |
| `links.wired.tethered` | Whether the wired tether is drawn at all | **yes** |
| `active` / `warming` / `degraded` | Beam selection, chips | **yes** |
| `zone` | Zone list, timeline caption | yes |
| `traffic.*`, `latestDecision` | HUD panels only | optional |
| `links[*].rssiDbm`, `latencyMs`, `jitterMs`, `lossPct`, `throughputMbps` | **Nothing yet** — reserved for you | optional |

### The one rule that must survive

`sampleAt(t)` must be **pure**: the same `t` must always produce an equal state.
A live engine will want to stream, so the recommended pattern is *record then
replay*: buffer engine events, and have `sampleAt` interpolate the buffered
timeline rather than return "whatever arrived last". Phase 3 video capture
depends on this, and a browser test asserts it.

If a genuinely live, non-reproducible mode is needed, add
`kind: 'engine'` + `subscribe()` and let the HUD show it as live. Do not make
`sampleAt` non-deterministic.

## 2. Honesty contract

`SceneState.source` drives the badge in `apps/web/src/components/ui/primitives.tsx`:

* `'preview'` → amber **SCENE PREVIEW** chip, and copy stating that figures are a
  geometric preview.
* `'engine'` → green **LIVE ENGINE** chip.

When you switch to `'engine'`, you also take on the obligation that every number
displayed is measured. The dashboard currently shows only quantities Phase 1 can
honestly produce — coverage, progress, handoff count, speed, heading. Add dBm /
ms / % panels **only** once the corresponding optional fields are populated by
real measurement, and remove the "illustrative" qualifiers at the same time.

`docs/DESIGN_SPEC.md` §2 explains why the reference mock's numbers were not
reproduced.

## 3. Where the coverage model lives

`packages/scene/src/world/sites.ts`:

* `SITES` — the infrastructure list. Each entry carries `network`, world `x`/`z`,
  `yaw`, `linkHeight` (where a beam attaches), and inspector copy.
* `coverageAt(network, x, z)` — the geometric model. **Replace this** with your
  propagation model, or leave it and let the engine override `LinkStatus`
  directly.
* `NETWORK_PRIORITY`, `USABLE_COVERAGE` — the selection policy.

The handoff planner is `PreviewSceneStateSource.planHandoffs()`. It is a single
forward pass with enter/exit thresholds; your engine will replace it entirely.

Adding a site is a data edit: append to `SITES` and, if it needs new geometry,
add a `prop_*` function in `scripts/blender/build_props.py`.

## 4. Where the world lives

| Thing | File | Notes |
| --- | --- | --- |
| Route control points | `packages/scene/src/world/route.ts` | 24 points, world XZ. Edit and everything downstream follows |
| Terrain | `world/terrain.ts` | `height(x, z)` is the authority. Do not add a second elevation source |
| Road ribbons | `world/road.ts` | Winding must stay counter-clockwise from above |
| Zones | `world/sites.ts` | Derived from route X thresholds |
| Design tokens | `packages/scene/src/theme.ts` | Mirrored in `globals.css` |

Changing the route changes the length, the duration, the zone boundaries and the
handoff plan automatically — all of them read from the same samples.

## 5. Debug and capture handle

`window.__CONTINUA__` is published by `SceneRuntimeProvider` and
`ContinuaScene`:

```ts
{
  clock,          // SceneClock: setTime, play, pause, reset, duration, time
  source,         // the active SceneStateSource
  settings,       // { get(), set(patch), subscribe(fn) }
  getFrame(),     // the SceneState published for the current frame
  three,          // { scene, gl, camera } — the live renderer
  version: 'phase-1',
}
```

`tests/evidence.spec.ts` shows the pattern Phase 3 should use: pause the clock,
patch settings, `setTime(t)`, wait a beat, capture.

The canvas is created with `preserveDrawingBuffer: true` so frames can be read
back with `readPixels` or `toBlob`.

## 6. Suggested Phase 2 order of work

1. **Record/replay harness first.** Get a buffered engine timeline behind
   `sampleAt` before anything else, so determinism never regresses.
2. **`LinkStatus` measurements.** Populate `rssiDbm`, `latencyMs`, `jitterMs`,
   `lossPct`, `throughputMbps`. Add the corresponding dashboard panels — this is
   where the reference's left rail and telemetry chart finally become truthful.
3. **The five-stage pipeline.** `assets/reference/continua-pipeline-5stage.png`
   (Observe → Predict → Prepare → Steer → Explain) maps onto `DecisionKind`,
   which already has those five values. `Decision.confidence` and
   `Decision.reason` are rendered in the decision log today.
4. **Real propagation.** Replace `coverageAt` with terrain-aware path loss;
   `terrain.height` gives you the profile between any two points.
5. **Degradation and duplication.** `LinkState` already has `degraded`, and the
   contract's comment allows two links briefly during a duplicated handoff — the
   beam renderer will draw both without changes.

## 7. What not to change

* **Determinism.** See §1.
* **The fan, not the chain.** `LinkFan.tsx` deliberately departs from the
  reference. Do not "fix" it back into a sequence.
* **Wired only while tethered.** `links.wired.tethered` gates the tether beam and
  the wired node in the fan.
* **No per-frame React state.** `SceneDriver` publishes to a ref; HUD panels poll.
  Introducing a per-frame `setState` will cost roughly an order of magnitude of
  frame rate.
* **The React Compiler lint exemption** in `eslint.config.mjs` is scoped to
  `packages/scene/**` and explained inline. Do not widen it to `apps/web`.

## 8. Running it

```bash
npm install
npm run build && npm run start     # http://localhost:3000
npm run lint && npm run typecheck  # both must be clean
npm run test:smoke                 # 11 tests, three viewports
npm run test:perf                  # real-GPU frame rate (needs local Chrome)
npm run blender:all                # regenerate every asset from source
```

Checkpoint workflow (all phases) is documented in `CLAUDE.md` §2. Restart it for
Phase 2 with:

```bash
python scripts/checkpoint.py start
```

## 9. State at handoff

* Branch **`continua/build`**, pushed to <https://github.com/4waiz/CONTINUA>.
* Phase 1 is complete; `docs/PROGRESS.md` records measured results, the ten
  defects found and fixed, and the known limitations.
