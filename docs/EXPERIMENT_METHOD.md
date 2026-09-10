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

All six are the *same class*, `ContinuaController`, differing only in the flags
on `PolicyConfig`. There is no separate "baseline" code path that could be
quietly worse than it needs to be - a test asserts the policies differ only by
configuration.

**B2 exists specifically so that the cost claim can be tested.** Without it,
"CONTINUA gets resilience cheaply" would be an assertion. With it, the cost
difference is measured.

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
| `tune` | 40 000 | Choosing its decision threshold, measuring calibration |
| `test` | 70 000 | **The reported comparison. Nothing is fitted on this block** |

Additionally, two whole scenario **families** (`outage`, `motion`) are held out
of training entirely, so the model is evaluated on scenario shapes it never saw.

A test asserts the three blocks do not intersect.

---

## 4. Procedure

```bash
# 1. Smoke first - 2 trials on every scenario, ~3 minutes.
python -m continua_engine.experiments --smoke

# 2. The reported comparison - 20 paired trials on the six core scenarios.
python -m continua_engine.experiments --trials 20 --block test

# 3. Optional: everything in the catalogue.
python -m continua_engine.experiments --all --trials 20
```

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
the catalogue and run in `--all`.

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
  an outcome.

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
