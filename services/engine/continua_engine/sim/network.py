"""
The causal network model.

Traffic is generated, enqueued on a path, drained at that path's current
capacity, delayed, possibly lost, and delivered to a receiver that keeps its own
log. **Every metric in this project is computed from the receiver's log**, from
acknowledgements, or from timeouts — never from the sender's intention and never
scripted. There is no `handoff_succeeded = True` anywhere.

Documented simplifications (see `docs/ASSUMPTIONS.md` for the full list):

* Congestion control is **not** modelled. There is no TCP slow start, no
  congestion window, no fast retransmit. Senders offer traffic at their
  configured rate into a finite queue; the queue tail-drops. This reproduces
  queueing delay, buffer bloat and loss under overload, and it does **not**
  reproduce a real TCP stack's behaviour.
* Bulk transfer is modelled as a fluid byte stream rather than discrete packets,
  to keep run times tractable. Control, voice, telemetry and video are modelled
  packet by packet.
* Delay is one-way propagation plus queueing; serialisation is captured by the
  drain rate rather than added separately.
"""

from __future__ import annotations

import heapq
import math
from collections import deque
from dataclasses import dataclass, field

from ..contracts import ALL_CLASSES, LinkId, TrafficClass
from .exogenous import ExogenousTrace, link_profiles


@dataclass(slots=True)
class Packet:
    uid: int
    traffic_class: TrafficClass
    seq: int
    size: int
    created_t: float
    deadline_t: float | None
    band: int
    frame_id: int | None = None
    frame_packets: int = 1
    is_duplicate: bool = False
    is_probe: bool = False
    is_retransmit: bool = False
    sent_t: float = 0.0
    link: LinkId | None = None


@dataclass(slots=True)
class DeliveryRecord:
    t: float
    latency_ms: float
    packet: Packet


class LinkPath:
    """One access path: a finite queue, a rate, a delay and a loss process."""

    def __init__(self, link: LinkId, trace: ExogenousTrace) -> None:
        profiles = link_profiles()
        self.link = link
        self.profile = profiles["profiles"][link.value]
        self.response = profiles["quality_response"]
        self.trace = trace

        self.queue: list[deque[Packet]] = [deque(), deque(), deque()]
        self.queue_bytes = 0
        self.bulk_bytes = 0.0
        self.max_queue = int(self.profile["queue_bytes"])

        # Session state driven by the controller.
        self.activated = False
        self.activating_until: float | None = None
        self.validating_until: float | None = None
        self.validated = False

        # Accounting.
        self.link_bytes = 0
        self.activations = 0
        self.dropped_queue = 0
        self.dropped_loss = 0
        self._loss_cursor = 0

    # -- world-driven properties -------------------------------------------

    def quality(self, idx: int) -> float:
        return float(self.trace.quality[self.link][idx])

    def usable(self, idx: int) -> bool:
        return self.quality(idx) >= self.response["usable_coverage_floor"]

    def capacity_mbps(self, idx: int) -> float:
        q = self.quality(idx)
        floor = self.response["capacity_at_zero"]
        factor = floor + (1.0 - floor) * q
        contention = 1.0 - float(self.trace.background[self.link][idx])
        return self.profile["capacity_mbps"] * factor * max(contention, 0.02)

    def one_way_ms(self, idx: int) -> float:
        q = self.quality(idx)
        rtt_mult = 1.0 + (self.response["rtt_multiplier_at_zero"] - 1.0) * (1.0 - q)
        jit_mult = 1.0 + (self.response["jitter_multiplier_at_zero"] - 1.0) * (1.0 - q)
        # Queue occupancy adds real delay: this is where congestion shows up.
        cap = max(self.capacity_mbps(idx), 0.01)
        queue_delay_ms = (self.queue_bytes + self.bulk_bytes) * 8.0 / (cap * 1e6) * 1000.0
        noise = float(self.trace.jitter_noise[self.link][idx])
        jitter = self.profile["jitter_ms"] * jit_mult * noise
        base = self.profile["base_rtt_ms"] * rtt_mult / 2.0
        return max(0.05, base + jitter + queue_delay_ms)

    def loss_probability(self, idx: int) -> float:
        q = self.quality(idx)
        base = self.profile["loss_base"]
        floor_loss = self.response["loss_at_zero"]
        if bool(self.trace.burst[self.link][idx]):
            return float(self.profile["burst_loss"]["burst_loss_rate"])
        return float(base + (floor_loss - base) * (1.0 - q) ** 2)

    def _next_loss_roll(self) -> float:
        pool = self.trace.loss_roll[self.link]
        value = float(pool[self._loss_cursor % len(pool)])
        self._loss_cursor += 1
        return value

    # -- controller-driven session state ------------------------------------

    def request_activation(self, t: float) -> None:
        if self.activated or self.activating_until is not None:
            return
        self.activating_until = t + float(self.profile["activation_s"])
        self.activations += 1

    def release(self) -> None:
        self.activated = False
        self.activating_until = None
        self.validating_until = None
        self.validated = False
        for band in self.queue:
            band.clear()
        self.queue_bytes = 0
        self.bulk_bytes = 0.0

    def tick_session(self, t: float, idx: int) -> None:
        if not self.usable(idx):
            # The path went away underneath us. Anything queued on it is lost.
            if self.activated or self.activating_until is not None:
                self.dropped_queue += sum(len(band) for band in self.queue)
            self.release()
            return
        if self.activating_until is not None and t >= self.activating_until:
            self.activating_until = None
            self.activated = True
            self.validating_until = t + float(self.profile["validation_s"])
        if self.validating_until is not None and t >= self.validating_until:
            self.validating_until = None
            self.validated = True

    @property
    def carrying_ready(self) -> bool:
        return self.activated and self.validated

    # -- data plane ----------------------------------------------------------

    def enqueue(self, packet: Packet) -> bool:
        if self.queue_bytes + self.bulk_bytes + packet.size > self.max_queue:
            self.dropped_queue += 1
            return False
        self.queue[packet.band].append(packet)
        self.queue_bytes += packet.size
        self.link_bytes += packet.size
        return True

    def offer_bulk(self, byte_count: float) -> float:
        room = self.max_queue - (self.queue_bytes + self.bulk_bytes)
        accepted = max(0.0, min(byte_count, room))
        self.bulk_bytes += accepted
        self.link_bytes += int(accepted)
        return accepted

    def drain(self, t: float, dt: float, idx: int, heap: list) -> float:
        """Drain the queue for one step. Returns bulk bytes delivered."""
        if not (self.activated or self.activating_until is not None):
            return 0.0
        budget = self.capacity_mbps(idx) * 1e6 / 8.0 * dt
        loss_p = self.loss_probability(idx)
        one_way = self.one_way_ms(idx) / 1000.0

        for band in self.queue:
            while band and budget >= band[0].size:
                packet = band.popleft()
                budget -= packet.size
                self.queue_bytes -= packet.size
                if self._next_loss_roll() < loss_p:
                    self.dropped_loss += 1
                    continue
                heapq.heappush(heap, (t + one_way, packet.uid, packet))

        bulk_sent = 0.0
        if self.bulk_bytes > 0 and budget > 0:
            bulk_sent = min(self.bulk_bytes, budget)
            self.bulk_bytes -= bulk_sent
            # Fluid stream: apply the same loss rate as an expected fraction.
            bulk_sent *= 1.0 - loss_p
        return bulk_sent

    def cost_units(self) -> float:
        mb = self.link_bytes / 1e6
        return mb * float(self.profile["cost_per_mb"]) + self.activations * float(
            self.profile["activation_cost"]
        )


