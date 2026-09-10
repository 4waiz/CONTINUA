# CONTINUA - assumptions and simplifications

Everything this project models that is *not* a measurement of a real network,
stated plainly. If a number in the dashboard traces back to something on this
page, it is an assumption, not evidence.

---

## 1. The headline caveat

**CONTINUA's results are produced by a deterministic software network model.**
It is not a live mobile-network test, it is not an emulation of a real radio
access network, and no run on the development host used verified kernel MPTCP.
The execution mode is stamped on every event, every run record, the dashboard
and the capture frame.

---

## 2. What the simulator does *not* model

| Not modelled | Why it matters |
| --- | --- |
| **TCP congestion control** | There is no slow start, no congestion window, no fast retransmit, no ECN. Senders offer traffic at their configured rate into a finite queue that tail-drops. This reproduces queueing delay, buffer bloat and overload loss; it does **not** reproduce a real TCP stack. Any claim about how TCP would behave here is out of scope. |
| **Real MPTCP** | The multipath behaviour is a *model*: a session that survives a subflow change. It is inspired by MPTCP and is not MPTCP. Path management, `MP_JOIN`, `ADD_ADDR`, the packet scheduler and retransmission across subflows are all absent. |
| **Radio access networks** | Cellular is a shaped access-network profile: a capacity, a delay, a jitter and a loss process. There is no RAN scheduler, no HARQ, no beamforming, no handover signalling, no core network, no slicing. Calling it "5G" in the UI is shorthand for "the cellular access profile". |
| **Satellite constellations** | Likewise a shaped profile with a long base RTT. There is no orbital mechanics, no beam handover, no ground-station scheduling and no weather. |
| **Wi-Fi PHY/MAC** | No CSMA/CA, no rate adaptation, no contention with other stations beyond the aggregate `background` load, no channel model. RSSI is a *linear mapping from modelled coverage*, not a propagation calculation. |
| **Cross-traffic beyond the aggregate** | Competing demand is a scalar fraction of link capacity, not simulated flows. |
| **Application internals** | Video is a synthetic frame stream, not a codec. Voice-like traffic is a constant-bitrate stream with voice-like packet size and cadence - there is no codec, no jitter buffer, no PLC and no call setup. It is deliberately named "voice-like". |

## 3. Deliberate modelling choices

* **Bulk transfer is a fluid byte stream.** Control, voice, telemetry and video
  are modelled packet by packet; bulk is modelled as bytes so that run times stay
  workable. Bulk therefore has no per-packet latency distribution.
* **Loss is applied at dequeue**, as a Bernoulli draw against the current loss
  probability, with correlated bursts from a two-state Gilbert–Elliott chain
  whose bad-state entry probability rises as link quality falls.
* **Delay** = base one-way propagation × a quality multiplier, plus jitter, plus
  the current queueing delay implied by queue occupancy and capacity.
  Serialisation is captured by the drain rate rather than added separately.
* **Retransmission** uses a Jacobson/Karels adaptive RTO with a per-class floor
  and a 3 s ceiling, capped at `max_retransmits`, and abandoned once a packet is
  past its deadline. An earlier fixed RTO produced a retransmission storm on the
  satellite path, which is exactly the failure mode adaptive timers exist to
  prevent.
* **Session semantics.** Multipath policies (B1, B2, P1 and its ablations) model
  a transport session that survives a subflow change; the single-path baseline
  (B0) models a transport where an address change terminates the session. This
  is the main structural advantage multipath has in these results, and it is a
  modelling assumption, not a measurement.
* **A session is considered lost** after 3.0 s with no carrying path
  (`SESSION_TIMEOUT_S`), at which point a reconnect is counted and safe-stop is
  entered.

## 4. Synthetic link profiles

`services/engine/continua_engine/scenarios/link_profiles.json` - **plausible
starting profiles, not measured operator data.** They were chosen so the four
access classes behave distinguishably, and they are kept in a file precisely so
that no one has to read implementation code to find out what was assumed.

