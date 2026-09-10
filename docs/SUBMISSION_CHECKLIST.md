# SUBMISSION_CHECKLIST - CONTINUA, by Team Kanban

Everything a reviewer needs, where it is, and what state it is actually in.
Nothing on this list is marked done from memory: each row names the command or
the file that establishes it.

Repository: <https://github.com/4waiz/CONTINUA>

---

## 1. Deliverables

| File | What it is | Verified by |
| --- | --- | --- |
| `deliverables/CONTINUA_Team_Kanban_Demo.mp4` | The demo video | `node scripts/qa-demo.mjs` (ffprobe: duration, 1920×1080, 30 fps, H.264, yuv420p, AAC, faststart) |
| `deliverables/CONTINUA_Team_Kanban_Demo.srt` | Subtitles, generated from the same cues as the audio | `qa-demo.mjs` parses it and checks timing, overlap and line length |
| `deliverables/CONTINUA_Demo_Poster_1024x576.png` | Poster frame | `qa-demo.mjs` checks the dimensions |
| `deliverables/CONTINUA_Demo_Contact_Sheet.jpg` | One frame from each of the ten shots | Built by `scripts/build-demo.mjs` |
| `video/manifest.json` | What went into the build: run IDs, experiments, commit, capture settings, attribution | Written by `scripts/build-demo.mjs` |

## 2. The claim trail

| Question a reviewer will ask | Where it is answered |
| --- | --- |
| Where does each number in the video come from? | `docs/VIDEO_CLAIMS.md` - every spoken and displayed claim, with its run ID, evidence mode, source file, and implemented / measured / proposed status |
| Which trace is shown, and why that one? | `scripts/select_representative.py` (the rule, fixed before looking at results) and `video/representative.json` (the outcome) |
| Are the numbers on the cards hand-typed? | No. `scripts/build_video_cards.py` extracts them into `apps/web/public/video/cards.json`; the cards render that file and show ` - ` for anything missing |
| Is anything overclaimed? | `node scripts/check-claims.mjs` fails the build on 19 banned phrases and on any claim ID a shot cites that is not declared |
| What is the video *not* evidence of? | `docs/VIDEO_QA.md` § "What this QA does not establish", and the scope card in the video itself |

## 3. Honesty, stated in the video itself

Not in a footnote - spoken and on screen:

- [x] "Everything here is a software simulation. No radios, no satellite, no hardware." - at 6.8 s, before any result
- [x] Every application shot carries a `REPLAY · SIMULATION` chip and the source run ID
- [x] The remaining 0.16 s of interruption is explained as session start-up, in the same breath as the headline
- [x] The paired-comparison card carries a **"Where CONTINUA is worse"** block (more handovers, less bulk completed)
- [x] The results card states the row where CONTINUA loses to the always-multipath baseline
- [x] The ablation card reports that removing the predictor changes nothing measurable
- [x] The scope card states: emulation unverified on this host, no MPTCP, total loss defeats it, one synthetic route
- [x] The learned model is not called calibrated (`calibrated: false` in `docs/MODEL_CARD.md`)

## 4. Reproducing the video

In order, from a clean checkout. The engine and web app must be running for the
capture step (`npm run engine`, `npm run build && npm run start`).

```bash
python scripts/select_representative.py      # choose the trace by the documented rule
python scripts/build_video_cards.py          # extract card data from recorded evidence
node scripts/run-blender.mjs scripts/blender/render_video_shots.py
node scripts/capture-demo.mjs                # deterministic frame capture, ~6 min
node scripts/build-narration.mjs             # local TTS, fitted to the timeline
node scripts/build-demo.mjs                  # composite, encode, poster, contact sheet
node scripts/qa-demo.mjs                     # inspect the finished file
```

`video/frames/`, `video/renders/`, `video/audio/` and `video/work/` are
git-ignored: they are large and fully regenerable from the commands above plus
the recorded runs. The finished MP4, SRT, poster, contact sheet and every
manifest **are** tracked.

## 5. Repository state

| Item | State |
| --- | --- |
| Branch | `continua/build` |
| Secrets, `.env`, private MCP settings | Not tracked. `.env.example` is the only credential-shaped file (`.gitignore`, and the checkpoint supervisor's secret scan) |
| Dependencies, caches, frame sequences, raw renders | Not tracked (`.gitignore`) |
| Run event logs (`data/runs/`) | Not tracked - regenerable from `(scenario, seed, policy)`. The three runs the video cites have their `metrics.json` and `manifest.json` tracked under `data/evidence/video/` |
| Experiment results (`data/experiments/`) | Tracked. This is the evidence |
| Large files | Checked before commit; nothing requires Git LFS |

## 6. Documentation

| File | Covers |
| --- | --- |
| `README.md` | What it is, how to run it |
| `CLAUDE.md` | Project rules, checkpoint policy, experiment discipline |
| `docs/ARCHITECTURE.md` | Boundaries, pipeline, determinism, transport |
| `docs/ASSUMPTIONS.md` | What is modelled and what is not |
| `docs/METRICS.md` | Every metric's definition |
| `docs/EXPERIMENT_METHOD.md` | Paired design, seed blocks, what was tested once |
| `docs/MODEL_CARD.md` | The predictor: data, split, calibration, failure modes |
| `docs/SECURITY.md` | Threat model and what was *not* audited |
| `docs/AI_USE.md` | Where AI was used, including the synthesised narration |
| `docs/VIDEO_CLAIMS.md` | The claim ledger for the video |
| `docs/VIDEO_QA.md` | What was checked in the finished file, and what was not |
| `docs/PHASE_1_HANDOFF.md`, `docs/PHASE_2_HANDOFF.md` | Phase boundaries |

## 7. Not done, and deliberately so

These require the user's decision, and none of them has been taken:

- [ ] **Public deployment** - nothing is deployed anywhere
- [ ] **Publishing the video to YouTube or any other platform** - the MP4 is in the repository only
- [ ] **Changing repository visibility**
- [ ] **Submitting the competition application**

Also not done, because this host cannot:

- [ ] **Emulation run** - `data/emulation_capability.json` records `sudo_nopasswd` missing; the scripts exist and are unverified here
- [ ] **MPTCP** - `CONFIG_MPTCP` unset on this kernel; no run may be described as multipath TCP
- [ ] **Hardware, radio or field trial** - future work, spoken in the future tense in the video

## 8. Before submitting

1. `node scripts/qa-demo.mjs` - must exit zero.
2. Watch the MP4 end to end, with sound, at full screen.
3. Read `docs/VIDEO_CLAIMS.md` §3 and confirm nothing in the final cut breaks it.
4. `python scripts/checkpoint.py status` - confirm the last **verified** push, not the last attempt.
5. `git status` - clean, and the deliverables are tracked.