# ---------------------------------------------------------------------------
# Receivers
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class ClassReceiver:
    """Receiver-side log for one traffic class. The source of truth for metrics."""

    traffic_class: TrafficClass
    deadline_ms: float | None
    seen_seq: set[int] = field(default_factory=set)
    duplicates_suppressed: int = 0
    delivered: int = 0
    sent: int = 0
    latencies: list[float] = field(default_factory=list)
    deadline_misses: int = 0
    deadline_eligible: int = 0
    goodput_bytes: int = 0
    last_arrival_t: float | None = None
    #: video only
    frame_parts: dict[int, int] = field(default_factory=dict)
    frame_deadline: dict[int, float] = field(default_factory=dict)
    frames_delivered: int = 0
    frames_expected: int = 0
    last_frame_t: float | None = None
    stall_ms: float = 0.0
    #: bulk only
    bytes_completed: float = 0.0
    #: recent arrivals for windowed statistics: (t, latency_ms, ok)
    window: deque = field(default_factory=lambda: deque(maxlen=4000))

    #: Video accounts goodput per completed frame instead, so it must not also
    #: count each arriving packet or the totals double.
    counts_packet_goodput: bool = True

    def accept(self, packet: Packet, t: float) -> bool:
        """Deliver a packet to the application. Returns False if deduplicated.

        Deduplication happens here, before the application sees anything, so a
        duplicated command during a risky transition can never execute twice.
        """
        latency_ms = (t - packet.created_t) * 1000.0
        self.window.append((t, latency_ms, True))
        if packet.seq in self.seen_seq:
            self.duplicates_suppressed += 1
            return False
        self.seen_seq.add(packet.seq)
        self.delivered += 1
        self.latencies.append(latency_ms)
        if self.counts_packet_goodput:
            self.goodput_bytes += packet.size
        self.last_arrival_t = t
        if packet.deadline_t is not None:
            self.deadline_eligible += 1
            if t > packet.deadline_t:
                self.deadline_misses += 1
        return True