| Link | Capacity | Base RTT | Jitter | Base loss | Activation | Cost/MB |
| --- | --- | --- | --- | --- | --- | --- |
| Wired | 940 Mbps | 1.6 ms | 0.25 ms | 0.002 % | 0.15 s | 0.0 |
| Wi-Fi | 90 Mbps | 9 ms | 3.5 ms | 0.18 % | 0.85 s | 0.0 |
| Cellular | 55 Mbps | 32 ms | 9 ms | 0.35 % | 1.8 s | 0.004 |
| Satellite | 18 Mbps | 620 ms | 45 ms | 0.7 % | 4.5 s | 0.06 |

Activation delay and per-megabyte cost are included **specifically so prediction
is not given a free advantage**: pre-warming a backup costs real time and real
bytes, and switching early to satellite is expensive. A model without those
costs would make any proactive policy look better than it is.

### Cost units

`cost_units = Σ (link_MB × cost_per_mb) + (activations × activation_cost)`.
These are **arbitrary relative units**, not currency. They exist to compare
policies against each other, not to price a deployment.

## 5. Workload assumptions

| Class | Rate | Packet | Deadline | Notes |
| --- | --- | --- | --- | --- |
| Control | 20 Hz | 220 B | 150 ms | Acknowledged, ≤2 retransmits, deduplicated at the receiver |
| Voice-like | 50 Hz | 160 B | 120 ms | CBR stream. **Not a real voice implementation** |
| Telemetry | 10 Hz | 420 B | 400 ms | Freshness measured at the receiver |
| Video | 30 fps | 7200 B/frame, 1200 B MTU | 350 ms | A frame counts only if *every* packet arrives before the deadline |
| Bulk | 12 Mbps offered | fluid | none | Deferrable; paused by the app-aware policy when capacity is scarce |

Deadlines are **application requirements chosen for this demonstration**, not
observed values from any real system. The 150 ms control deadline is why the
satellite path, at 620 ms base RTT, cannot meet the control deadline at all -
that is a real consequence of the assumptions, and it is reported rather than
hidden.

## 6. The coverage model

Geometric, from `packages/contracts/world.json`:

* **Wired** - full within 14 m of the dock, zero beyond 20 m.
* **Wi-Fi** - full within 42 % of a 155 m radius from the nearest of three APs,
  falling to zero at the edge.
* **Cellular** - one macro site, 330 m radius, same falloff shape.
* **Satellite** - 0.42 everywhere, rising to 0.87 in the remote sector.

This is **not** a propagation model. There is no path loss, no fading, no
terrain masking, no antenna pattern and no interference. It is labelled
`modelled_coverage` everywhere it appears, and the controller is never allowed
to treat it as a measurement.

## 7. Where the honesty rules are enforced

* A measurement that does not exist is `None`/`null` and renders as
  "unavailable" - never `0`.
* RSSI is reported **only** for Wi-Fi. Every other link returns `None`, and a
  test asserts it.
* `modelled_coverage` is always labelled as modelled.
* The predictor's score is only called a probability when the model has passed a
  calibration check. It currently has not, so it is labelled "uncalibrated".
* When all paths are gone, the run reports a genuine outage and a simulated
  safe-stop. No policy routes around a total outage.

## 8. Emulation status on the development host

Probed, not assumed (`data/emulation_capability.json`):

* Kernel: `6.18.33.2-microsoft-standard-WSL2`
* `CONFIG_MPTCP` **is not set** → `ip mptcp` fails → **MPTCP is impossible here**
* `iproute2`, `tc`, `sch_netem`, `ss`, `tcpdump`, `python3` - all present
* Passwordless `sudo` - **not available**, so namespaces cannot be created
  non-interactively

**Verdict: emulation is NOT VERIFIED HERE.** The adapter, the topology scripts
and the verification script exist and parse cleanly, but writing them is not the
same as having run an experiment, and no result in this repository comes from
emulation.
