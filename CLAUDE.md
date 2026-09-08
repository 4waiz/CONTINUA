# CONTINUA — project rules

**CONTINUA — Predictive Network Continuity**, by Team Kanban.
*The network changes. The session doesn't.*

Repository: <https://github.com/4waiz/CONTINUA>

An unarmed emergency-response / industrial-inspection rover drives from a wired
docking facility, through Wi-Fi and cellular coverage, into a remote
satellite-served environment. CONTINUA visualises that journey and — from
Phase 2 — the predictive network handoffs that keep its session alive.

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Vehicle, world, route animation, scene components, design system, `/scene-lab` | this phase |
| 2 | Predictive network engine, real link/handoff logic, live scene-state feed | not started |
| 3 | Competition video capture and edit | not started |

---

## 1. Hard rules

1. **Never** present decorative values as measured network performance. Until
   the Phase 2 engine exists, the HUD says `SCENE PREVIEW` and numbers are
   labelled illustrative. The reference dashboard's `-67 dBm`, `24 ms`,
   `99.99%` are *design content*, not achieved results.
2. **Only the coordinating agent runs Git.** Sub-agents never commit, push,
   branch, stash or reset.
3. **Only one process drives Blender at a time.** Generation runs headless
   through `scripts/run-blender.mjs`; it never mutates a user's open session.
4. **Never force-push, reset, or rewrite history.** On divergence or auth
   failure, preserve local work and report.
5. **Never commit secrets**, `.env` files, private MCP settings, dependencies,
   caches, render frames or Blender backups. `.env.example` is the only
   credential-shaped file that may be tracked.
6. Do not invent tool calls, file paths, benchmark numbers or successful
   operations. Measure, or say it was not measured.

---

## 2. Checkpoint policy (all phases)

A session-scoped supervisor commits and pushes **completed, project-owned,
explicitly-marked** work every **300 seconds**.

### Commands

```bash
python scripts/checkpoint.py ready <path>...   # mark completed work checkpointable
python scripts/checkpoint.py start             # background supervisor, 300s
python scripts/checkpoint.py once -m "msg"     # immediate checkpoint
python scripts/checkpoint.py status            # incl. LAST SUCCESSFUL PUSH + remote SHA
python scripts/checkpoint.py pause --reason "blender export"
python scripts/checkpoint.py resume
python scripts/checkpoint.py stop              # at phase completion
```

### Guarantees

* **Ready set, not `git add .`.** Only paths the coordinating agent has marked
  ready are staged (`.checkpoint/ready.json`). Work in progress is never
  swept in.
* **One Git operation at a time.** `.checkpoint/git.lock` is an atomic
  `O_EXCL` lock shared by the agent and the supervisor. Wrap asset exports and
  bulk edits in `pause` / `resume`.
* **Refuses unsafe moments.** Skips while a merge, rebase, cherry-pick, revert
  or bisect is in progress, or while another Git process holds `index.lock`.
* **Content gates before commit.** Merge-conflict markers, trailing-whitespace
  warnings, a narrow secret scan (GitHub / AWS / Google / Slack / OpenAI /
  Anthropic tokens, private-key blocks, hardcoded credential assignments), and
  file-size limits — warn at 5 MB, refuse above 45 MB unless Git LFS tracks
  the file. On failure it unstages and leaves the working tree untouched.
* **Branch safety.** Works on `continua/build`, or an already-established
  development branch if one is checked out. `main` and `master` are protected:
  the supervisor switches away rather than committing to them.
* **Push verification.** After pushing it runs `git ls-remote` and records the
  remote SHA. `status` shows the last *verified* push, not the last attempt.
* **Bounded backoff.** Four retries (4s → 32s) for transient network errors
  only. Authentication failure and non-fast-forward divergence stop
  immediately, preserve everything, and report.
* **Honest logging.** Every attempt is logged as OK / SKIP / ERROR with a
  timestamp. A machine asleep, offline, or with nothing ready produces skipped
  attempts — never a fabricated five-minute cadence.
