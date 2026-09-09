# Narration — CONTINUA demo video

271 words, 109.5 seconds. Spoken slowly on purpose: the video is dense with
numbers and the viewer needs room between them.

The first draft of this script did not fit. Every line was synthesised and
measured, and eight of the fourteen ran past their window even at the fastest
speaking rate the project is willing to use — about 3.6 words per second, which
is not a pace anyone can follow through a run of decimals. So the lines below
are the second draft: shorter sentences, and three of the caption cards held
longer to make room. `scripts/build-narration.mjs` re-measures on every build
and **fails** rather than letting audio drift out of sync with the picture.

**Voice:** synthesised locally with the Windows speech API (`System.Speech`,
Microsoft David Desktop, en-US). No voice was cloned, no real person was
imitated, nothing was uploaded to an external service, and no paid API was
used. See `docs/AI_USE.md`.

**The text below is the authority.** `video/timeline.json` carries the same
lines with their cue times; `scripts/build-narration.mjs` synthesises from the
JSON and generates the `.srt` from the same entries, so the subtitle and the
audio can never drift apart. `scripts/check-claims.mjs` asserts that this file
and the timeline hold the same sentences, and fails the build if they diverge.

---

### N1 · 0.6 → 6.3 — open

> A response vehicle drives out of coverage. The network changes. The session
> should not have to.

### N2 · 6.8 → 12.5 — what this is

> Everything here is a software simulation. No radios, no satellite, no
> hardware.

*Said before any result appears. Non-negotiable — see `docs/VIDEO_CLAIMS.md` §4.*

### N3 · 12.9 → 20.3 — the problem

> The reactive baseline waits for its link to fail. Here the session goes dark
> four times: seven point three two seconds, one full reconnect.

*`run-7d8750c2b7`, `continuity.total_interruption_s` = 7.32, `interruptions` =
4, `session_reconnects` = 1.*

### N4 · 20.8 → 29.9 — the application

> CONTINUA is the working application around that problem. Every panel reads
> from one engine over a live socket, and the execution mode is always on
> screen.

### N5 · 30.3 → 36.8 — observe

> Five steps. Observe: receiver side facts only. The controller never sees the
> script the world runs from.

*Enforced by `tests/engine/test_engine.py`, not just asserted here.*

### N6 · 37.2 → 41.6 — predict

> Predict: a short horizon on those same facts, three seconds ahead.

### N7 · 41.9 → 46.8 — prepare

> Prepare: at twenty eight point eight seconds it warms cellular while Wi-Fi is
> still carrying.

*`run-d2819d215c`, `start_duplication` at t = 28.76 s.*

### N8 · 46.9 → 52.4 — steer and explain

> Steer, six tenths of a second later. Explain: it records why, as it decided.

*`switch` at t = 29.42 s. Recorded reason: "Moved the session from wifi to
cellular on a measured violation: RTT 13 ms, loss 3.0 %."*

### N9 · 52.6 → 61.9 — the paired comparison

> Same seed, same trace, only the policy changed. Seven point three two seconds
> of interruption becomes zero point one six, and that remainder is the session
> starting up.

### N10 · 62.6 → 71.8 — the constrained route

> On the satellite route it holds the session through the fallback, and spends
> four point eight megabytes of satellite where the baseline spends forty seven.

### N11 · 72.6 → 82.2 — the result we did not want

> Twenty paired trials say something we did not expect. Preparation is what
> removes the interruption. Take the predictor out and almost nothing changes.

*`exp-26f132d5d7`: B2 and P1 both reach 0.16 s; `P1-noPred` matches `P1` on
every continuity and application metric.*

### N12 · 83.0 → 92.2 — what it does add, and what it costs

> What CONTINUA adds is the price: the same continuity at a third of the cost, a
> twelfth of the satellite data. It loses on application health.

*P1 1.25 cost units vs B2 4.31; 4.78 MB vs 61.20 MB; app health 68.8 vs 70.3.
The loss is spoken, not buried.*

### N13 · 92.6 → 103.0 — scope

> Scope. A simulation, not a network. Emulation is unverified here and the
> kernel has no MPTCP. When every link is down: ten point six seconds, every
> policy.

### N14 · 103.6 → 108.6 — close

> CONTINUA. Predictive network continuity. By Team Kanban.

---

## Words deliberately not used

`99.99 %`, `zero downtime`, `guaranteed`, `works everywhere`, `live satellite`,
`field test`, `5G`, `MPTCP` (except in N13, where it is named as unavailable),
`production-ready`, `real-time network`, `AI decides`. The list is enforced by
`scripts/check-claims.mjs` and the reasons are in `docs/VIDEO_CLAIMS.md` §3.
