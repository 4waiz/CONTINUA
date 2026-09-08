# CONTINUA — progress

**Phase 1 — vehicle, world and visual foundation.** Complete.

## Launch

```bash
npm install
npm run build
npm run start
```

Then open **<http://localhost:3000>** (dashboard) or
**<http://localhost:3000/scene-lab>** (scene lab).

`npm run dev` works too; the smoke tests deliberately run against the production
build.

## Done

### Toolchain and workflow
- npm workspaces: `apps/web`, `packages/scene`, `packages/contracts`. Exact
  version pins, `package-lock.json` committed.
- `scripts/checkpoint.py` — ready-set staging, atomic Git lock, pause/resume,
  merge/rebase refusal, conflict-marker + secret + file-size gates, bounded
  push backoff, remote SHA verification, honest OK/SKIP/ERROR logging outside
  tracked content.
- `scripts/run-blender.mjs` — headless Blender runner that never touches an
  interactive session.

### Vehicle
- `CONTINUA Rover Mk1`: 38,120 triangles, generated entirely by script.
- Shaped body silhouette with wheel-arch cutouts, two-tone lower cladding,
  greenhouse with A/B/C/D pillars, tinted glazing, **a real interior** (floor,
  headliner, dash, steering wheel, four seats with headrests, cargo module,
  console screen).
- Swept arch flares, bumpers with winch plate and tow hooks, rock sliders,
  door handles and shut lines, mirrors.
- Round headlamps with bezel, reflector and proud lens; amber indicators;
  recessed tail lamps.
- Roof sensor rack: LiDAR, forward camera pod, satcom dome, GNSS puck, two whip
  antennas, light bar, two beacons.
- Wheels: revolved tyre with two offset tread rows and shoulder lugs, 6-spoke
  alloy, brake disc and caliper. Independent steering pivots and spin transforms.
- Small `CONTINUA` / `INSPECTION UNIT 04` identification on both flanks and the
  tailgate. No manufacturer badging.
- Hero `.glb` 1.39 MB, LOD1 16,784 tris / 549 KB, six studio renders.

### World
- 917 m route through four zones: command facility → courtyard → industrial
  corridor → remote sector. Catmull-Rom, resampled every 1 m by arc length.
- Terrain whose `height(x, z)` is the single authority, with the route corridor
  flattened into it so the road sits *on* the ground.
- Road ribbon, shoulder, centre line, facility apron and terminus pad, all
  generated from the same samples and elevation.
- 13 authored props: facility, hangar, dock, three Wi-Fi masts, 5G lattice
  tower, satellite ground terminal, containers, light poles, barriers, signs,
  three boulder variants.
- Deterministic scatter; repeated props instanced.
- Survey wireframe on the surface, low-poly ridge silhouettes, fog.

### Scene runtime
- `SceneClock` with `setTime`, play/pause/reset, speed, loop.
- `PreviewSceneStateSource` — pure `sampleAt(t)`, handoffs planned in one
  forward pass, so scrubbing and playback agree exactly.
- Wheel rotation from travelled distance, Ackermann steering from route
  curvature, body pitch/roll from the terrain normal, restrained suspension
  trim from acceleration and lateral load.
- Four deterministic cameras: follow, overview, close-up, turntable. Clamped
  above the terrain, no springs, no jitter.
- Coverage overlays, active/pre-warming link beams, selectable site markers.

### Application
- `/` — dashboard in the reference's light-mode composition, with the live
  scene as its centrepiece and the four networks drawn as a **fan converging on
  one gateway**, not a chain.
- `/scene-lab` — mode, camera, quality, overlays, transport, timeline with
  handoff markers, keyboard shortcuts, site inspector.
- Explicit loading, WebGL-unavailable, context-lost and render-error states.
- `SCENE PREVIEW` badge everywhere a figure is shown.

## Measured results

### Rendering performance

| Configuration | Result |
| --- | --- |
| **Real GPU** — Chrome (channel `chrome`), 1920×1080, `high` quality, uncapped rAF | **233.8 fps** (4.0 s sample) |
| Hardware | ANGLE / Intel(R) Graphics `0x00007D67`, Direct3D 11, integrated |
| Headless SwiftShader (default CI project) | 3.4–4.2 fps — software rasterisation, expected |

Measured with `npm run test:perf`, which drives the real clock and counts
`requestAnimationFrame` callbacks over four seconds. The frame rate is uncapped
because headless Chrome does not vsync; the useful reading is that a frame costs
~4.3 ms on integrated graphics, i.e. comfortably inside a 16.7 ms budget for
60 fps with a wide margin on discrete hardware.

