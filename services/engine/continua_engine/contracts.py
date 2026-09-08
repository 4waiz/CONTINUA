"""
CONTINUA engine contracts.

The authoritative schema. `packages/contracts/src/engine.ts` mirrors these
shapes for the frontend and is validated at the boundary — if the two drift, the
frontend rejects the payload rather than rendering something invented.

Design rules that show up throughout:

* A measurement that does not exist is ``None``, never ``0``. The dashboard
  renders ``None`` as "unavailable", which is a different statement from "zero".
* Every metric carries the window it was measured over.
* Every action carries the observations it was based on, the policy version and
  which predictor produced the prediction. Explanations are recorded at decision
  time, never reconstructed afterwards.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, NonNegativeFloat, NonNegativeInt

SCHEMA_VERSION = "2.0.0"
POLICY_VERSION = "continua-policy-1.2.0"


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class LinkId(str, Enum):
    WIRED = "wired"
    WIFI = "wifi"
    CELLULAR = "cellular"
    SATELLITE = "satellite"


ALL_LINKS: tuple[LinkId, ...] = (LinkId.WIRED, LinkId.WIFI, LinkId.CELLULAR, LinkId.SATELLITE)


class ExecutionMode(str, Enum):
    """How a run was produced. Never inferred, always recorded."""

    SIMULATION = "simulation"
    EMULATION = "emulation"
    REPLAY = "replay"


class TrafficClass(str, Enum):
    CONTROL = "control"
    TELEMETRY = "telemetry"
    VIDEO = "video"
    VOICE = "voice"
    BULK = "bulk"


ALL_CLASSES: tuple[TrafficClass, ...] = (
    TrafficClass.CONTROL,
    TrafficClass.TELEMETRY,
    TrafficClass.VIDEO,
    TrafficClass.VOICE,
    TrafficClass.BULK,
)


class ControllerState(str, Enum):
    STABLE = "stable"
    AT_RISK = "at_risk"
    WARMING_BACKUP = "warming_backup"
    VALIDATING_BACKUP = "validating_backup"
    SWITCHING = "switching"
    RECOVERING = "recovering"
    DEGRADED = "degraded"
    DISCONNECTED = "disconnected"


class PipelineStage(str, Enum):
    OBSERVE = "observe"
    PREDICT = "predict"
    PREPARE = "prepare"
    STEER = "steer"
    EXPLAIN = "explain"


class LinkPhase(str, Enum):
    """Physical/session state of one path, as the controller sees it."""

    UNAVAILABLE = "unavailable"
    AVAILABLE = "available"
    ACTIVATING = "activating"
    VALIDATING = "validating"
    ACTIVE = "active"
    CARRYING = "carrying"


class PolicyId(str, Enum):
    B0_SINGLE_REACTIVE = "B0"
    B1_REACTIVE_MULTIPATH = "B1"
    B2_ALWAYS_REDUNDANT = "B2"
    P1_CONTINUA = "P1"
    P1_NO_PREDICTION = "P1-noPred"
    P1_NO_APP_PRIORITY = "P1-noApp"


# ---------------------------------------------------------------------------
# Observations
# ---------------------------------------------------------------------------


class LinkObservation(BaseModel):
    """What the controller can see about one path at one instant.

    Everything here is derived from delivered/acknowledged/timed-out packets in
    the trailing window. Nothing reads the exogenous trace directly — that would
    leak the future into the policy.
    """

    link: LinkId
    phase: LinkPhase
    #: Trailing window these statistics were computed over.
    window_s: float
    #: Smoothed round-trip time from acknowledged probes and control packets.
    rtt_ms: float | None = None
    #: Mean absolute RTT deviation over the window.
    jitter_ms: float | None = None
    #: Delivered/sent over the window, as a percentage. ``None`` before enough samples.
    loss_pct: float | None = None
    #: Application goodput carried by this path over the window.
    throughput_mbps: float | None = None
    #: Only Wi-Fi reports RSSI. Every other link reports ``None`` — they have no
    #: equivalent measurement, and inventing one would be dishonest.
    rssi_dbm: float | None = None
    #: Modelled radio/coverage quality 0..1 (simulation only, labelled as modelled).
    modelled_coverage: float | None = None
    queue_depth_bytes: NonNegativeInt = 0
    capacity_mbps: float | None = None
    #: Samples backing these statistics. Below `min_samples` the stats are None.
    samples: NonNegativeInt = 0
    #: Cumulative bytes actually put on this link, including duplicates/probes.
    link_bytes: NonNegativeInt = 0


class VehicleObservation(BaseModel):
    """Motion signals available to the predictor. No future positions."""

    distance_m: float
    speed_mps: float
    heading_rad: float
    zone: str


# ---------------------------------------------------------------------------
# Application health
# ---------------------------------------------------------------------------


class ClassHealth(BaseModel):
    """Receiver-derived performance for one traffic class.

    All of it comes from the receiver's own logs — arrivals, acknowledgements
    and timeouts — never from the sender's intent.
    """

    traffic_class: TrafficClass
    window_s: float
    sent: NonNegativeInt = 0
    delivered: NonNegativeInt = 0
    duplicates_suppressed: NonNegativeInt = 0
    #: Deadline misses as a percentage of packets that had a deadline.
    deadline_miss_pct: float | None = None
    p50_latency_ms: float | None = None
    p95_latency_ms: float | None = None
    p99_latency_ms: float | None = None
    #: Telemetry only: age of the newest sample the receiver holds.
    freshness_ms: float | None = None
    #: Video only: cumulative milliseconds with no decodable frame.
    stall_ms: float | None = None
    #: Video only: whether the stream is stalled *at this instant*. Published by
    #: the receiver so the UI never has to infer it from frame-count history.
    stalled_now: bool | None = None
    frames_delivered: NonNegativeInt = 0
    frames_expected: NonNegativeInt = 0
    #: Bytes usefully delivered to the application (excludes duplicates).
    goodput_mbps: float | None = None
    #: Bulk only.
    bytes_completed: NonNegativeInt = 0


class ApplicationHealth(BaseModel):
    """Aggregate application state.

    ``health_score`` replaces the reference mock's unexplained "96 QoS score".
    Its definition lives in ``docs/METRICS.md`` and in `health.py`; it is a
    weighted mean of per-class deadline attainment, and it is reproducible from
    the receiver logs alone.
    """

    window_s: float
    classes: dict[TrafficClass, ClassHealth] = Field(default_factory=dict)
    health_score: float | None = None
    health_definition: str = "app_health_v1"
    #: Session identity. Continuity is reported separately from deadline health.
    session_id: str
    session_reconnects: NonNegativeInt = 0
    #: Cumulative seconds with no usable path at all.
    outage_s: float = 0.0
    in_outage: bool = False
    safe_stop: bool = False


# ---------------------------------------------------------------------------
# Prediction and action
# ---------------------------------------------------------------------------


class Prediction(BaseModel):
    """A forecast of a threshold violation on the carrying path."""

    predictor: str
    #: Seconds ahead this prediction refers to.
    horizon_s: float
    #: True when a violation of `threshold` is forecast within the horizon.
    violation_expected: bool
    #: Raw model/heuristic score. Only a probability when `calibrated` is true.
    score: float | None = None
    calibrated: bool = False
    threshold: str = ""
    #: Features actually used, recorded so a decision can be re-derived.
    features: dict[str, float] = Field(default_factory=dict)


class ActionKind(str, Enum):
    NONE = "none"
    ACTIVATE_BACKUP = "activate_backup"
    VALIDATE_BACKUP = "validate_backup"
    SWITCH = "switch"
    START_DUPLICATION = "start_duplication"
    STOP_DUPLICATION = "stop_duplication"
    THROTTLE_CLASS = "throttle_class"
    RESTORE_CLASS = "restore_class"
    RELEASE_BACKUP = "release_backup"
    SAFE_STOP = "safe_stop"
    RESUME = "resume"


class Action(BaseModel):
    kind: ActionKind
    link: LinkId | None = None
    traffic_class: TrafficClass | None = None
    detail: dict[str, float | str | bool] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# The event
# ---------------------------------------------------------------------------


class EngineEvent(BaseModel):
    """One record in the run log. JSONL, one per line, append-only."""

    schema_version: str = SCHEMA_VERSION
    run_id: str
    mode: ExecutionMode
    #: Monotonic per run. The frontend uses it to drop duplicates and to detect
    #: gaps caused by a reconnect.
    seq: NonNegativeInt
    #: Authoritative experiment clock, seconds since run start.
    t: float
    wall_clock: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    stage: PipelineStage
    controller_state: ControllerState
    carrying: LinkId | None = None
    links: dict[LinkId, LinkObservation] = Field(default_factory=dict)
    vehicle: VehicleObservation | None = None
    app: ApplicationHealth | None = None
    prediction: Prediction | None = None
    action: Action | None = None
    #: Recorded when the decision is made, not reconstructed afterwards.
    reason: str = ""
    policy_version: str = POLICY_VERSION
    policy_id: PolicyId = PolicyId.P1_CONTINUA
    scenario_id: str = ""


# ---------------------------------------------------------------------------
# Runs and scenarios
# ---------------------------------------------------------------------------


class RunStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class RunSummary(BaseModel):
    run_id: str
    mode: ExecutionMode
    scenario_id: str
    policy_id: PolicyId
    seed: int
    status: RunStatus
    started_at: str
    finished_at: str | None = None
    duration_s: float | None = None
    events: NonNegativeInt = 0
    #: Present only for replay runs: what was originally recorded.
    source_mode: ExecutionMode | None = None
    source_run_id: str | None = None
    recorded_at: str | None = None
    code_commit: str | None = None
    engine_version: str = SCHEMA_VERSION
    notes: str = ""


class RunControl(BaseModel):
    scenario_id: str
    policy_id: PolicyId = PolicyId.P1_CONTINUA
    seed: int = Field(default=1, ge=0, le=2**31 - 1)
    mode: ExecutionMode = ExecutionMode.SIMULATION
    #: Wall-clock seconds per simulated second. 0 = as fast as possible.
    speed: float = Field(default=1.0, ge=0.0, le=64.0)
    predictor: Literal["heuristic", "learned", "none"] = "heuristic"
    horizon_s: float = Field(default=3.0, ge=0.5, le=15.0)


class ScenarioOverrides(BaseModel):
    """Scenario Lab knobs. Every field is validated and range-checked."""

    duration_s: float | None = Field(default=None, ge=5.0, le=600.0)
    speed_scale: float | None = Field(default=None, ge=0.2, le=3.0)
    workload: dict[TrafficClass, bool] | None = None
    inject_fault: LinkId | None = None
    inject_fault_at_s: float | None = Field(default=None, ge=0.0, le=600.0)
    inject_fault_duration_s: float | None = Field(default=None, ge=0.5, le=300.0)
    congest_link: LinkId | None = None
    congest_factor: float | None = Field(default=None, ge=0.05, le=1.0)
