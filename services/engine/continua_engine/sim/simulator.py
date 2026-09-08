"""
The simulation loop.

One authoritative clock, stepped at a fixed `dt`. Each step: advance path
sessions, generate application traffic, enqueue it, drain the queues, deliver
what survives, account acknowledgements and timeouts, rebuild the windowed
observations from those receiver-side facts, and only then ask the controller
what to do.

The controller is handed observations. It is never handed the trace.
"""

from __future__ import annotations

import heapq
import math
import statistics
import uuid
from collections import deque
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone

from ..contracts import (
    ALL_CLASSES,
    ALL_LINKS,
    Action,
    ActionKind,
    ApplicationHealth,
    ClassHealth,
    ControllerState,
    EngineEvent,
    ExecutionMode,
    LinkId,
    LinkObservation,
    LinkPhase,
    PipelineStage,
    PolicyId,
    TrafficClass,
    VehicleObservation,
)
from ..controller.controller import POLICY_LIBRARY, ContinuaController
from .exogenous import ExogenousTrace, build_trace, link_profiles
from .network import ClassReceiver, LinkPath, OutstandingAck, Packet, TrafficPlant, VideoReceiver

#: Seconds with no carrying path before the transport session is considered lost.
SESSION_TIMEOUT_S = 3.0
#: How often an event is emitted when nothing notable happens.
EVENT_PERIOD_S = 0.1

HEALTH_WEIGHTS: dict[TrafficClass, float] = {
    TrafficClass.CONTROL: 0.40,
    TrafficClass.VOICE: 0.15,
    TrafficClass.TELEMETRY: 0.15,
    TrafficClass.VIDEO: 0.25,
    TrafficClass.BULK: 0.05,
}
HEALTH_DEFINITION = "app_health_v1"


@dataclass(slots=True)
class LinkStats:
    """Trailing per-link samples, all derived from acks and deliveries."""

    rtt: deque = field(default_factory=lambda: deque(maxlen=600))
    sent: deque = field(default_factory=lambda: deque(maxlen=6000))
    delivered: deque = field(default_factory=lambda: deque(maxlen=6000))
    bytes_delivered: deque = field(default_factory=lambda: deque(maxlen=6000))
    #: Jacobson/Karels smoothed RTT and variance, in seconds.
    srtt: float | None = None
    rttvar: float = 0.0

    def observe_rtt(self, sample_s: float) -> None:
        if self.srtt is None:
            self.srtt = sample_s
            self.rttvar = sample_s / 2.0
        else:
            self.rttvar = 0.75 * self.rttvar + 0.25 * abs(self.srtt - sample_s)
            self.srtt = 0.875 * self.srtt + 0.125 * sample_s

    def rto_s(self, floor_s: float) -> float:
        """Retransmission timeout, adapted per link.

        A fixed RTO is wrong here: the satellite path has a 620 ms base RTT, so
        a 120 ms timer retransmits every control packet forever, and the storm
        is what the queue then measures. This adapts and is clamped.
        """
        if self.srtt is None:
            return max(floor_s, 1.0)
        return min(max(self.srtt + 4 * self.rttvar, floor_s), 3.0)

    def prune(self, t: float, window: float) -> None:
        cutoff = t - window
        for series in (self.rtt, self.sent, self.delivered, self.bytes_delivered):
            while series and series[0][0] < cutoff:
                series.popleft()


@dataclass(slots=True)
class RunResult:
    run_id: str
    scenario_id: str
    policy_id: PolicyId
    seed: int
    mode: ExecutionMode
    duration_s: float
    events: list[EngineEvent]
    metrics: dict
    started_at: str
    finished_at: str