The `low` quality tier additionally drops to the LOD rover, disables shadows and
antialiasing, and caps pixel ratio at 1.0.

### Scene budget (1920×1080, `high`, follow camera)

| Metric | Value |
| --- | --- |
| Draw calls | 131 |
| Triangles submitted | 285,890 |
| Geometries | 93 |
| Textures | 6 (environment map only) |
| Runtime asset download | 2.28 MB total |

### Verification

`npm run lint` · `npm run typecheck` · `npm run build` all clean.

`npm run test:smoke` — **11 passed** across 1920×1080, 1440×900 and 1280×720:

- both pages render with no console errors
- `.glb` assets requested and served 200
- transport advances, resets; cameras, overlays and modes switch
- **determinism**: forwards and backwards sampling of `sampleAt` are equal
- **rig integrity**: four wheels, two steering pivots, body, glass and sensor
  assembly all present after export; `CONTINUA_Paint_White`, `CONTINUA_Glass_Tint`
  and `CONTINUA_Rubber` materials present
- wheel angle equals `distance / 0.405 m`; steering varies with curvature
- frames are genuinely produced

### Planned handoff sequence (preview model)

| t | from → to |
| --- | --- |
| 0.0 s | — → wired (docked) |
| 9.7 s | wired → Wi-Fi |
| 41.6 s | Wi-Fi → 5G |
| 71.9 s | 5G → satellite |

Run duration 100.1 s over 917 m.

## Defects found and fixed during this phase

Recorded because each was invisible in a Blender render and only showed up under
inspection:

1. **Front wheels 1.4 m out of position.** `matrix_parent_inverse =
   parent.matrix_world.inverted()` reads a stale matrix in background Blender,
   doubling the offset. Now parented with an explicit local transform.
2. **Every road ribbon invisible.** The triangle winding produced a −Y normal, so
   the carriageway, shoulder and apron were all back-face culled. Reversed.
3. **Mirrored identification text.** Viewed from the +Y flank the nose is on the
   observer's left, so that side must read along −X.
4. **Headlamp lenses rendered as dark discs** — an opaque chrome ring sat in
   front of them.
5. **Hollow glass cabin** you could see straight through. Fixed by modelling an
   interior whose seat backs rise above the beltline.
6. **HUD panels frozen on their first value.** `useSyncExternalStore` cannot
   observe a ref mutated inside `useFrame`; replaced with an interval + state.
7. **Checkpoint supervisor died on launch**, silently. `--branch` was passed
   after the subcommand, which argparse rejects; the parent had already printed
   "started". Now the argument order is correct and start verifies liveness.
8. **Mission began on satellite instead of wired** — the dock stood 27 m from the
   route origin, outside tether range.
9. **Ridge silhouettes cut through the terrain** as a grey band; moved beyond the
   terrain bounds.
10. **`.env.example` refused by the secret-path guard** — a naive `.env` prefix
    match. Now exact-name and directory-prefix matching.

## Not done in Phase 1 (by design)

- The predictive network engine. Everything network-related is a geometric
  preview and is labelled as such.
- Real measurements: `rssiDbm`, `latencyMs`, `jitterMs`, `lossPct`,
  `throughputMbps` exist in the contract and are deliberately `undefined`.
- Video capture and edit (Phase 3). The seams exist: deterministic clock,
  `preserveDrawingBuffer`, `CaptureFrameRequest`.
- Mobile/touch layout. The app is responsive down to 1280×720; below that it
  reflows but has not been designed.
- Dark mode.

## Known limitations

- **Terrain is generated on the main thread at mount** (~29k vertices). It costs
  roughly 150–250 ms of the initial load. A worker would remove the hitch.
- **The survey wireframe is a single large `LineSegments`** and is not frustum
  culled per-region.
- **`useGLTF` caches per URL**, so switching quality to `low` fetches the LOD
  model on first use rather than pre-loading it.
- **The `gpu` Playwright project needs a locally installed Chrome.** The default
  projects fall back to SwiftShader, where the frame rate figure is meaningless.
- **Satellite coverage is modelled as always-available outdoors.** Real terrain
  masking and elevation angle are Phase 2 concerns.
- **Zone boundaries are derived from route X positions**, so moving control
  points sideways can shift a zone edge.
- Only the light theme exists. The dark reference is recorded, not implemented.
