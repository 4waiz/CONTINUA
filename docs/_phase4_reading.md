## 6. Reading the results

Written against the run above (`test2`, 20 paired trials, commit noted in the
header) and the corrected-ablation supplement in section 5. Every figure
quoted here appears in a table above; where a range is given it spans the
eight scenarios.

### What was asked, and what the data says

**1. Mode handover removes almost all time spent in a mode the control path
cannot support, and pays for it in teleop time.** With control always in
teleop (every policy before P2, and P2-noMode) the control path fails the
teleop criterion for 35–60 s of a 70–105 s run, mostly on the satellite
segment where 620 ms cannot meet 150 ms. P2 cuts that to 2–8 s per run
(`P2 − P2-noMode`: −35 to −54 s, every interval excludes zero). The price is
the strict metric: P2's teleop availability is **6.5–15.3 points lower** than
P2-noMode's and **4.2–14.3 points lower than P1's**, in every scenario, with
every interval excluding zero. The gap is hysteresis: P2 spends 8–18 s per
run held in waypoint or safe hold while the path measurably supported a
higher mode (`conservative_mode_s`), and makes 6–12 mode changes per run.
The per-mode receiver counts show why the headline control miss rate drops
from 31–44 % to about 1 %: the commands that would have missed were sent at
2 Hz with a 1500 ms deadline, or not sent at all. **That drop is not a win and
is not claimed as one.** The same relaxation inflates `app_health_v1` from
about 69 to about 81, because control's attainment term is judged against the
mode's own deadline; the health score is therefore **not comparable** between
policies with and without mode handover, and section 2 should be read on
teleop availability instead.

**2. Per-class steering helps, modestly and consistently, at no cost.** With
control always in teleop (`P2-noMode − P1`) steering raises teleop
availability by **+0.9 to +3.1 points** and lowers unsupported time by
**1.0–3.2 s** in all eight scenarios, with every interval excluding zero,
while cost, satellite bytes, control misses and video stall are unchanged
(video stall is +257 ms worse on `total-loss`, the one interval against it).
It does this by moving control off the primary path onto an active backup
that meets the deadline when the primary does not: 3–7 class steers per run.
With mode handover on (`P2 − P2-noSteer`) the gain is larger, **+2.0 to
+6.8 points** of teleop availability, because a steered control path keeps
the mode machine in teleop where the primary alone would have forced a
downshift. Keeping the second path active cost nothing extra here because
P1 already keeps a backup warm; the bytes steering moves are the same bytes.

**3. Anticipating a mode change does not pay for itself.** On `test2`,
`P2 − P2-reactiveMode` is **negative on teleop availability in every
scenario** (−2.5 to −6.8 points, all intervals excluding zero) and positive on
time held below a supported mode (+3.1 to +5.5 s) and on mode changes (+2.0
to +4.4). That ablation carried the defect described in section 5, so the
number to cite is the corrected comparison on the fresh `test3` block: teleop
availability **−1.8 to −5.5 points** against the reactive arm in all eight
scenarios, every interval excluding zero; 0.7–2.8 s less unsupported time;
2.6–5.9 s more time held below a supported mode; 2.0–4.3 more mode changes.
What anticipation buys is a second or two less in an unsupported mode per run;
what it costs is several times that in teleop time, because a forecast of a
violation that is then met by a 1.0 s upshift hold is a downshift the path
did not need. This matches the Phase 2 finding that prediction does not pay
for the session switch either. The `test2` `total-loss` row (−10.1 s
unsupported, −5.9 points control miss) is the defect, not an anticipation
effect; corrected, that scenario reads −0.7 s.

**4. Most of P1's satellite saving was bulk deferral, and B2-defer is the
cheaper policy.** `B2-defer − B2` removes 43–69 MB of satellite traffic per
run, of which 0.00–0.42 MB is anything other than bulk; cost falls by 2.7–4.2
units; bulk completion falls by 35–51 points and the composite health score
by 1.3–1.8 (it rises 8.8 on `cellular-congestion`, where pausing bulk is what
relieves the cell). Against that baseline, P1's remaining application-aware
saving is **3.0–5.0 MB of non-bulk satellite traffic** (about 43 %) and
**1.6–2.2 s less video stall** per run, and P1 is **0.07–0.82 cost units more
expensive** than B2-defer, because it releases and re-activates the satellite
path where B2-defer keeps every path active and pays no further activation
cost. The Phase 2 headline "1.25 cost units instead of 4.31" stands against
B2; against B2-defer the cost advantage is gone and the remaining advantage is
in bytes and video.

### Where P2 is worse, in words

Section 3 lists every conclusive loss. In words: P2 is worse than every
baseline on teleop availability in seven of eight scenarios (on
`cellular-congestion` the gap to B1 and B2 is inconclusive), worse on mode
changes and on time held below a supported mode everywhere, slightly more
expensive than B2-defer everywhere (+0.07 to +0.81 units), and stalls video
300–700 ms more than P1 on `wifi-degradation`, `sudden-failure`,
`satellite-fallback` and `fast-run`. The last comes from the mode machine, not
from steering: `P2-noMode` matches P1 on video stall.

### What did not change

Session continuity is identical for P1 and P2 in every scenario (same
interruption, same reconnects): class paths never kept a session alive and
never ended one. Satellite bytes and cost units are within 0.2 MB and 0.02
units of P1's. The exogenous trace and the vehicle's motion are identical
between P1 and P2 for every seed, by test.

### What would change the picture

* A lower upshift hold trades mode changes for teleop time; the tuning grid
  shows the slope. Below 1.0 s the grid was not explored.
* The loss limits are the Phase 2 violation definition plus one modelled
  consequence of retransmission. A support rule based on observed control
  deadline outcomes rather than on windowed loss would make "unsupported"
  mean what it says on a bursty link; it was not built because it would
  have required a change to the Phase 2 observation model that the
  regression guard exists to prevent.
* The windowed loss estimate over-reads for a few hundred milliseconds after
  a surge of traffic onto a long-delay path (the new sends have not arrived
  yet). The 0.3 s debounce rides it out; a different estimator would remove
  it at the source, at the cost of changing every Phase 2 number.