class VideoReceiver(ClassReceiver):
    """Frames are only useful whole and on time.

    `counts_packet_goodput` is switched off by the caller: video accounts
    goodput per completed frame, and counting arriving packets as well made
    total goodput exceed total link bytes, which showed up as a nonsensical
    negative overhead percentage.
    """

    def accept_frame_part(self, packet: Packet, t: float) -> None:
        if packet.frame_id is None:
            return
        fid = packet.frame_id
        if fid in self.frame_deadline and self.frame_deadline[fid] < 0:
            return  # already resolved
        self.frame_parts[fid] = self.frame_parts.get(fid, 0) + 1
        self.frame_deadline.setdefault(fid, packet.deadline_t or math.inf)
        if self.frame_parts[fid] >= packet.frame_packets:
            on_time = t <= (packet.deadline_t or math.inf)
            self.frame_deadline[fid] = -1.0
            if on_time:
                self.frames_delivered += 1
                self.last_frame_t = t
                self.goodput_bytes += packet.frame_packets * packet.size


# ---------------------------------------------------------------------------
# Senders
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class OutstandingAck:
    packet: Packet
    sent_t: float
    timeout_t: float
    attempts: int


class TrafficPlant:
    """Generates every application flow and owns the receivers."""

    def __init__(self, workload: list[str], dt: float) -> None:
        spec = link_profiles()["workload"]
        self.spec = spec
        self.dt = dt
        self.enabled = {TrafficClass(name) for name in workload}
        self.uid = 0
        self.seq: dict[TrafficClass, int] = {c: 0 for c in ALL_CLASSES}
        self.accum: dict[TrafficClass, float] = {c: 0.0 for c in ALL_CLASSES}
        self.frame_id = 0

        self.receivers: dict[TrafficClass, ClassReceiver] = {}
        for cls in ALL_CLASSES:
            if cls not in self.enabled:
                continue
            if cls is TrafficClass.VIDEO:
                receiver = VideoReceiver(cls, spec["video"]["deadline_ms"])
                receiver.counts_packet_goodput = False
                self.receivers[cls] = receiver
            elif cls is TrafficClass.BULK:
                self.receivers[cls] = ClassReceiver(cls, None)
            else:
                self.receivers[cls] = ClassReceiver(cls, spec[cls.value]["deadline_ms"])

        self.outstanding: dict[int, OutstandingAck] = {}
        self.control_timeouts = 0
        self.control_retransmits = 0
        #: Video rung index into the bitrate ladder, moved by the policy.
        self.video_rung = 0
        #: Bulk can be paused by the policy when capacity is scarce.
        self.bulk_paused = False
        self.bulk_remaining = float(spec["bulk"]["total_bytes"])

    def _next_uid(self) -> int:
        self.uid += 1
        return self.uid

    def _due(self, cls: TrafficClass, hz: float, t: float) -> int:
        """How many packets this class owes at time t. Deterministic accrual."""
        self.accum[cls] += hz * self.dt
        count = int(self.accum[cls])
        self.accum[cls] -= count
        return count

    def generate(self, t: float) -> list[Packet]:
        out: list[Packet] = []
        spec = self.spec

        for cls in (TrafficClass.CONTROL, TrafficClass.VOICE, TrafficClass.TELEMETRY):
            if cls not in self.enabled:
                continue
            conf = spec[cls.value]
            for _ in range(self._due(cls, conf["hz"], t)):
                self.seq[cls] += 1
                packet = Packet(
                    uid=self._next_uid(),
                    traffic_class=cls,
                    seq=self.seq[cls],
                    size=int(conf["packet_bytes"]),
                    created_t=t,
                    deadline_t=t + conf["deadline_ms"] / 1000.0,
                    band=int(conf["band"]),
                )
                self.receivers[cls].sent += 1
                out.append(packet)

        if TrafficClass.VIDEO in self.enabled:
            conf = spec["video"]
            ladder = conf["bitrate_ladder_mbps"]
            rung = min(self.video_rung, len(ladder) - 1)
            scale = ladder[rung] / ladder[0]
            for _ in range(self._due(TrafficClass.VIDEO, conf["fps"], t)):
                self.frame_id += 1
                frame_bytes = max(int(conf["frame_bytes"] * scale), int(conf["mtu_bytes"]))
                parts = max(1, math.ceil(frame_bytes / conf["mtu_bytes"]))
                size = math.ceil(frame_bytes / parts)
                receiver = self.receivers[TrafficClass.VIDEO]
                receiver.frames_expected += 1
                for _part in range(parts):
                    self.seq[TrafficClass.VIDEO] += 1
                    packet = Packet(
                        uid=self._next_uid(),
                        traffic_class=TrafficClass.VIDEO,
                        seq=self.seq[TrafficClass.VIDEO],
                        size=size,
                        created_t=t,
                        deadline_t=t + conf["deadline_ms"] / 1000.0,
                        band=int(conf["band"]),
                        frame_id=self.frame_id,
                        frame_packets=parts,
                    )
                    receiver.sent += 1
                    out.append(packet)
        return out

    def bulk_offer_bytes(self) -> float:
        if TrafficClass.BULK not in self.enabled or self.bulk_paused:
            return 0.0
        if self.bulk_remaining <= 0:
            return 0.0
        rate = float(self.spec["bulk"]["offered_mbps"]) * 1e6 / 8.0
        return min(rate * self.dt, self.bulk_remaining)
