# CONTINUA - experiment method

How the comparison is run, and the specific ways it is designed not to flatter
CONTINUA.

---

## 1. What is being compared

| Id | Policy | Multipath | Warms a backup | Uses prediction | App-aware |
| --- | --- | --- | --- | --- | --- |
| **B0** | Single-path reactive | no | no | no | no |
| **B1** | Reactive multipath | yes | only after degradation is measured | no | no |
| **B2** | Always-active redundancy | yes | always, every usable path | no | no |
| **P1** | **CONTINUA** | yes | yes | yes | yes |
| P1-noPred | Ablation: no prediction | yes | yes | **no** | yes |
| P1-noApp | Ablation: no application priorities | yes | yes | yes | **no** |

Phase 4 adds five more, again flags only:

| Id | Policy | Per-class steering | Mode handover | Anticipates mode | Bulk deferral |
| --- | --- | --- | --- | --- | --- |
| **B2-defer** | B2 plus the app-aware bulk pause rule, nothing else app-aware | no | no | - | **yes** |
| **P2** | **P1 plus both new mechanisms** | **yes** | **yes** | yes | yes (via app-awareness) |
| P2-noSteer | Ablation: mode handover only | **no** | yes | yes | yes |
| P2-noMode | Ablation: steering only | yes | **no** | - | yes |
| P2-reactiveMode | Ablation: mode changes only after a measured violation | yes | yes | **no** | yes |

All eleven are the *same class*, `ContinuaController`, differing only in the
flags on `PolicyConfig`. There is no separate "baseline" code path that could
be quietly worse than it needs to be - a test asserts the policies differ only
by configuration, and a regression guard asserts that the six Phase 2 policies
produce byte-identical metrics and decision streams with the Phase 4 code in
place (`tests/engine/test_regression_guard.py`).

**B2 exists specifically so that the cost claim can be tested.** Without it,
"CONTINUA gets resilience cheaply" would be an assertion. With it, the cost
difference is measured. **B2-defer exists because most of P1's satellite
saving came from pausing bulk**, which is the easy part; it isolates that part
so the rest of the application-aware saving can be read on its own, alongside
`satellite_bytes_excl_bulk`.

### On what "multipath" means here

B1, B2, P1 and the ablations model a transport session that survives a subflow
change; B0 models single-path transport where an address change ends the
session. **This is a simplified MPTCP-inspired model, not MPTCP.** See
`docs/ASSUMPTIONS.md` §2.

---

## 2. Pairing

The core of the design.

For trial `i`, one seed is derived: `seed = block_base + i`. That seed
generates the **exogenous trace** - per-link quality over time, background
demand, Gilbert–Elliott burst-loss state, jitter noise and the loss-decision
pool. The trace is built **before any policy runs** and is a pure function of
`(scenario, seed)`.

Every policy in trial `i` then runs against **that same trace object**. They face
byte-identical link conditions, identical competing demand and identical loss
draws. A difference between them is a difference in policy.

Verified by `tests/engine/test_engine.py::test_exogenous_trace_is_independent_of_policy`.

Analysis uses **paired per-trial deltas** as well as means. With an identical
exogenous trace the paired difference is far more sensitive than a difference of
group means, and it is what the Experiments page shows in its second table.

---

## 3. Seed blocks

Disjoint by construction (`experiments/runner.py`):

| Block | Base | Used for |
| --- | --- | --- |
| `train` | 10 000 | Fitting the learned predictor |
| `tune` | 40 000 | Choosing its decision threshold, measuring calibration; Phase 4 hysteresis constants |
| `test` | 70 000 | **The Phase 2 comparison. Nothing is fitted on this block** |
| `test2` | 100 000 | **The Phase 4 comparison.** The `test` block was reported in Phase 2 and so is no longer unseen; `test2` was used exactly once |
| `test3` | 130 000 | Phase 4 supplement: a defect in the `P2-reactiveMode` ablation was found after `test2` had been used, so the corrected ablation was compared with P2 on this fresh block rather than by re-using `test2` (`docs/PHASE_4_RESULTS.md` section 5) |

Additionally, two whole scenario **families** (`outage`, `motion`) are held out
of training entirely, so the model is evaluated on scenario shapes it never saw.

A test asserts the five blocks do not intersect.

---

## 4. Procedure

```bash
# 1. Smoke first - 2 trials on every scenario, ~3 minutes.
python -m continua_engine.experiments --smoke

# 2. The reported comparison - 20 paired trials on the six core scenarios.
python -m continua_engine.experiments --trials 20 --block test

# 3. Optional: everything in the catalogue.
python -m continua_engine.experiments --all --trials 20

# 4. Phase 4. Tune on the tune block, with the selection rule declared in the
#    script before any cell runs; then the comparison on test2, once.
python scripts/phase4_tune.py --trials 5
python scripts/phase4_experiment.py --trials 20 --block test2
```

