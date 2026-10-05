Written against the run above (`test4`, 20 paired trials, the commit in the header). Every figure
quoted here is in a table above.

### What was asked, and what the data says

**1. Where a forecast of the carrying path's own trend could help, there was almost nothing to
help with.** On the tune block, the steps in which an earlier switch could have moved traffic to a
cleaner ready path hold at most 0.34 % of any class's deadline misses or video stall, in every
original scenario (section 1). That is why the trend predictor does not pay for itself in Phase 2,
and why no better trend predictor was built: the warm backup already catches every transition, and
the losses that remain are on the satellite segment, where there is no other path.

**2. A route-aware forecast pays exactly where it was expected to.** On the shadowed route the
cutting takes Wi-Fi and the cell together while satellite is cold. P1 and P1-noPred lose the
session there in **every** trial - one reconnect, 4.5 s more interruption, a safe stop. P3, which
looked the gap up in the radio map 8 s ahead and had satellite active when the cutting arrived,
keeps the session in every trial: `P3 - P1` is **-4.50 s interruption, -1.00 reconnect, -1.00 safe
stop** on `shadow-survey`, `shadow-degradation` and `shadow-fast`, and -4.50 s and -1.00 reconnect
on `shadow-reverse` (where every policy also pays the 4.5 s satellite start-up a reverse run begins
with). Control deadline misses fall by 0.57-0.71 points with it. This is the first prediction
result in the project that changes an outcome, and it is the map - P3 differs from P1 by one flag.

**3. It costs no more than P1 where it helps, and a little more satellite.** Paired against P1,
P3's cost is unchanged on `shadow-survey` and `shadow-degradation` (+0.00, intervals across zero)
and lower on `shadow-fast` (-0.33) and `shadow-reverse` (-0.68): preparing one path ahead of the
gap is cheaper than re-establishing a lost session. It carries 0.31-0.35 MB more satellite traffic
per run, from the path it activates early. One gap was prepared for per run (1.65 on
`shadow-fast`, where at speed the corridor shadow also arrives while a fading Wi-Fi is the backup).

**4. Against always-on redundancy, the same continuity for a third of the cost or less.** B2 keeps
the session through the cutting too. Against it P3 saves 3.35-3.44 cost units - P3 costs 17-32 % of
what B2 does - and 55-68 MB of satellite traffic per run, and stalls video 3.7-7.0 s less; B2 misses
fewer control deadlines on `shadow-degradation` (+0.78 points against P3) and `shadow-fast` (+2.95),
because it duplicates control on every path all the time.

**5. Against B2-defer, P3 is not cheaper.** B2-defer - every path active, bulk paused by the
app-aware rule - also keeps the session through the cutting. Against it P3 uses about half the
satellite traffic (4.0-5.3 MB less per run) and stalls video 1.25-2.43 s less on three of the four
shadow scenarios, but costs **0.43-0.44 units more** on `shadow-survey` and `shadow-degradation`
(+0.05 on `shadow-reverse`, -0.25 on `shadow-fast`) and misses 0.32-3.01 points more control
deadlines on three of them. The cost gap is the one Phase 4 found: P3, like P1, releases and
re-activates the satellite path and pays its activation charge each time, where B2-defer keeps it
active and pays once. A team that cares about the bill in this tariff should read B2-defer as the
cheaper policy; one that cares about satellite volume, or video, should read P3.

**6. An out-of-date map costs money and saves nothing.** On `shadow-stale` the map remembers a
cutting that is gone and does not know the one that stands 50 m further on. P3 prepares for the
first, as designed, and meets the second unprepared: continuity is P1's exactly (`P3 - P1` is 0 on
interruption, reconnects and safe stops), and the wasted preparation costs **+0.40 units**. A map
is only as good as its last survey, and this is what it costs when it is wrong.

**7. Where the map has nothing to say, P3 is P1.** In all eight original scenarios P3 and P1
produced identical continuity, application and link metrics in every trial, and P3 prepared for no
gap (section 3). The open-route map has no place where the carrying path and its warm backup are
lost together, so the mechanism never fired.

### What this does not show

* **The map is exact here**, because modelled coverage in this simulator is a function of position
  alone; a real survey map is noisy and ages, and `shadow-stale` is the only measure of that here.
* **The shadowed route is a scenario family built for this question**, declared before the run
  with its expectations (docs/EXPERIMENT_METHOD.md section 9). Its value is that it isolates the
  one situation foresight can change; it does not show how often that situation occurs on a real
  route.
* Everything is a simulation: no radios, no satellite, no hardware.
