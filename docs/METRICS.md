# CONTINUA - metric definitions

Every metric, its unit, its measurement window and where in the code it is
computed. **All of them are derived from receiver-side facts** - arrivals,
acknowledgements and timeouts - never from what the controller intended.

Implementation: `services/engine/continua_engine/experiments/metrics.py` and
`sim/simulator.py`.

---

## 0. Two rules

1. **A measurement that does not exist is `null`, never `0`.** Zero latency and
   unknown latency are different claims. The dashboard renders `null` as
   "unavailable".
2. **Rendering frame rate is not a network metric.** Scene fps is reported
   separately in `docs/PROGRESS.md` and never mixed into these tables.

---

## 1. Windowed link observations

Computed every simulation step over a trailing window of **2.0 s**
(`link_profiles.json → probing.window_s`), requiring at least **4 samples**
(`probing.min_samples`) before a statistic is published at all.

| Metric | Unit | Definition |
| --- | --- | --- |
| `rtt_ms` | ms | Arithmetic mean of round-trip samples in the window. A sample exists only when an acknowledgement returns for a control packet or a probe. Below `min_samples` → `null` |
| `jitter_ms` | ms | Mean absolute deviation of those same RTT samples from their mean. Not an IPDV/RFC 3550 estimator |
| `loss_pct` | % | `100 × (sent − delivered) ÷ sent` on that link over the window. `sent` counts every transmission attempt including tail-dropped packets, duplicates, retransmissions and probes. Below `min_samples` sends → `null` |
| `throughput_mbps` | Mbps | Bytes delivered from that link in the window × 8 ÷ window ÷ 1e6 |
| `rssi_dbm` | dBm | **Wi-Fi only.** Linear map from modelled coverage: −92 dBm at coverage 0 → −46 dBm at coverage 1. Every other link reports `null` |
| `modelled_coverage` | 0–1 | Geometric coverage from `world.json`. **Not a measurement** |
| `queue_depth_bytes` | B | Current bytes queued on that path |
| `capacity_mbps` | Mbps | Instantaneous capacity after quality and background contention. `null` when the link is unusable |

**Non-carrying paths are probed** at 5 Hz with 96-byte acknowledged packets so a
backup has genuine measurements rather than an assumed value. Probe bytes count
toward `link_bytes` and toward loss statistics - the overhead is not hidden.

---

## 2. Per-class application metrics

Windowed values use the same 2.0 s window; run totals use the whole run.

| Metric | Unit | Definition |
| --- | --- | --- |
| `sent` | count | Packets the application generated (including during an outage) |
| `delivered` | count | Distinct packets delivered to the application after deduplication |
| `duplicates_suppressed` | count | Copies discarded by the receiver because that sequence number had already been delivered |
| `deadline_miss_pct` | % | `100 × misses ÷ eligible`. A packet is *eligible* if it has a deadline; it *misses* if it arrives after `created_t + deadline`, or if it never arrives. Packets generated while no path exists are counted as eligible **and** missed |
| `p50/p95/p99_latency_ms` | ms | Order statistics of one-way latency (`arrival − created`) over delivered packets |
| `freshness_ms` | ms | **Telemetry only.** `now − arrival time of the newest sample the receiver holds` |
| `stall_ms` | ms | **Video only.** Cumulative time with no decodable frame newer than 200 ms |
| `stalled_now` | bool | **Video only.** Whether the stream is stalled at this instant |
| `frames_delivered / frames_expected` | count | **Video only.** A frame counts as delivered only if **every** one of its packets arrived before the frame deadline |
| `bytes_completed` | B | **Bulk only.** Bytes that reached the receiver |
| `goodput_mbps` | Mbps | Useful application bytes ÷ elapsed. Excludes duplicates, retransmissions and probes |

### One-way latency and clocks