* **The log cannot feed itself.** All supervisor state lives in `.checkpoint/`,
  which is git-ignored, so a checkpoint can never be caused by logging the
  previous checkpoint.

### Large files

Check size before the first commit that contains a binary. Git LFS is
available; if a deliverable is genuinely large, track it with LFS, commit, then
verify the upload with `git lfs ls-files` and a fresh-clone smoke check — a
committed pointer file is not proof of an uploaded object. **Never silently
omit an oversized deliverable**: if it cannot be pushed, say so explicitly.

---

## 3. Layout

```
apps/web/            Next.js 16 App Router frontend (the only runnable app)
packages/scene/      Reusable CONTINUA 3D scene: clock, route, terrain, rig, cameras
packages/contracts/  Framework-free shared types (scene-state adapter for Phase 2)
assets/blender/      .blend sources (editable)
assets/reference/    Reference imagery
assets/previews/     Rendered previews and browser evidence
scripts/blender/     Reproducible Blender generation + export scripts
scripts/             checkpoint.py, run-blender.mjs
docs/                Design spec, architecture, asset manifest, progress, handoff
tests/               Playwright smoke tests
```

npm workspaces only — no Turborepo/Nx. `packages/*` are TypeScript source
packages consumed through `transpilePackages`.

---

## 4. Visual direction

Light mode. Not cyberpunk.

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#F7FAFF` | page ground |
| `surface` | `#FFFFFF` | panels |
| `text` | `#14213D` | headings, body |
| `muted` | `#667593` | secondary labels |
| `cyan` | `#12B9E8` | wired / Wi-Fi accent |
| `blue` | `#176BFF` | primary accent, 5G |
| `violet` | `#7C3CFF` | satellite accent |

Spacious rounded panels, hairline borders, restrained shadows, soft daylight,
pale terrain. **Banned:** heavy bloom, giant floating labels, random particles,
neon spaghetti, illegible glass panels, decorative fake metrics.

Three concepts stay visually distinct and must never be merged:

1. **Route** — where the vehicle physically drives.
2. **Coverage** — where a network is *available* (optional overlay).
3. **Active link** — the one connection currently carrying the session.

The four access networks are **alternative links to a gateway**, not a chain
packets traverse in sequence. Wired is drawn **only while docked or tethered**.

---

## 5. 3D conventions

* Metres. Blender is Z-up; the exported glTF is **Y-up** (glTF standard).
* Vehicle forward is **+X in Blender**, which becomes **+X** in the runtime
  after the Z-up→Y-up conversion. Documented in `docs/ASSET_MANIFEST.md`.
* Vehicle root sits at the ground contact plane (`y = 0` at tyre contact).
* Named objects, not `Cube.001`: `CONTINUA_Body`, `CONTINUA_Wheel_FL`, …
* Steering pivots are empty parents of the front wheels so steer and spin are
  independent transforms.
* Export-compatible PBR only (Principled BSDF). Bake anything procedural.
* Budget: ~30k–80k triangles for the hero vehicle. A budget is not a licence
  to delete the detail that makes it believable.
* **A good Blender render is not proof of a good export.** Every asset is
  re-inspected in the browser for materials, pivots, scale and orientation.

---

## 6. Determinism

`packages/scene/src/clock.ts` owns simulation time. `setTime(t)` fully
determines vehicle pose, wheel angle, steering and camera. Nothing reads
`Date.now()` for scene state. The same `t` must always produce the same frame —
this is what makes Phase 3 video capture reproducible.

Animation runs inside `useFrame` mutating refs. React state is **not** updated
per frame; HUD readouts are throttled.

---

## 7. Definition of done for a change

```bash
npm run lint         # eslint, zero warnings
npm run typecheck    # tsc project references
npm run build        # production build
npm run test:smoke   # Playwright: boots, renders, no console errors
```

Then look at it in a browser at 1920×1080, 1440×900 and 1280×720 before
calling it finished.