The Phase 4 driver refuses to run a second time while its index exists, and
the tuning script records every grid cell, not just the chosen one.

Each experiment writes `data/experiments/<experiment_id>.json` containing:

* the scenario id and the **full seed list**
* trials requested and trials **actually completed**, per policy
* the predictor and horizon used
* the code commit
* every individual run's metrics (`raw`)
* aggregates with mean, sd, min, max and a 95 % CI
* paired deltas against each baseline
* any failures, listed rather than dropped

## 5. Core scenarios

| Scenario | What it tests | Honest expectation |
| --- | --- | --- |
| `wifi-degradation` | Smooth 22 s decay with cellular overlapping | The case prediction should win. Trend is visible before violation |
| `sudden-failure` | Wi-Fi to zero in 200 ms, no warning | **Prediction cannot help.** CONTINUA should match a good reactive policy, not beat it |
| `cellular-congestion` | Background load takes 86 % of the cell | Coverage stays high, so a coverage-only policy sees nothing while queues build |
| `satellite-fallback` | Cellular fades, satellite is the only option | Long activation delay against a 150 ms control deadline |
| `flapping` | Wi-Fi cycles five times | Punishes any controller without hysteresis. Shows up as unnecessary handovers |
| `total-loss` | Every path removed for 9 s | **No policy can win.** Checks that an outage is reported as an outage |

`dock-disconnect`, `fast-run`, `reverse-run` and `baseline-journey` are also in
the catalogue and run in `--all`. The Phase 4 comparison adds `fast-run` and
`reverse-run` to the six core scenarios: speed shortens every hysteresis
window, and the reversed route starts on satellite, which is where a mode
machine that had quietly learned the forward order would show it.

---

## 6. What was done to avoid fooling ourselves

* **The exogenous trace is policy-independent**, by construction and by test.
* **The controller never receives the trace.** A test walks the controller's
  attributes and fails if any of them exposes it. Prediction features are
  restricted to an allow-list of observable quantities, also tested.
* **Labels are computed offline**, after the run, from the recorded observation
  series. Features are exactly what the controller had at decision time.
* **Predictions are scored only on transitions**, not on ongoing violations.
  This was not the original scoring rule; the original gave precision 0.997 and
  was quietly meaningless. See `docs/METRICS.md` §7.
* **Unnecessary handovers are counted against CONTINUA.** A switch made on a
  prediction where the incumbent never actually violated is recorded as
  unnecessary, in the same table as the wins.
* **Activation delay and per-byte cost are modelled**, so pre-warming is not
  free.
* **The final test block was not touched during development.** The predictor was
  fitted on `train`, its threshold chosen on `tune`.
* **The trace was not re-rolled until CONTINUA won.** Scenario specifications
  were written before the comparison was run and have not been edited to change
  an outcome. Phase 4 edited no scenario.
* **The mode cannot touch the world.** A test runs P1 and P2 on the same seed
  and asserts the trace arrays and every vehicle sample are identical, and
  that the vehicle keeps moving while the command channel is in safe hold.
* **Phase 4 was developed and tuned on the tune block only.** The two
  hysteresis constants came from a declared grid and a selection rule written
  down before the grid ran; `test2` was then used once, and the driver refuses
  to run again.
* **Costs of the new mechanisms are in the same tables as the wins:** class
  steers, mode changes, time held below a supported mode, bytes and cost on
  the second path, and `teleop_availability_pct` as the strict picture a
  relaxed deadline cannot flatter.

---

## 7. Reading the results honestly

* With ~20 trials, 95 % confidence intervals are wide. **A small gap between two
  policies is inconclusive, not a win.** The Experiments page marks the best
  mean per row and says explicitly that marking is not a significance test.
* Some metrics trade against each other by design. CONTINUA deliberately pauses
  bulk transfer to protect control and video, which *lowers* its bulk attainment
  and therefore its composite `app_health_v1`. Reporting only the composite
  would hide the trade; the per-class table is shown alongside.
* `total-loss` is expected to show **no policy difference in outage duration**.
  If it ever showed one, that would be a bug, not a result.
* `sudden-failure` is expected to show **little or no prediction benefit**.

---

## 8. Reproducing a single run

Any run in the store can be reproduced exactly from its manifest:

```bash
python -c "
import sys; sys.path.insert(0, 'services/engine')
from continua_engine.experiments.runner import run_single
from continua_engine.contracts import PolicyId
print(run_single('wifi-degradation', PolicyId.P1_CONTINUA, seed=70000, persist=False))
"
```