Latency is computed as `arrival_time − creation_time` **inside a single
simulated clock**. This is legitimate here because there is exactly one
authoritative clock in the simulator. It would **not** be legitimate in
emulation across two hosts without clock synchronisation; the emulation adapter
therefore reports RTT, not one-way delay.

---

## 3. `app_health_v1`

The replacement for the reference mock's unexplained "96 QoS score". Fully
reproducible from the receiver logs.

```
attainment(control)   = 1 − deadline_miss_fraction
attainment(voice)     = 1 − deadline_miss_fraction
attainment(telemetry) = 1 − deadline_miss_fraction
attainment(video)     = frames_delivered ÷ frames_expected      (capped at 1)
attainment(bulk)      = goodput_mbps ÷ offered_mbps             (capped at 1)

weights = control 0.40, video 0.25, voice 0.15, telemetry 0.15, bulk 0.05

app_health_v1 = 100 × Σ(weight × attainment) ÷ Σ(weight)
```

* A class with no samples is **excluded from both sums**, not scored as zero.
* If no class has samples, the score is `null` - not `0`.
* **Phase 4 caveat.** Control's attainment is judged against the deadline of
  the mode each command was sent under, so a policy with mode handover scores
  its waypoint commands against 1500 ms and sends nothing in safe hold. The
  score is therefore **not comparable** between policies with and without
  mode handover; compare `teleop_availability_pct` (section 10) instead.
* The weights are a **product judgement**, stated here so they can be argued
  with. They are not derived from anything.

`health_definition` is carried in every event so a stored run can never be
misread against a later version of the formula.

---

## 4. Continuity metrics

Continuity is reported **separately** from deadline performance, because they
are separate claims: a session can survive while missing every deadline.

| Metric | Unit | Definition |
| --- | --- | --- |
| `interruptions` | count | Number of distinct periods with no carrying path |
| `total_interruption_s` | s | Sum of those periods |
| `longest_interruption_s` | s | Longest single period |
| `outage_s` | s | Total simulated time with no usable carrying path |
| `session_reconnects` | count | Interruptions lasting ≥ `SESSION_TIMEOUT_S` (3.0 s). For B0, **every** path change also breaks the session, because single-path transport does not survive an address change |
| `safe_stop_entered` | bool | Whether the vehicle entered simulated safe-stop |

### "No carrying path" when classes ride their own paths (Phase 4)

With per-class steering a traffic class may ride a different *active* path
from the session's primary path (`carrying`). Continuity is still measured on
the primary path alone, exactly as above: **"no carrying path" means the
session's primary path is not activated.** A class path is a subflow of the
session. It is used only while the primary path exists and only while it is
itself ready to carry; a class whose own path is not ready falls back to the
primary path, and when the primary path is lost every class is lost with it
until the controller establishes a new one. A class path therefore never
keeps the session alive on its own, and never shortens or lengthens an
interruption. This is the Phase 2 definition unchanged, which is what keeps
the Phase 4 continuity figures comparable with the Phase 2 ones; a test
asserts that P2's outage on `total-loss` equals P1's.

---

## 5. Link usage and cost

| Metric | Unit | Definition |
| --- | --- | --- |
| `link_bytes[link]` | B | Every byte placed on that link: application payload, duplicates, retransmissions and probes |
| `satellite_bytes` | B | The expensive one, broken out because it is the interesting cost |
| `bulk_bytes[link]` | B | The part of `link_bytes[link]` that was bulk transfer |
| `satellite_bytes_excl_bulk` | B | `satellite_bytes − bulk_bytes[satellite]`. Pausing bulk is the easy way to save satellite bytes; this is what a policy spent on the satellite path *after* that saving, so the B2-defer baseline can be read against it |
| `goodput_bytes` | B | Useful application bytes delivered |
| `overhead_pct` | % | `100 × (total_link_bytes − goodput_bytes) ÷ total_link_bytes` |
| `cost_units` | arbitrary | `Σ(link_MB × cost_per_mb) + Σ(activations × activation_cost)`. Relative units only - see `docs/ASSUMPTIONS.md` §4 |

