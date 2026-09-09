# Narration — CONTINUA demo video

252 words, 116 seconds. Spoken slowly on purpose: the video is dense with
numbers and the viewer needs room between them.

## How this script got shorter twice

**First draft.** Eight of the fourteen lines ran past their cue window even at
the fastest speaking rate — about 3.6 words a second — so the lines were cut and
three caption cards were held longer.

**Second draft.** It fitted, and it sounded terrible: almost every line was
being read at the speech API's top rate with no pauses between sentences. A
technical script full of decimals read that fast is not narration, it is a
screen reader. So three things changed at once:

* the synthesiser now emits **SSML** with a pause after every sentence and a
  shorter one after every comma, and takes a percentage speaking rate instead
  of the API's coarse integer steps;
* the build **refuses anything above +18 %**, where before it would happily
  ship the maximum;
* the picture made room — shot S4 grew from 22 s to 26 s and each of the four
  caption cards gained a second, which is where the extra runtime went.

`scripts/build-narration.mjs` re-measures every line on every build and fails
rather than letting audio drift out of sync with the picture.

**Voice:** synthesised locally through `Windows.Media.SpeechSynthesis`
(OneCore, "Microsoft Mark", en-US). No voice was cloned, no real person was
imitated, nothing was uploaded to an external service, and no paid API was
used. See `docs/AI_USE.md`.

**The text below is the authority.** `video/timeline.json` carries the same
lines with their cue times; the `.srt` is generated from those same entries, so
the subtitle and the audio cannot drift apart. `scripts/check-claims.mjs`
asserts that this file and the timeline hold the same sentences, and fails the
build if they diverge — which it did, the first time this file was edited and
the timeline was not.

---

### N1 · 0.6 → 6.3 — open

> A response vehicle drives out of coverage. The network changes; the session
> should not.

### N2 · 6.8 → 12.6 — what this is

> Everything here is a software simulation. No radios, no satellite, no
> hardware.

*Said before any result appears. Non-negotiable — see `docs/VIDEO_CLAIMS.md` §4.*

### N3 · 13.0 → 20.4 — the problem

> The reactive baseline waits for its link to fail. The session goes dark four
> times: seven point three two seconds.

*`run-7d8750c2b7`, `continuity.total_interruption_s` = 7.32, `interruptions` =
4, `session_reconnects` = 1.*

### N4 · 20.9 → 30.0 — the application

> CONTINUA is the working application around that problem. Every panel reads
> from one engine over a live socket, and the execution mode is always on
> screen.

### N5 · 30.4 → 37.8 — observe

> Five steps. Observe: receiver side facts only. The controller never sees the
> world's script.

*Enforced by `tests/engine/test_engine.py`, not just asserted here.*

### N6 · 38.1 → 42.6 — predict

> Predict: a short horizon on those same facts, three seconds ahead.

### N7 · 42.9 → 50.0 — prepare and steer

> Prepare: it warms cellular while Wi-Fi still carries. Steer: six tenths of a
> second later.

*`run-d2819d215c`: `start_duplication` at t = 28.76 s, `switch` at t = 29.42 s.*

These were two cues in the first cut, and they could not be. The two events are
0.66 s apart in the run; giving each its own line would have meant playing that
stretch at roughly 0.13×, slow enough that the vehicle moves less than a pixel
between frames and the shot reads as frozen. At 0.36× — the slowest rate that
still moves — they are 1.8 s apart on screen, which is one sentence, not two.
The exact timestamps stay on the step captions, where they are readable without
being spoken.

### N8 · 50.3 → 55.7 — explain

> Explain: it records why, at the moment it decided.

*Recorded reason at `switch`: "Moved the session from wifi to cellular on a
measured violation: RTT 13 ms, loss 3.0 %."*

### N9 · 56.6 → 66.6 — the paired comparison

> Same seed, same trace, only the policy changed. Seven point three two seconds
> becomes zero point one six, and that remainder is the session starting up.

### N10 · 67.6 → 76.8 — the constrained route

> On the satellite route it holds the session through the fallback, and spends
> four point eight megabytes of satellite where the baseline spends forty seven.

### N11 · 77.6 → 87.6 — the result we did not want

> Twenty paired trials say something we did not expect. Preparation is what
> removes the interruption. Take the predictor out and almost nothing changes.

*`exp-26f132d5d7`: B2 and P1 both reach 0.16 s; `P1-noPred` matches `P1` on
every continuity and application metric.*

### N12 · 88.6 → 97.6 — what it does add, and what it costs

> What CONTINUA adds is the price: the same continuity at a third of the cost, a
> twelfth of the satellite data. It loses on application health.

*P1 1.25 cost units vs B2 4.31; 4.78 MB vs 61.20 MB; app health 68.8 vs 70.3.
The loss is spoken, not buried.*

### N13 · 98.6 → 109.2 — scope

> Scope. A simulation, not a network. Emulation is unverified here and the
> kernel has no MPTCP. Total loss: ten point six seconds, every policy.

### N14 · 110.2 → 115.4 — close

> CONTINUA. Predictive network continuity. By Team Kanban.

---

## Words deliberately not used

`99.99 %`, `zero downtime`, `guaranteed`, `works everywhere`, `live satellite`,
`field test`, `5G`, `MPTCP` (except in N13, where it is named as unavailable),
`production-ready`, `real-time network`, `AI decides`. The list is enforced by
`scripts/check-claims.mjs` and the reasons are in `docs/VIDEO_CLAIMS.md` §3.