The manifest (`data/runs/<run_id>/manifest.json`) records the scenario spec,
seed, policy, predictor, horizon, engine version, code commit and environment.
`tests/engine/test_engine.py::test_same_seed_reproduces_identical_run` asserts
that two runs with the same seed produce identical event streams.

---

## 9. Phase 5: route-aware preparation (declared before the comparison ran)

Written before `test4` was touched. Everything below is fixed; the comparison
runs once (`scripts/phase5_experiment.py`, which refuses a second run).

### Why another predictor

Phase 2 found the trend predictor does not pay for itself; Phase 4 found the
same for anticipating mode changes. `scripts/phase5_headroom.py` measures the
ceiling before building anything: on the tune block it labels every step in
which the carrying path was already in its lossy tail (modelled quality below
0.95) while another path was activated, validated and clean. Only in those
steps could an earlier switch - what a better forecast buys - have moved
traffic to a better path. In the original scenarios they hold **under 0.4 % of the
deadline misses and video stall** (`data/experiments/phase5_headroom.json`):
the warm backup already catches every transition, and the losses are on the
satellite segment, where no other path exists. No forecast of the carrying
path's own trend can improve on that, so none is attempted.

What a forecast can still buy is **a path prepared before it is needed** - and
that only matters when the path a policy keeps warm anyway is lost at the same
place as the carrying one. Satellite takes 4.5 s to activate; a stretch of
road that shadows Wi-Fi and the cell together, met while the session is on
one with the other warm, leaves a reactive policy (and P1, which keeps one
backup warm) without a path for 4-5 s - a session reconnect and a safe stop.
A trend cannot see that coming: neither path degrades before the shadow. A
map of where each network was lost on earlier drives can.

### P3

`P3` is P1 plus `route_prepare` (`controller.py`, `radio_map.py`). Each step
it looks up the stretch of route the vehicle will cover in the next
`route_horizon_s` at its current speed; if the radio map has the carrying path
**and** the warm backup unavailable somewhere on it, it activates (or keeps)
the path the map says stays available. Nothing else differs from P1, so
`P3 - P1` is the map alone.

* **The map** (`models/radio_map-<survey>.json`) is built by
  `scripts/build_radio_map.py` from survey drives in the **train** block
  (seeds 10000-10009) of one survey scenario per world - `baseline-journey`
  for the open route, `shadow-survey` for the shadowed one - from what the
  controller observed: each link's phase and reported coverage, binned every
  5 m along the planned route. It never reads the trace.
* **The controller is told its mission**: the route's length and direction.
  `VehicleObservation.distance_m` is its progress along it. It is not told its
  future speed or when it will reach anything.
* **Constants were fixed by arithmetic, not tuned.** `route_horizon_s = 8 s`:
  satellite activation (4.5 s) plus validation (1.2 s), with 2 s to spare.
  A map bin counts as unavailable at a survey share of 0.5. The tune block
  (3 seeds) was used only to check that the mechanism does what it says; it
  found two counting defects in `route_prearms` (one gap was counted more
  than once while the ranking of paths flickered), fixed before this was
  written. No constant was changed by it.
* **The costs are counted**: `route_prearms` (gaps prepared for), activation
  cost and satellite bytes in the same tables as continuity.

### Honest limitation, stated in advance

Modelled coverage in this simulator is a deterministic function of position,
so a survey map of the same world is exact. A real map is noisy and ages.
`shadow-stale` is in the comparison for that reason: there the map is wrong
both ways, and P3 should be **no better than P1** at the obstruction it does
not know about, while paying for preparing at the one that is gone.

### The comparison

* Block `test4` (seeds 160000-160019), 20 paired trials, run once.
* Policies: B0, B1, B2, B2-defer, P1, P1-noPred, P3.
* Scenarios: the five of the new `shadow` family, and the eight Phase 4
  scenarios (where P3 uses the open-route map).

| Scenario | What it tests | Expectation, written before the run |
| --- | --- | --- |
| `shadow-survey` | A 40 m cutting shadows Wi-Fi and the cell together while satellite is cold | P1, P1-noPred, B0, B1 lose the session for 4-5 s at the cutting (reconnect, safe stop). B2 and P3 do not. P3 at a fraction of B2's cost |
| `shadow-degradation` | The same, with Wi-Fi also degrading around it | As above |
| `shadow-fast` | The same at 1.8x | As above; the horizon in metres grows with speed |
| `shadow-reverse` | The same, met from the far side | As above, plus the 4.5 s satellite start-up every policy pays when a reverse run begins |
| `shadow-stale` | The map is out of date | P3 no better than P1 on continuity, and more expensive |
| The eight Phase 4 scenarios | No gap where both kept paths fail | **P3 identical to P1.** Any difference is a defect |

What would count against P3: a cost above P1's in the shadow scenarios it
helps in; any open-route difference from P1; a stale-map result worse than
P1's on continuity.