**Controller-generated traffic is separable from background demand**: background
load is a capacity reduction applied by the exogenous trace and never appears in
`link_bytes`, so the cost columns measure what the *policy* spent.

---

## 6. Control-plane metrics

| Metric | Definition |
| --- | --- |
| `handovers` | Times the carrying path changed |
| `unnecessary_handovers` | Handovers taken on a **predicted** violation when the incumbent had not actually violated. Counted against the predictive policy on purpose - a false alarm has a cost and it is not hidden |
| `backup_activations` | Times a non-carrying path was activated |
| `duplication_windows` | Distinct periods of control duplication |
| `control_timeouts` / `control_retransmits` | Acknowledgement timeouts and resulting retransmissions |
| `class_steers` | Phase 4. Times a class was moved onto a path other than the one it was on (`STEER_CLASS` actions). Counted for every class, so churn is visible |
| `control_off_primary_s` | Phase 4. Simulated seconds during which control rode a path other than the session's primary path |

---

## 7. Prediction quality

Scored offline, after the run, against what the recorded observations show
actually happened. The controller never had this information.

**Violation definition** (identical for the heuristic, the learned model and the
offline labels - `predictors.VIOLATION_DEFINITION`):

> The carrying path is in violation when its smoothed RTT exceeds **150 ms**
> (the control-class deadline), **or** its windowed loss exceeds **3.0 %**,
> **or** it becomes unusable.

A prediction at time `t` with horizon `h` is a **true positive** if a violation
occurred on the then-carrying path at some point in `(t, t+h]`.

**Scoring rule - the important part:** predictions are scored **only while the
carrying path is not already in violation**. Once the rover is on satellite, the
620 ms base RTT puts it permanently past the 150 ms control deadline; "predicting"
that ongoing condition is not a forecast. Including those rows lifted precision
to 0.997 for free. Excluding them dropped the heuristic to a recall of about
0.10 - a much less flattering and much more honest number. The count of excluded
rows is reported as `skipped_already_violating`.

| Metric | Definition |
| --- | --- |
| `precision` | `TP ÷ (TP + FP)` |
| `recall` | `TP ÷ (TP + FN)` |
| `false_positives` | Warnings where no violation followed |
| `false_negatives` | Violations that arrived unannounced |
| `calibrated` | Whether the score may be read as a probability. See `docs/MODEL_CARD.md` |

---

## 8. Measurement windows at a glance

| Quantity | Window |
| --- | --- |
| Link RTT, jitter, loss, throughput | trailing 2.0 s |
| Per-class p50/p95/p99, deadline miss | whole run (dashboard shows trailing 2.0 s) |
| `app_health_v1` | trailing 2.0 s |
| Continuity, cost, link bytes | whole run |
| Prediction precision/recall | whole run, transitions only |
| Control-mode time accounting (section 10) | every 20 ms simulation step, judged on the trailing 2.0 s observations |
| Aggregate across trials | 20 paired trials; mean, sd and a 95 % CI on the mean |

---

## 9. Aggregation and uncertainty

Across trials, `metrics.aggregate` reports `n`, `mean`, `sd`, `min`, `max` and a
95 % confidence interval on the mean (normal approximation,
`mean ± 1.96·sd/√n`).

With ~20 trials those intervals are wide. The Experiments table marks the best
mean in each row, and says in the caption that **marking is not a significance
test**. Paired per-trial deltas are reported alongside, because with an
identical exogenous trace the paired difference is far more sensitive than a
difference of means.

---

## 10. Control operating mode (Phase 4)

The control class has an operating mode: **teleop** (20 Hz, 150 ms deadline,
the Phase 2 behaviour), **waypoint** (2 Hz, 600 B, 1500 ms deadline, acked) or
**safe_hold** (no commands). Policies without `mode_handover` stay in teleop
for the whole run and still report every metric here, so the strict teleop
picture is available for every policy. The mode never changes the modelled
vehicle motion or the exogenous trace (`docs/ASSUMPTIONS.md` section 5); a
test asserts it.