class Simulation:
    def __init__(
        self,
        scenario: dict,
        seed: int,
        policy_id: PolicyId = PolicyId.P1_CONTINUA,
        predictor_kind: str | None = None,
        horizon_s: float = 3.0,
        run_id: str | None = None,
        dt: float = 0.02,
        mode: ExecutionMode = ExecutionMode.SIMULATION,
    ) -> None:
        self.scenario = scenario
        self.seed = seed
        self.dt = dt
        self.mode = mode
        self.run_id = run_id or f"run-{uuid.uuid4().hex[:10]}"
        self.started_at = datetime.now(timezone.utc).isoformat()

        self.trace: ExogenousTrace = build_trace(scenario, seed, dt=dt)
        self.profiles = link_profiles()
        self.probing = self.profiles["probing"]
        self.window_s = float(self.probing["window_s"])
        self.min_samples = int(self.probing["min_samples"])

        # `slots=True` dataclasses have no __dict__; copy field by field.
        base_config = POLICY_LIBRARY[policy_id]
        self.config = replace(base_config)
        if predictor_kind is not None and self.config.predictor_kind != "none":
            self.config.predictor_kind = predictor_kind
        self.config.horizon_s = horizon_s
        self.controller = ContinuaController(self.config)

        self.paths: dict[LinkId, LinkPath] = {link: LinkPath(link, self.trace) for link in ALL_LINKS}
        self.plant = TrafficPlant(scenario["workload"], dt)
        self.stats: dict[LinkId, LinkStats] = {link: LinkStats() for link in ALL_LINKS}

        self.delivery_heap: list = []
        self.ack_heap: list = []
        self.t = 0.0
        self.step_index = 0
        self.seq = 0
        self.events: list[EngineEvent] = []
        self._last_event_t = -1.0

        self.session_id = f"{self.run_id}-S1"
        self.session_reconnects = 0
        self.outage_s = 0.0
        self.in_outage = False
        self._outage_started: float | None = None
        self.safe_stop = False
        self.interruptions: list[tuple[float, float]] = []

        self.last_decision = None
        self._duplicate_classes: set[TrafficClass] = set()
        self._last_video_rung = 0
        self._last_bulk_paused = False
        self._video_stall_last_check = 0.0
        self.finished = False

    # -- observation building ------------------------------------------------

    def _phase(self, link: LinkId, idx: int) -> LinkPhase:
        path = self.paths[link]
        if not path.usable(idx):
            return LinkPhase.UNAVAILABLE
        if path.activating_until is not None:
            return LinkPhase.ACTIVATING
        if path.validating_until is not None:
            return LinkPhase.VALIDATING
        if not path.activated:
            return LinkPhase.AVAILABLE
        if self.controller.carrying is link:
            return LinkPhase.CARRYING
        return LinkPhase.ACTIVE

    def _rssi_dbm(self, link: LinkId, idx: int) -> float | None:
        """Only Wi-Fi has an RSSI. Everything else returns None, on purpose."""
        profile = self.profiles["profiles"][link.value]
        if not profile.get("rssi_available"):
            return None
        quality = float(self.trace.quality[link][idx])
        if quality <= 0.0:
            return None
        edge = profile["rssi_at_edge_dbm"]
        full = profile["rssi_at_full_dbm"]
        return round(edge + (full - edge) * quality, 1)

    def _observe(self, idx: int) -> dict[LinkId, LinkObservation]:
        out: dict[LinkId, LinkObservation] = {}
        for link in ALL_LINKS:
            path = self.paths[link]
            stats = self.stats[link]
            stats.prune(self.t, self.window_s)

            rtt = jitter = loss = throughput = None
            samples = len(stats.rtt)
            if samples >= self.min_samples:
                values = [value for _t, value in stats.rtt]
                rtt = round(statistics.fmean(values), 2)
                mean = rtt
                jitter = round(statistics.fmean([abs(v - mean) for v in values]), 2)
            sent = sum(count for _t, count in stats.sent)
            delivered = sum(count for _t, count in stats.delivered)
            if sent >= self.min_samples:
                loss = round(100.0 * max(0.0, sent - delivered) / sent, 3)
            if stats.bytes_delivered:
                total_bytes = sum(b for _t, b in stats.bytes_delivered)
                throughput = round(total_bytes * 8 / self.window_s / 1e6, 3)

            out[link] = LinkObservation(
                link=link,
                phase=self._phase(link, idx),
                window_s=self.window_s,
                rtt_ms=rtt,
                jitter_ms=jitter,
                loss_pct=loss,
                throughput_mbps=throughput,
                rssi_dbm=self._rssi_dbm(link, idx),
                modelled_coverage=round(float(self.trace.quality[link][idx]), 4),
                queue_depth_bytes=int(path.queue_bytes + path.bulk_bytes),
                capacity_mbps=round(path.capacity_mbps(idx), 3) if path.usable(idx) else None,
                samples=samples,
                link_bytes=path.link_bytes,
            )
        return out

    def _class_health(self, cls: TrafficClass, receiver: ClassReceiver) -> ClassHealth:
        cutoff = self.t - self.window_s
        recent = [(t, lat) for t, lat, ok in receiver.window if t >= cutoff and ok]
        latencies = sorted(lat for _t, lat in recent)
        health = ClassHealth(
            traffic_class=cls,
            window_s=self.window_s,
            sent=receiver.sent,
            delivered=receiver.delivered,
            duplicates_suppressed=receiver.duplicates_suppressed,
        )
        if latencies:
            health.p50_latency_ms = round(latencies[len(latencies) // 2], 2)
            health.p95_latency_ms = round(latencies[min(len(latencies) - 1, int(len(latencies) * 0.95))], 2)
            health.p99_latency_ms = round(latencies[min(len(latencies) - 1, int(len(latencies) * 0.99))], 2)
        if receiver.deadline_eligible > 0:
            health.deadline_miss_pct = round(
                100.0 * receiver.deadline_misses / receiver.deadline_eligible, 3
            )
        if cls is TrafficClass.TELEMETRY and receiver.last_arrival_t is not None:
            health.freshness_ms = round((self.t - receiver.last_arrival_t) * 1000.0, 1)
        if cls is TrafficClass.VIDEO and isinstance(receiver, VideoReceiver):
            health.stall_ms = round(receiver.stall_ms, 1)
            health.frames_delivered = receiver.frames_delivered
            health.frames_expected = receiver.frames_expected
            threshold_s = float(self.plant.spec["video"]["stall_threshold_ms"]) / 1000.0
            last_frame = receiver.last_frame_t if receiver.last_frame_t is not None else 0.0
            health.stalled_now = (self.t - last_frame) > threshold_s
        if cls is TrafficClass.BULK:
            health.bytes_completed = int(receiver.bytes_completed)
        if self.t > 0:
            health.goodput_mbps = round(receiver.goodput_bytes * 8 / max(self.t, 1e-6) / 1e6, 3)
        return health

    def _attainment(self, cls: TrafficClass, health: ClassHealth) -> float | None:
        """Per-class 0..1 attainment feeding `app_health_v1`. See docs/METRICS.md."""
        if cls in (TrafficClass.CONTROL, TrafficClass.VOICE, TrafficClass.TELEMETRY):
            if health.deadline_miss_pct is None:
                return None
            return max(0.0, 1.0 - health.deadline_miss_pct / 100.0)
        if cls is TrafficClass.VIDEO:
            if health.frames_expected == 0:
                return None
            return min(1.0, health.frames_delivered / health.frames_expected)
        if cls is TrafficClass.BULK:
            offered = float(self.profiles["workload"]["bulk"]["offered_mbps"])
            if health.goodput_mbps is None or offered <= 0:
                return None
            return min(1.0, health.goodput_mbps / offered)
        return None

    def _app_health(self) -> ApplicationHealth:
        classes: dict[TrafficClass, ClassHealth] = {}
        numerator = 0.0
        denominator = 0.0
        for cls in ALL_CLASSES:
            receiver = self.plant.receivers.get(cls)
            if receiver is None:
                continue
            health = self._class_health(cls, receiver)
            classes[cls] = health
            attainment = self._attainment(cls, health)
            if attainment is not None:
                weight = HEALTH_WEIGHTS[cls]
                numerator += weight * attainment
                denominator += weight
        score = round(100.0 * numerator / denominator, 1) if denominator > 0 else None
        return ApplicationHealth(
            window_s=self.window_s,
            classes=classes,
            health_score=score,
            health_definition=HEALTH_DEFINITION,
            session_id=self.session_id,
            session_reconnects=self.session_reconnects,
            outage_s=round(self.outage_s, 3),
            in_outage=self.in_outage,
            safe_stop=self.safe_stop,
        )

    # -- data plane ----------------------------------------------------------

    def _send(self, packet: Packet, link: LinkId, attempts: int = 1) -> None:
        path = self.paths[link]
        packet.sent_t = self.t
        packet.link = link
        # A tail-dropped packet is still a transmission attempt as far as this
        # link's loss statistics are concerned.
        self.stats[link].sent.append((self.t, 1))
        if not path.enqueue(packet):
            return
        conf = self.plant.spec.get(packet.traffic_class.value, {})
        if packet.is_probe or conf.get("acked"):
            floor = float(conf.get("retransmit_timeout_ms", 300.0)) / 1000.0
            rto = self.stats[link].rto_s(floor)
            self.plant.outstanding[packet.uid] = OutstandingAck(
                packet=packet, sent_t=self.t, timeout_t=self.t + rto, attempts=attempts
            )

    def _deliver_due(self) -> None:
        while self.delivery_heap and self.delivery_heap[0][0] <= self.t:
            arrival, _uid, packet = heapq.heappop(self.delivery_heap)
            link = packet.link
            if link is not None:
                self.stats[link].delivered.append((arrival, 1))
                self.stats[link].bytes_delivered.append((arrival, packet.size))
            if packet.is_probe:
                heapq.heappush(self.ack_heap, (arrival + self._return_delay(link), packet.uid))
                continue
            receiver = self.plant.receivers.get(packet.traffic_class)
            if receiver is None:
                continue
            if packet.traffic_class is TrafficClass.VIDEO and isinstance(receiver, VideoReceiver):
                receiver.accept(packet, arrival)
                receiver.accept_frame_part(packet, arrival)
            else:
                receiver.accept(packet, arrival)
            conf = self.plant.spec.get(packet.traffic_class.value, {})
            if conf.get("acked"):
                heapq.heappush(self.ack_heap, (arrival + self._return_delay(link), packet.uid))

    def _return_delay(self, link: LinkId | None) -> float:
        if link is None:
            return 0.05
        return self.paths[link].one_way_ms(self.step_index) / 1000.0

    def _process_acks(self) -> None:
        while self.ack_heap and self.ack_heap[0][0] <= self.t:
            ack_t, uid = heapq.heappop(self.ack_heap)
            entry = self.plant.outstanding.pop(uid, None)
            if entry is None:
                continue
            link = entry.packet.link
            if link is not None:
                sample_s = ack_t - entry.sent_t
                self.stats[link].rtt.append((ack_t, sample_s * 1000.0))
                self.stats[link].observe_rtt(sample_s)

    def _process_timeouts(self) -> None:
        expired = [uid for uid, entry in self.plant.outstanding.items() if entry.timeout_t <= self.t]
        for uid in expired:
            entry = self.plant.outstanding.pop(uid)
            if entry.packet.is_probe:
                # Probes are fire-and-forget: a lost probe is a loss sample, not
                # something to retransmit.
                continue
            self.plant.control_timeouts += 1
            conf = self.plant.spec.get(entry.packet.traffic_class.value, {})
            max_retx = int(conf.get("max_retransmits", 0))
            past_deadline = entry.packet.deadline_t is not None and self.t > entry.packet.deadline_t
            if entry.attempts <= max_retx and not past_deadline and self.controller.carrying is not None:
                self.plant.control_retransmits += 1
                retry = Packet(
                    uid=self.plant._next_uid(),
                    traffic_class=entry.packet.traffic_class,
                    seq=entry.packet.seq,
                    size=entry.packet.size,
                    created_t=entry.packet.created_t,
                    deadline_t=entry.packet.deadline_t,
                    band=entry.packet.band,
                    is_retransmit=True,
                )
                self._send(retry, self.controller.carrying, attempts=entry.attempts + 1)

    def _emit_probes(self) -> None:
        period = 1.0 / float(self.probing["probe_hz"])
        if self.t - getattr(self, "_last_probe_t", -99.0) < period:
            return
        self._last_probe_t = self.t
        for link, path in self.paths.items():
            if not path.activated:
                continue
            packet = Packet(
                uid=self.plant._next_uid(),
                traffic_class=TrafficClass.CONTROL,
                seq=-1,
                size=int(self.probing["probe_bytes"]),
                created_t=self.t,
                deadline_t=None,
                band=0,
                is_probe=True,
            )
            self._send(packet, link)

    def _update_video_stall(self) -> None:
        receiver = self.plant.receivers.get(TrafficClass.VIDEO)
        if not isinstance(receiver, VideoReceiver):
            return
        threshold = float(self.plant.spec["video"]["stall_threshold_ms"]) / 1000.0
        last = receiver.last_frame_t if receiver.last_frame_t is not None else 0.0
        if self.t - last > threshold:
            receiver.stall_ms += self.dt * 1000.0

    def _update_session(self, carrying: LinkId | None) -> None:
        has_path = carrying is not None and self.paths[carrying].activated
        if not has_path:
            if self._outage_started is None:
                self._outage_started = self.t
            self.outage_s += self.dt
            self.in_outage = True
            if self.t - self._outage_started >= SESSION_TIMEOUT_S and not self.safe_stop:
                self.safe_stop = True
        else:
            if self._outage_started is not None:
                duration = self.t - self._outage_started
                self.interruptions.append((self._outage_started, duration))
                if duration >= SESSION_TIMEOUT_S:
                    self.session_reconnects += 1
                    self.session_id = f"{self.run_id}-S{self.session_reconnects + 1}"
                self._outage_started = None
            self.in_outage = False
            self.safe_stop = False

    # -- the step ------------------------------------------------------------

    def step(self) -> EngineEvent | None:
        if self.finished:
            return None
        idx = min(self.step_index, self.trace.steps - 1)
        self.t = self.step_index * self.dt

        for path in self.paths.values():
            path.tick_session(self.t, idx)

        decision = self.last_decision
        carrying = decision.carrying if decision else None

        # --- generate and place traffic --------------------------------------
        if carrying is not None and self.paths[carrying].activated:
            backup = next(
                (link for link in decision.want_active if link != carrying and self.paths[link].carrying_ready),
                None,
            )
            for packet in self.plant.generate(self.t):
                self._send(packet, carrying)
                if packet.traffic_class in self._duplicate_classes and backup is not None:
                    twin = Packet(
                        uid=self.plant._next_uid(),
                        traffic_class=packet.traffic_class,
                        seq=packet.seq,
                        size=packet.size,
                        created_t=packet.created_t,
                        deadline_t=packet.deadline_t,
                        band=packet.band,
                        is_duplicate=True,
                    )
                    self._send(twin, backup)
            offered = self.plant.bulk_offer_bytes()
            if offered > 0:
                accepted = self.paths[carrying].offer_bulk(offered)
                self.plant.bulk_remaining -= accepted
        else:
            # Nothing can be sent. The generator still runs so `sent` counts
            # reflect application demand, and everything it produces is lost.
            for packet in self.plant.generate(self.t):
                receiver = self.plant.receivers.get(packet.traffic_class)
                if receiver is not None and packet.deadline_t is not None:
                    receiver.deadline_eligible += 1
                    receiver.deadline_misses += 1

        self._emit_probes()

        # --- move bytes -------------------------------------------------------
        for link, path in self.paths.items():
            bulk_delivered = path.drain(self.t, self.dt, idx, self.delivery_heap)
            if bulk_delivered > 0:
                receiver = self.plant.receivers.get(TrafficClass.BULK)
                if receiver is not None:
                    receiver.bytes_completed += bulk_delivered
                    receiver.goodput_bytes += int(bulk_delivered)
                self.stats[link].bytes_delivered.append((self.t, int(bulk_delivered)))

        self._deliver_due()
        self._process_acks()
        self._process_timeouts()
        self._update_video_stall()

        # --- decide -----------------------------------------------------------
        observations = self._observe(idx)
        # The controller does not read application health; building five
        # ClassHealth models every 20 ms just to discard them cost more than the
        # rest of the step combined. It is computed when an event is emitted.
        sample = VehicleObservation(
            distance_m=round(float(self.trace.distance_m[idx]), 2),
            speed_mps=round(float(self.trace.speed_mps[idx]), 3),
            heading_rad=round(float(self.trace.heading[idx]), 4),
            zone=self.trace.zone[idx],
        )
        decision = self.controller.decide(self.t, observations, None, sample)
        self.last_decision = decision
        self._duplicate_classes = decision.duplicate_classes
        self.plant.video_rung = decision.video_rung
        self.plant.bulk_paused = decision.bulk_paused

        # --- apply session intent ---------------------------------------------
        for link, path in self.paths.items():
            if link in decision.want_active:
                if path.usable(idx):
                    path.request_activation(self.t)
            elif path.activated and link != decision.carrying:
                path.release()

        self._update_session(decision.carrying)

        # --- emit --------------------------------------------------------------
        # A throttle that is still in force is not news. Emitting it every step
        # buried the genuinely notable events under thousands of repeats.
        changed_shaping = (
            decision.video_rung != self._last_video_rung
            or decision.bulk_paused != self._last_bulk_paused
        )
        if not changed_shaping:
            decision.actions = [
                a for a in decision.actions if a.kind is not ActionKind.THROTTLE_CLASS
            ]
        self._last_video_rung = decision.video_rung
        self._last_bulk_paused = decision.bulk_paused

        notable = bool(decision.actions)
        due = self.t - self._last_event_t >= EVENT_PERIOD_S
        event: EngineEvent | None = None
        if notable or due or self.step_index == 0:
            self._last_event_t = self.t
            self.seq += 1
            app = self._app_health()
            action = decision.actions[0] if decision.actions else Action(kind=ActionKind.NONE)
            stage = PipelineStage.STEER if decision.actions else PipelineStage.OBSERVE
            if not decision.actions and decision.prediction and decision.prediction.violation_expected:
                stage = PipelineStage.PREDICT
            event = EngineEvent(
                run_id=self.run_id,
                mode=self.mode,
                seq=self.seq,
                t=round(self.t, 4),
                stage=stage,
                controller_state=decision.state,
                carrying=decision.carrying,
                links=observations,
                vehicle=sample,
                app=app,
                prediction=decision.prediction,
                action=action,
                reason=decision.reason,
                policy_id=self.config.policy_id,
                scenario_id=self.scenario["id"],
            )
            self.events.append(event)

        self.step_index += 1
        if self.t >= self.trace.duration_s:
            self.finished = True
        return event

    def run(self) -> RunResult:
        while not self.finished:
            self.step()
        from ..experiments.metrics import compute_metrics

        return RunResult(
            run_id=self.run_id,
            scenario_id=self.scenario["id"],
            policy_id=self.config.policy_id,
            seed=self.seed,
            mode=self.mode,
            duration_s=self.trace.duration_s,
            events=self.events,
            metrics=compute_metrics(self),
            started_at=self.started_at,
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