### Support, the one definition

> A path supports a control mode when it is ready to carry traffic (active or
> carrying), its windowed RTT from acknowledgements is at or below the mode's
> deadline, and its windowed loss is at or below the mode's loss limit. Control
> is acknowledged and retransmitted, so where the path's RTT plus the
> retransmit floor (120 ms) still fits inside the deadline the mode's
> *recovered* loss limit applies instead: one lost packet is resent and still
> arrives in time. A ready path with too few samples supports nothing *yet*
> (unknown). A path that is unavailable, idle, activating or validating
> supports nothing: packets placed on it would not arrive. safe_hold has no
> deadline and is always supported.

| Mode | Deadline | Loss limit | Recovered loss limit |
| --- | --- | --- | --- |
| teleop | 150 ms | 3.0 % (the Phase 2 violation definition) | 15 % where RTT + 120 ms ≤ 150 ms |
| waypoint | 1500 ms | 20 % | none |
| safe_hold | none | none | none |

The same function (`controller/modes.py: mode_supported`) is used by the
controller when it decides and by the simulator when it measures. If the two
differed, the metrics below would measure the difference rather than the
network.

### Metrics, all from receiver-side facts

Accounted every simulation step for the mode in force during that step (the
one the previous decision set), judged on that step's trailing-window
observations of the path control is actually on.

| Metric | Unit | Definition |
| --- | --- | --- |
| `mode_time_s[mode]` | s | Simulated time spent in each mode. Sums to the run duration plus one step |
| `mode_changes` | count | `MODE_CHANGE` actions emitted |
| `anticipated_mode_changes` | count | Downshifts made while the path control was on **still supported** the old mode: a change made ahead of the unsupported period, on a prediction or before moving control onto a path that cannot support the mode |
| `late_mode_changes` | count | Downshifts made after the path control was on had **already stopped** supporting the old mode. A change made in the same step the period began counts as late |
| `unsupported_mode_s` | s | Time in a mode with a deadline (teleop or waypoint) while the control path measurably did **not** support it. The core cost of being in too high a mode |
| `mode_unknown_s` | s | Time in a mode with a deadline while the control path was ready but had too few samples to say either way. Reported rather than folded into either side |
| `conservative_mode_s` | s | Time in a mode **below** the highest mode the control path measurably supported: the cost of hysteresis and of anticipating wrongly. The counterpart of `unsupported_mode_s`; a policy that minimises one by inflating the other has not won |
| `teleop_supported_s` | s | Time in teleop while teleop was measurably supported |
| `teleop_availability_pct` | % | `100 × teleop_supported_s ÷ Σ mode_time_s`. **The strict picture:** the share of the run during which 20 Hz commands against the 150 ms deadline were both offered and supported. A policy that relaxes its deadline cannot raise this number; it can only lower it |
| `control_by_mode[mode]` | counts | `sent`, `delivered`, `deadline_eligible`, `deadline_misses` of control packets generated under each mode, from the receiver log |

### Reading them honestly

* **A relaxed deadline is not a win.** Under mode handover the control
  class's overall `deadline_miss_pct` falls because waypoint commands have a
  1500 ms deadline and safe hold sends nothing. That number is still reported,
  but it is not comparable with a teleop-only policy's. `teleop_availability_pct`
  is the figure to compare, and it is reported for every policy.
* `unsupported_mode_s` for a teleop-only policy is simply the time its
  control path failed the teleop criterion. It is large on the satellite
  segment for every policy, because 620 ms cannot meet 150 ms.
* `conservative_mode_s` is where mode handover pays: every second in waypoint
  while teleop would have worked is a second of operator capability given up
  to hysteresis or to a wrong forecast. The P2-reactiveMode ablation isolates
  the forecasting part.
