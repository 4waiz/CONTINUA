"""
The CONTINUA controller: Observe → Predict → Prepare → Steer → Explain.

Every policy under comparison is implemented here behind one interface, so the
baselines and CONTINUA differ only in the flags set in `PolicyConfig` - not in
which code path they take through the simulator. That is deliberate: it removes
the most common way a comparison quietly stops being fair.

The controller sees only `LinkObservation`s (derived from delivered,
acknowledged and timed-out packets) and `ApplicationHealth` (derived from
receiver logs). It has no access to the exogenous trace.

Phase 4 adds two mechanisms, each behind a flag that defaults to off so that
every pre-Phase-4 policy is byte-for-byte unchanged
(`tests/engine/test_regression_guard.py`):

* **Per-class steering** (`per_class_steering`): each deadline class may ride a
  different *active* path from the session's primary path. The rule, per
  class: among active paths whose measured RTT and loss meet the class
  deadline, take the cheapest; if none meets it, the best-scoring active path.
  The session's primary path and its continuity semantics do not change
  (docs/METRICS.md section 4).
* **Mode handover** (`mode_handover`): the control class has an operating mode
  - teleop, waypoint or safe_hold - chosen from receiver-side measurements of
  the path control is on. Downshift when that path cannot support the current
  mode (or, with `anticipate_mode`, ahead of a predicted violation and before
  moving control onto a path that cannot support it); upshift only after the
  higher mode has been supported for `mode_up_hold_s`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..contracts import (
    ALL_CLASSES,
    ALL_LINKS,
    MODE_RANK,
    Action,
    ActionKind,
    ApplicationHealth,
    ControlMode,
    ControllerState,
    LinkId,
    LinkObservation,
    LinkPhase,
    PolicyId,
    Prediction,
    TrafficClass,
    VehicleObservation,
)
from ..sim.exogenous import link_profiles
from .modes import (
    DEADLINE_MODES,
    describe,
    highest_supported,
    mode_projected_violation,
    mode_supported,
    mode_table,
    projected_violation,
)
from .predictors import (
    LOSS_VIOLATION_PCT,
    RTT_VIOLATION_MS,
    BasePredictor,
    LinkHistory,
    NullPredictor,
    make_predictor,
)

#: Preference when several links are usable. Lower is better.
LINK_PREFERENCE: dict[LinkId, int] = {
    LinkId.WIRED: 0,
    LinkId.WIFI: 1,
    LinkId.CELLULAR: 2,
    LinkId.SATELLITE: 3,
}

#: Traffic classes that carry a deadline and may therefore be steered onto a
#: path of their own. Bulk has no deadline and always rides the primary path.
STEERABLE_CLASSES: tuple[TrafficClass, ...] = (
    TrafficClass.CONTROL,
    TrafficClass.VOICE,
    TrafficClass.TELEMETRY,
    TrafficClass.VIDEO,
)

#: Path phases that can carry traffic right now.
_READY_PHASES = (LinkPhase.ACTIVE, LinkPhase.CARRYING)


@dataclass(slots=True)
class PolicyConfig:
    """What distinguishes one policy from another. Nothing else does."""

    policy_id: PolicyId
    #: May more than one path be activated at a time?
    multipath: bool = True
    #: Keep a backup warm before anything has gone wrong?
    proactive_warm: bool = False
    #: Act on predictions, not just on measured violations?
    use_prediction: bool = False
    #: Keep every usable path activated at all times (B2).
    always_redundant: bool = False
    #: Differentiate behaviour per traffic class?
    app_aware: bool = True
    #: Seconds a link must be carrying before it may be replaced.
    min_dwell_s: float = 4.0
    #: A candidate must beat the incumbent by this much to be worth the switch.
    switch_margin: float = 0.18
    #: Risk must persist this long before the controller acts on it, so one
    #: noisy observation window cannot trigger a handover.
    risk_debounce_s: float = 0.4
    predictor_kind: str = "none"
    horizon_s: float = 3.0

    # -- Phase 4. Every flag defaults to off; a policy that sets none of them
    # -- behaves exactly as it did before Phase 4 (regression guard).
    #: Pause bulk transfer with the app-aware rule, and nothing else app-aware
    #: (B2-defer isolates how much of the satellite saving is bulk deferral).
    defer_bulk: bool = False
    #: Let each deadline class ride its own active path.
    per_class_steering: bool = False
    #: Choose a control operating mode from receiver-side measurements.
    mode_handover: bool = False
    #: Downshift ahead of a predicted violation and before moving control onto
    #: a path that cannot support the current mode. Off = react only to a
    #: measured violation on the path control is actually using.
    anticipate_mode: bool = True
    #: A higher mode must have been supported this long before an upshift.
    #: Chosen on the tune seed block by the rule declared in
    #: scripts/phase4_tune.py (grid 1, 2, 3, 5 s); see docs/PHASE_4_RESULTS.md.
    mode_up_hold_s: float = 1.0
    #: A class stays on a path it was steered to for at least this long before
    #: it may be moved again for cost; it moves at once if the path fails.
    class_dwell_s: float = 2.0
    #: A class leaves a path that is still ready to carry only once that path
    #: has failed the class's criterion for this long, so one noisy window
    #: cannot bounce a class between two links. Tuned with the hold (grid
    #: 0.3, 0.6, 1.0 s, shared with `mode_down_debounce_s`).
    class_leave_debounce_s: float = 0.3
    #: A measured downshift on a path that is still ready to carry waits this
    #: long for the condition to persist. A path that cannot carry at all, or
    #: a path control is about to be moved onto, is judged at once.
    mode_down_debounce_s: float = 0.3


POLICY_LIBRARY: dict[PolicyId, PolicyConfig] = {
    PolicyId.B0_SINGLE_REACTIVE: PolicyConfig(
        policy_id=PolicyId.B0_SINGLE_REACTIVE,
        multipath=False,
        proactive_warm=False,
        use_prediction=False,
        app_aware=False,
        min_dwell_s=2.0,
        predictor_kind="none",
    ),
    PolicyId.B1_REACTIVE_MULTIPATH: PolicyConfig(
        policy_id=PolicyId.B1_REACTIVE_MULTIPATH,
        multipath=True,
        proactive_warm=False,
        use_prediction=False,
        app_aware=False,
        min_dwell_s=3.0,
        predictor_kind="none",
    ),
    PolicyId.B2_ALWAYS_REDUNDANT: PolicyConfig(
        policy_id=PolicyId.B2_ALWAYS_REDUNDANT,
        multipath=True,
        proactive_warm=True,
        use_prediction=False,
        always_redundant=True,
        app_aware=False,
        min_dwell_s=2.0,
        predictor_kind="none",
    ),
    PolicyId.P1_CONTINUA: PolicyConfig(
        policy_id=PolicyId.P1_CONTINUA,
        multipath=True,
        proactive_warm=True,
        use_prediction=True,
        app_aware=True,
        min_dwell_s=4.0,
        predictor_kind="heuristic",
    ),
    PolicyId.P1_NO_PREDICTION: PolicyConfig(
        policy_id=PolicyId.P1_NO_PREDICTION,
        multipath=True,
        proactive_warm=True,
        use_prediction=False,
        app_aware=True,
        min_dwell_s=4.0,
        predictor_kind="none",
    ),
    PolicyId.P1_NO_APP_PRIORITY: PolicyConfig(
        policy_id=PolicyId.P1_NO_APP_PRIORITY,
        multipath=True,
        proactive_warm=True,
        use_prediction=True,
        app_aware=False,
        min_dwell_s=4.0,
        predictor_kind="heuristic",
    ),
    # ---- Phase 4 -----------------------------------------------------------
    # B2 plus bulk deferral only. Exists so the satellite-byte saving can be
    # split into "paused bulk" and "everything else application-aware".
    PolicyId.B2_ALWAYS_REDUNDANT_DEFER: PolicyConfig(
        policy_id=PolicyId.B2_ALWAYS_REDUNDANT_DEFER,
        multipath=True,
        proactive_warm=True,
        use_prediction=False,
        always_redundant=True,
        app_aware=False,
        min_dwell_s=2.0,
        predictor_kind="none",
        defer_bulk=True,
    ),
    # P1 plus both new mechanisms.
    PolicyId.P2_CONTINUA: PolicyConfig(
        policy_id=PolicyId.P2_CONTINUA,
        multipath=True,
        proactive_warm=True,
        use_prediction=True,
        app_aware=True,
        min_dwell_s=4.0,
        predictor_kind="heuristic",
        per_class_steering=True,
        mode_handover=True,
    ),
    PolicyId.P2_NO_STEER: PolicyConfig(
        policy_id=PolicyId.P2_NO_STEER,
        multipath=True,
        proactive_warm=True,
        use_prediction=True,
        app_aware=True,
        min_dwell_s=4.0,
        predictor_kind="heuristic",
        per_class_steering=False,
        mode_handover=True,
    ),
    PolicyId.P2_NO_MODE: PolicyConfig(
        policy_id=PolicyId.P2_NO_MODE,
        multipath=True,
        proactive_warm=True,
        use_prediction=True,
        app_aware=True,
        min_dwell_s=4.0,
        predictor_kind="heuristic",
        per_class_steering=True,
        mode_handover=False,
    ),
    # Mode changes only after a measured violation on the path control is on.
    PolicyId.P2_REACTIVE_MODE: PolicyConfig(
        policy_id=PolicyId.P2_REACTIVE_MODE,
        multipath=True,
        proactive_warm=True,
        use_prediction=True,
        app_aware=True,
        min_dwell_s=4.0,
        predictor_kind="heuristic",
        per_class_steering=True,
        mode_handover=True,
        anticipate_mode=False,
    ),
}


@dataclass(slots=True)
class ControllerDecision:
    state: ControllerState
    carrying: LinkId | None
    actions: list[Action]
    reason: str
    prediction: Prediction | None
    #: Links the controller wants activated this step.
    want_active: set[LinkId] = field(default_factory=set)
    #: Classes to duplicate across carrying + best backup.
    duplicate_classes: set[TrafficClass] = field(default_factory=set)
    video_rung: int = 0
    bulk_paused: bool = False
    #: Phase 4: the active path each class rides. Every class rides `carrying`
    #: unless `per_class_steering` moved it. Empty when there is no path.
    class_paths: dict[TrafficClass, LinkId] = field(default_factory=dict)
    #: Phase 4: operating mode of the control class.
    control_mode: ControlMode = ControlMode.TELEOP


class ContinuaController:
    def __init__(self, config: PolicyConfig, predictor: BasePredictor | None = None) -> None:
        self.config = config
        self.predictor = predictor or make_predictor(config.predictor_kind)
        if not config.use_prediction:
            self.predictor = NullPredictor()

        self.state = ControllerState.STABLE
        self.carrying: LinkId | None = None
        self.carrying_since = 0.0
        self.history: dict[LinkId, LinkHistory] = {link: LinkHistory() for link in ALL_LINKS}

        #: Counters used by the experiment metrics, incremented only when the
        #: corresponding action is actually emitted.
        self.handovers = 0
        self.unnecessary_handovers = 0
        self.backup_activations = 0
        self.duplication_windows = 0
        self.predictions_made = 0
        self.predicted_violations = 0
        self._last_switch_t = -99.0
        self._duplicating = False
        self._risk_since: float | None = None
        self._last_reason = ""

        # -- Phase 4 state ---------------------------------------------------
        # Static tables from link_profiles.json: class deadlines and the
        # per-megabyte tariff. These are declared assumptions, not
        # observations, and nothing here reads the exogenous trace.
        workload = link_profiles()["workload"]
        profiles = link_profiles()["profiles"]
        self._class_deadline_ms: dict[TrafficClass, float] = {
            cls: float(workload[cls.value]["deadline_ms"]) for cls in STEERABLE_CLASSES
        }
        self._cost_per_mb: dict[LinkId, float] = {
            link: float(profiles[link.value]["cost_per_mb"]) for link in ALL_LINKS
        }
        self.class_paths: dict[TrafficClass, LinkId] = {}
        self._class_since: dict[TrafficClass, float] = {}
        self._class_bad_since: dict[TrafficClass, float | None] = {}
        self._ready_since: dict[LinkId, float | None] = {link: None for link in ALL_LINKS}
        self._level_ok_since: dict[tuple[str, LinkId], float | None] = {}
        self.control_mode = ControlMode.TELEOP
        #: How long each path has continuously supported each deadline mode,
        #: kept per path from its own probes and acknowledgements so that
        #: moving control onto a path that has long been measured capable does
        #: not start the hold clock from zero.
        self._support_since: dict[tuple[LinkId, ControlMode], float | None] = {
            (link, mode): None for link in ALL_LINKS for mode in DEADLINE_MODES
        }
        self._mode_risk_since: float | None = None
        self._mode_bad_since: float | None = None
        self._last_mode_change_t = -99.0
        self._ever_carried = False
        self.mode_changes = 0
        self.anticipated_mode_changes = 0
        self.late_mode_changes = 0
        self.class_steers = 0

    # -- helpers -------------------------------------------------------------

    @staticmethod
    def _violating(obs: LinkObservation) -> bool:
        """A *measured* violation, not a predicted one."""
        if obs.phase is LinkPhase.UNAVAILABLE:
            return True
        if obs.rtt_ms is not None and obs.rtt_ms > RTT_VIOLATION_MS:
            return True
        if obs.loss_pct is not None and obs.loss_pct > LOSS_VIOLATION_PCT:
            return True
        return False

    @staticmethod
    def _score(obs: LinkObservation) -> float:
        """How good a path looks right now, 0..1. Used only for ranking.

        Falls back to modelled coverage when there are not yet enough delivered
        packets to compute statistics - a path that has never carried traffic
        has no RTT, and pretending it has one would be inventing a measurement.
        """
        if obs.phase is LinkPhase.UNAVAILABLE:
            return 0.0
        coverage = obs.modelled_coverage if obs.modelled_coverage is not None else 0.0
        if obs.rtt_ms is None or obs.loss_pct is None:
            return 0.55 * coverage
        rtt_term = max(0.0, 1.0 - obs.rtt_ms / (RTT_VIOLATION_MS * 2.5))
        loss_term = max(0.0, 1.0 - obs.loss_pct / (LOSS_VIOLATION_PCT * 2.0))
        return 0.45 * rtt_term + 0.35 * loss_term + 0.20 * coverage

    def _rank(self, observations: dict[LinkId, LinkObservation]) -> list[tuple[float, LinkId]]:
        ranked: list[tuple[float, LinkId]] = []
        for link, obs in observations.items():
            if obs.phase is LinkPhase.UNAVAILABLE:
                continue
            # Preference acts as a small tie-breaker, not as an override: a
            # nominally-preferred link that measures badly still loses.
            preference_bonus = (3 - LINK_PREFERENCE[link]) * 0.02
            ranked.append((self._score(obs) + preference_bonus, link))
        ranked.sort(reverse=True)
        return ranked

    @staticmethod
    def _risky_state(state: ControllerState) -> bool:
        return state in (
            ControllerState.AT_RISK,
            ControllerState.WARMING_BACKUP,
            ControllerState.VALIDATING_BACKUP,
            ControllerState.SWITCHING,
            ControllerState.RECOVERING,
        )

    @classmethod
    def _bulk_should_pause(cls, state: ControllerState, headroom: float) -> bool:
        """The app-aware bulk rule, shared with B2-defer so the two are identical."""
        return bool(
            cls._risky_state(state)
            or state is ControllerState.DEGRADED
            or (headroom and headroom < 20.0)
        )

    def _cost_key(self, link: LinkId) -> tuple[float, int]:
        return (self._cost_per_mb[link], LINK_PREFERENCE[link])

    def _control_path(self) -> LinkId | None:
        if self.carrying is None:
            return None
        return self.class_paths.get(TrafficClass.CONTROL, self.carrying)

    # -- the pipeline --------------------------------------------------------

    def decide(
        self,
        t: float,
        observations: dict[LinkId, LinkObservation],
        app: ApplicationHealth | None,
        vehicle: VehicleObservation | None,
    ) -> ControllerDecision:
        cfg = self.config
        actions: list[Action] = []
        #: Where a SWITCH was placed in `actions`, so a MODE_CHANGE can precede it.
        switch_index: int | None = None
        session_switched = False
        previous_control_path = self._control_path()

        # --- OBSERVE ---------------------------------------------------------
        for link, obs in observations.items():
            self.history[link].push(t, obs)

        usable = {link: obs for link, obs in observations.items() if obs.phase is not LinkPhase.UNAVAILABLE}
        ranked = self._rank(observations)

        # --- total loss is a real outcome, not something to route around -----
        if not usable:
            self.state = ControllerState.DISCONNECTED
            reason = "No usable path exists. Reporting a genuine outage and holding safe-stop."
            self.carrying = None
            self.class_paths = {}
            actions = [Action(kind=ActionKind.SAFE_STOP)]
            mode_action, mode_reason = self._decide_mode(
                t, observations, None, previous_control_path, None, control_moved=True
            )
            if mode_action is not None:
                actions.insert(0, mode_action)
                reason = f"{mode_reason} {reason}"
            return ControllerDecision(
                state=self.state,
                carrying=None,
                actions=actions,
                reason=reason,
                prediction=None,
                want_active=set(),
                bulk_paused=True,
                video_rung=len(_VIDEO_LADDER) - 1,
                class_paths={},
                control_mode=self.control_mode,
            )

        if self.carrying is None or self.carrying not in usable:
            previous = self.carrying
            self.carrying = ranked[0][1]
            self.carrying_since = t
            self._last_switch_t = t
            if previous is not None:
                self.handovers += 1
                switch_index = len(actions)
                session_switched = True
                actions.append(Action(kind=ActionKind.SWITCH, link=self.carrying))
                reason = (
                    f"{previous.value} became unusable; moved the session to {self.carrying.value}."
                )
            else:
                reason = f"Session established on {self.carrying.value}."
            self.state = ControllerState.RECOVERING if previous else ControllerState.STABLE
            self._last_reason = reason

        carrying_obs = observations[self.carrying]

        # --- PREDICT ---------------------------------------------------------
        alt_best = max(
            (obs.modelled_coverage or 0.0 for link, obs in usable.items() if link != self.carrying),
            default=0.0,
        )
        prediction = self.predictor.predict(
            t=t,
            link=self.carrying,
            history=self.history[self.carrying],
            obs=carrying_obs,
            vehicle=vehicle,
            alt_best_coverage=alt_best,
            horizon_s=cfg.horizon_s,
        )
        self.predictions_made += 1
        if prediction.violation_expected:
            self.predicted_violations += 1

        measured_violation = self._violating(carrying_obs)
        risk_signal = measured_violation or (cfg.use_prediction and prediction.violation_expected)
        if risk_signal and self._risk_since is None:
            self._risk_since = t
        if not risk_signal:
            self._risk_since = None
        at_risk = risk_signal and (t - (self._risk_since or t)) >= cfg.risk_debounce_s

        # --- PREPARE ---------------------------------------------------------
        want_active: set[LinkId] = {self.carrying}
        backup: LinkId | None = None
        for _score, link in ranked:
            if link != self.carrying:
                backup = link
                break

        if cfg.always_redundant:
            want_active |= set(usable.keys())
        elif cfg.multipath and backup is not None:
            if cfg.proactive_warm or at_risk:
                want_active.add(backup)

        newly_warm = want_active - {self.carrying}
        if newly_warm and observations[self.carrying].phase is not LinkPhase.UNAVAILABLE:
            # Preference order, not set order: set iteration is hash-randomised
            # per process and made B2's action order non-deterministic.
            for link in sorted(newly_warm, key=lambda item: LINK_PREFERENCE[item]):
                if observations[link].phase in (LinkPhase.AVAILABLE,):
                    actions.append(Action(kind=ActionKind.ACTIVATE_BACKUP, link=link))
                    self.backup_activations += 1

        # --- STEER -----------------------------------------------------------
        state = ControllerState.STABLE
        reason = self._last_reason or f"Carrying the session on {self.carrying.value}."

        backup_ready = (
            backup is not None
            and observations[backup].phase in (LinkPhase.ACTIVE, LinkPhase.CARRYING)
        )
        dwell_ok = (t - self.carrying_since) >= cfg.min_dwell_s

        if at_risk:
            if backup_ready and dwell_ok:
                candidate_score = self._score(observations[backup]) if backup else 0.0
                incumbent_score = self._score(carrying_obs)
                # Even on a measured violation, only move to a path that is
                # genuinely better. Switching to something worse because the
                # incumbent is bad is exactly how a controller starts thrashing
                # between two unusable links.
                margin = 0.02 if measured_violation else cfg.switch_margin
                worth_it = candidate_score > incumbent_score + margin
                if worth_it and backup is not None:
                    previous = self.carrying
                    self.carrying = backup
                    self.carrying_since = t
                    self._last_switch_t = t
                    self.handovers += 1
                    if not measured_violation:
                        # A switch made purely on prediction. If the incumbent
                        # never actually violated, the experiment counts this as
                        # an unnecessary handover; that cost is not hidden.
                        self.unnecessary_handovers += 1
                    switch_index = len(actions)
                    session_switched = True
                    actions.append(Action(kind=ActionKind.SWITCH, link=self.carrying))
                    state = ControllerState.SWITCHING
                    trigger = "measured violation" if measured_violation else "predicted violation"
                    reason = (
                        f"Moved the session from {previous.value} to {self.carrying.value} on a "
                        f"{trigger}: RTT {carrying_obs.rtt_ms if carrying_obs.rtt_ms is not None else float('nan'):.0f} ms, "
                        f"loss {carrying_obs.loss_pct if carrying_obs.loss_pct is not None else float('nan'):.1f} %."
                    )
                else:
                    state = ControllerState.AT_RISK
                    reason = (
                        f"{self.carrying.value} is at risk but {backup.value if backup else 'no backup'} "
                        f"is not clearly better; holding to avoid a ping-pong switch."
                    )
            elif backup is not None and not backup_ready:
                state = (
                    ControllerState.VALIDATING_BACKUP
                    if observations[backup].phase is LinkPhase.VALIDATING
                    else ControllerState.WARMING_BACKUP
                )
                reason = (
                    f"{self.carrying.value} is at risk; {backup.value} is "
                    f"{observations[backup].phase.value} and not yet usable."
                )
            else:
                state = ControllerState.DEGRADED
                reason = f"{self.carrying.value} is degraded and no backup is available."
        elif measured_violation:
            state = ControllerState.DEGRADED
        elif t - self._last_switch_t < 2.0:
            state = ControllerState.RECOVERING
            reason = f"Recovering on {self.carrying.value} after a switch."
        else:
            state = ControllerState.STABLE

        # --- Phase 4: per-class steering, then the control operating mode ----
        steer_actions = self._steer_classes(t, observations, usable, prediction, vehicle, session_switched)
        control_path = self._control_path()
        control_moved = control_path is not previous_control_path
        control_prediction = prediction
        if control_path is not None and control_path is not self.carrying:
            control_prediction = self._predict_for(t, control_path, observations, usable, vehicle)
        mode_action, mode_reason = self._decide_mode(
            t, observations, control_path, previous_control_path, control_prediction,
            control_moved=control_moved,
        )
        if mode_action is not None:
            # A mode change that accompanies a path change precedes it: the
            # operator is told the mode before control moves, not after.
            actions.insert(switch_index if switch_index is not None else len(actions), mode_action)
            reason = f"{mode_reason} {reason}"
        elif steer_actions:
            reason = f"{steer_actions[0].detail['reason']} {reason}"
        actions.extend(steer_actions)

        # --- application-specific policy -------------------------------------
        duplicate: set[TrafficClass] = set()
        video_rung = 0
        bulk_paused = False

        if cfg.app_aware:
            risky = self._risky_state(state)
            if risky and backup_ready and backup is not None:
                # Control is duplicated only during the risky window. The
                # receiver deduplicates, so a command can never run twice.
                duplicate.add(TrafficClass.CONTROL)
                if not self._duplicating:
                    self.duplication_windows += 1
                    actions.append(
                        Action(kind=ActionKind.START_DUPLICATION, traffic_class=TrafficClass.CONTROL, link=backup)
                    )
                self._duplicating = True
            elif self._duplicating and state is ControllerState.STABLE:
                # Only stop duplicating once things have properly settled, so a
                # flickering risk signal cannot start and stop it every step.
                actions.append(Action(kind=ActionKind.STOP_DUPLICATION, traffic_class=TrafficClass.CONTROL))
                self._duplicating = False
            elif self._duplicating and backup_ready:
                duplicate.add(TrafficClass.CONTROL)

            headroom = carrying_obs.capacity_mbps or 0.0
            if headroom and headroom < 6.0:
                video_rung = 3
            elif headroom and headroom < 14.0:
                video_rung = 2
            elif risky or state is ControllerState.DEGRADED:
                video_rung = 1
            if video_rung > 0:
                actions.append(
                    Action(
                        kind=ActionKind.THROTTLE_CLASS,
                        traffic_class=TrafficClass.VIDEO,
                        detail={"rung": video_rung},
                    )
                )

            bulk_paused = self._bulk_should_pause(state, headroom)
            if bulk_paused:
                actions.append(Action(kind=ActionKind.THROTTLE_CLASS, traffic_class=TrafficClass.BULK))
        elif cfg.always_redundant:
            # B2 duplicates control unconditionally. That is its whole premise:
            # maximum resilience, paid for in bytes on every link, always.
            duplicate.add(TrafficClass.CONTROL)
            self._duplicating = True

        if cfg.defer_bulk and not cfg.app_aware:
            # B2-defer: the app-aware bulk rule and nothing else. Same
            # predicate, same inputs, so the ablation isolates exactly one thing.
            headroom = carrying_obs.capacity_mbps or 0.0
            bulk_paused = self._bulk_should_pause(state, headroom)
            if bulk_paused:
                actions.append(Action(kind=ActionKind.THROTTLE_CLASS, traffic_class=TrafficClass.BULK))

        self.state = state
        self._last_reason = reason
        return ControllerDecision(
            state=state,
            carrying=self.carrying,
            actions=actions,
            reason=reason,
            prediction=prediction if cfg.use_prediction else None,
            want_active=want_active,
            duplicate_classes=duplicate,
            video_rung=video_rung,
            bulk_paused=bool(bulk_paused),
            class_paths=dict(self.class_paths),
            control_mode=self.control_mode,
        )

    # -- Phase 4: per-class steering ------------------------------------------

    def _predict_for(
        self,
        t: float,
        link: LinkId,
        observations: dict[LinkId, LinkObservation],
        usable: dict[LinkId, LinkObservation],
        vehicle: VehicleObservation | None,
    ) -> Prediction:
        alt_best = max(
            (obs.modelled_coverage or 0.0 for other, obs in usable.items() if other != link),
            default=0.0,
        )
        return self.predictor.predict(
            t=t,
            link=link,
            history=self.history[link],
            obs=observations[link],
            vehicle=vehicle,
            alt_best_coverage=alt_best,
            horizon_s=self.config.horizon_s,
        )

    @staticmethod
    def _projected_violation(
        prediction: Prediction | None, deadline_ms: float, max_loss_pct: float
    ) -> bool:
        return projected_violation(prediction, deadline_ms, max_loss_pct)

    def _steer_classes(
        self,
        t: float,
        observations: dict[LinkId, LinkObservation],
        usable: dict[LinkId, LinkObservation],
        carrying_prediction: Prediction,
        vehicle: VehicleObservation | None,
        session_switched: bool,
    ) -> list[Action]:
        cfg = self.config
        carrying = self.carrying
        assert carrying is not None
        if not cfg.per_class_steering:
            self.class_paths = {cls: carrying for cls in ALL_CLASSES}
            return []

        if session_switched:
            # Classes follow the session when it moves. Steering then starts
            # again from the new primary path, with the dwell clock reset for
            # any class that was somewhere else.
            for cls in ALL_CLASSES:
                if self.class_paths.get(cls) is not carrying:
                    self._class_since[cls] = t
                self._class_bad_since[cls] = None
            self.class_paths = {cls: carrying for cls in ALL_CLASSES}

        active = [
            link for link in ALL_LINKS
            if link in observations and observations[link].phase in _READY_PHASES
        ]
        for link in ALL_LINKS:
            if link in active:
                if self._ready_since[link] is None:
                    self._ready_since[link] = t
            else:
                self._ready_since[link] = None

        # One trend projection per active path, judged per class against that
        # class's own thresholds inside `_choose_class_path`.
        projections: dict[LinkId, Prediction] = {}
        if cfg.use_prediction:
            for link in active:
                projections[link] = (
                    carrying_prediction if link is carrying
                    else self._predict_for(t, link, observations, usable, vehicle)
                )

        actions: list[Action] = []
        new_paths: dict[TrafficClass, LinkId] = {}
        for cls in ALL_CLASSES:
            if cls not in STEERABLE_CLASSES:
                new_paths[cls] = carrying
                continue
            current = self.class_paths.get(cls, carrying)
            target, why = self._choose_class_path(cls, current, active, projections, observations, t)
            new_paths[cls] = target
            if target is not current:
                self.class_steers += 1
                self._class_since[cls] = t
                self._class_bad_since[cls] = None
                actions.append(
                    Action(
                        kind=ActionKind.STEER_CLASS,
                        link=target,
                        traffic_class=cls,
                        detail={"from": current.value, "reason": why},
                    )
                )
        self.class_paths = new_paths
        return actions

    def _choose_class_path(
        self,
        cls: TrafficClass,
        current: LinkId,
        active: list[LinkId],
        projections: dict[LinkId, Prediction],
        observations: dict[LinkId, LinkObservation],
        t: float,
    ) -> tuple[LinkId, str]:
        """The steering rule for one class. Returns (path, reason-if-moved).

        Among active paths whose measured RTT and loss meet the class deadline
        and whose trend does not project past it within the horizon, take the
        cheapest; if none, the best-scoring active path. A class that is on an
        eligible path stays there unless a cheaper eligible path exists and the
        dwell time has elapsed. A class leaves a path that is still ready only
        after `class_leave_debounce_s`; it leaves a path that cannot carry at
        once.
        """
        cfg = self.config
        # Deadline levels to try, strictest first. Control under mode handover
        # may settle for a path that supports waypoint when none supports
        # teleop; control levels are judged by the shared mode-support rule
        # (acknowledged, retransmitted), other classes by their plain deadline.
        if cls is TrafficClass.CONTROL:
            # Control is acknowledged and retransmitted whether or not modes are
            # in use, so its teleop level is always judged by the mode-support
            # rule; the waypoint level exists only under mode handover.
            table = mode_table()
            control_modes = DEADLINE_MODES if cfg.mode_handover else (ControlMode.TELEOP,)
            levels = [
                (mode.value, float(table[mode]["deadline_ms"]), float(table[mode]["max_loss_pct"]))
                for mode in control_modes
            ]
            mode_of = {mode.value: mode for mode in control_modes}
        else:
            levels = [(cls.value, self._class_deadline_ms[cls], LOSS_VIOLATION_PCT)]
            mode_of = {}

        def meets(link: LinkId, label: str, deadline_ms: float, max_loss_pct: float) -> bool:
            obs = observations[link]
            if label in mode_of:
                return mode_supported(obs, mode_of[label]) is True
            return (
                obs.rtt_ms is not None
                and obs.loss_pct is not None
                and obs.rtt_ms <= deadline_ms
                and obs.loss_pct <= max_loss_pct
            )

        def at_risk(link: LinkId, label: str, deadline_ms: float, max_loss_pct: float) -> bool:
            if label in mode_of:
                return mode_projected_violation(projections.get(link), mode_of[label])
            return self._projected_violation(projections.get(link), deadline_ms, max_loss_pct)

        current_ready = current in active
        dwell_ok = (t - self._class_since.get(cls, -99.0)) >= cfg.class_dwell_s

        def settled(link: LinkId) -> bool:
            """A path that only just became ready is not yet a steering target.

            A path flickering at the usability floor is activated, validated and
            released within a few hundred milliseconds; a class steered onto it
            would be bounced straight back. The current path, and any path when
            the current one cannot carry at all, are exempt.
            """
            if link is current or not current_ready:
                return True
            since = self._ready_since.get(link)
            return since is not None and (t - since) >= cfg.class_leave_debounce_s

        def may_leave() -> bool:
            """Leave a still-ready path only once it has failed for the debounce."""
            if not current_ready:
                return True
            since = self._class_bad_since.get(cls)
            if since is None:
                self._class_bad_since[cls] = t
                return False
            return (t - since) >= cfg.class_leave_debounce_s

        for label, deadline_ms, max_loss_pct in levels:
            eligible = []
            for link in active:
                ok = (
                    settled(link)
                    and meets(link, label, deadline_ms, max_loss_pct)
                    and not at_risk(link, label, deadline_ms, max_loss_pct)
                )
                key = (label, link)
                if ok:
                    eligible.append(link)
                    if self._level_ok_since.get(key) is None:
                        self._level_ok_since[key] = t
                else:
                    self._level_ok_since[key] = None
            if not eligible:
                continue
            cheapest = min(eligible, key=self._cost_key)
            if current in eligible:
                self._class_bad_since[cls] = None
                # A move made purely for cost waits until the cheaper path has
                # been eligible for the dwell time: a link that only just
                # qualified, or qualifies in flickers, is not worth the churn.
                target_ok_since = self._level_ok_since.get((label, cheapest))
                target_settled = target_ok_since is not None and (t - target_ok_since) >= cfg.class_dwell_s
                if self._cost_per_mb[cheapest] < self._cost_per_mb[current] and dwell_ok and target_settled:
                    return cheapest, (
                        f"Steered {cls.value} from {current.value} to {cheapest.value}: both meet the "
                        f"{deadline_ms:.0f} ms {label} deadline and {cheapest.value} is cheaper "
                        f"({self._cost_per_mb[cheapest]:.3f} vs {self._cost_per_mb[current]:.3f} per MB)."
                    )
                return current, ""
            if not may_leave():
                return current, ""
            risk_note = (
                " and is projected to violate it within the horizon"
                if current_ready and meets(current, label, deadline_ms, max_loss_pct)
                else ""
            )
            return cheapest, (
                f"Steered {cls.value} from {current.value} to {cheapest.value}: {current.value} measures "
                f"{describe(observations.get(current))}{risk_note}, outside the "
                f"{deadline_ms:.0f} ms {label} deadline; {cheapest.value} measures "
                f"{describe(observations[cheapest])}."
            )

        # No active path meets any deadline level: use the best available, but
        # only move off a path that is still ready if the alternative is clearly
        # better - the same anti-thrash rule the session uses.
        if not active:
            return current, ""
        floor_label, floor_deadline, floor_loss = levels[-1]
        candidates = [
            link for link in active
            if settled(link) and not at_risk(link, floor_label, floor_deadline, floor_loss)
        ]
        if not candidates:
            # Everything ready is projected to fail: stay put if that is still
            # possible, otherwise take what is there.
            candidates = [current] if current_ready else active
        best = max(candidates, key=lambda link: (self._score(observations[link]), link is self.carrying))
        if best is current:
            self._class_bad_since[cls] = None
            return current, ""
        if current_ready and self._score(observations[best]) <= self._score(observations[current]) + cfg.switch_margin:
            self._class_bad_since[cls] = None
            return current, ""
        if not may_leave():
            return current, ""
        return best, (
            f"Steered {cls.value} from {current.value} to {best.value}: no active path meets the "
            f"{levels[-1][1]:.0f} ms {levels[-1][0]} deadline; {best.value} measures best "
            f"({describe(observations[best])})."
        )

    # -- Phase 4: control operating mode --------------------------------------

    @staticmethod
    def _mode_violation_expected(prediction: Prediction | None, mode: ControlMode) -> bool:
        return mode_projected_violation(prediction, mode)

    def _decide_mode(
        self,
        t: float,
        observations: dict[LinkId, LinkObservation],
        control_path: LinkId | None,
        previous_path: LinkId | None,
        prediction: Prediction | None,
        control_moved: bool,
    ) -> tuple[Action | None, str]:
        """Choose the control operating mode from the control path's measurements."""
        cfg = self.config
        if not cfg.mode_handover:
            return None, ""
        obs = observations.get(control_path) if control_path is not None else None
        if obs is not None and obs.phase is LinkPhase.CARRYING:
            self._ever_carried = True
        if not self._ever_carried:
            # The mode machine engages once the session has first been carried;
            # before that there is no operator channel to downshift.
            return None, ""

        # Support clocks for every observed path, whether or not control is on
        # it: backups are probed, so their capability is measured too.
        for link, link_obs in observations.items():
            for mode in DEADLINE_MODES:
                key = (link, mode)
                if mode_supported(link_obs, mode) is True:
                    if self._support_since[key] is None:
                        self._support_since[key] = t
                else:
                    self._support_since[key] = None
        support = {mode: mode_supported(obs, mode) for mode in DEADLINE_MODES}
        if control_moved:
            self._mode_bad_since = None

        if control_moved and control_path is not None and not cfg.anticipate_mode:
            # The reactive ablation never acts ahead of a measured violation on
            # the path control is actually using. A path control has just been
            # moved onto is judged on the next step, by what it then measures.
            # Losing the path altogether is not a move: that is measured now.
            # (Before commit 3638449 was fixed this guard also fired with no
            # path, and the ablation sat in waypoint through a total outage;
            # see docs/PHASE_4_RESULTS.md.)
            self._mode_risk_since = None
            return None, ""

        current = self.control_mode
        target = current
        why = ""
        anticipated = False
        trigger = ""
        path_name = control_path.value if control_path is not None else "no path"
        path_ready = obs is not None and obs.phase in _READY_PHASES

        if current is not ControlMode.SAFE_HOLD and support[current] is False:
            # Measured: the control path cannot support the current mode. On a
            # path that is still carrying, the condition must persist for the
            # debounce; a path that cannot carry at all, or one control is being
            # moved onto, is judged at once.
            if self._mode_bad_since is None:
                self._mode_bad_since = t
            settled = (
                control_moved
                or not path_ready
                or (t - self._mode_bad_since) >= cfg.mode_down_debounce_s
            )
            if settled:
                target = highest_supported(support)
                if MODE_RANK[target] >= MODE_RANK[current]:
                    target = ControlMode.SAFE_HOLD
                deadline = float(mode_table()[current]["deadline_ms"])
                previous_obs = observations.get(previous_path) if previous_path is not None else None
                anticipated = control_moved and mode_supported(previous_obs, current) is True
                trigger = "before path change" if anticipated else "measured"
                met = (
                    f" The {float(mode_table()[target]['deadline_ms']):.0f} ms {target.value} deadline is met."
                    if target is not ControlMode.SAFE_HOLD
                    else " No mode with a deadline is supported; holding."
                )
                if anticipated:
                    why = (
                        f"Control mode changed from {current.value} to {target.value} before moving control "
                        f"onto {path_name}, which measures {describe(obs)} against the {deadline:.0f} ms "
                        f"{current.value} deadline.{met}"
                    )
                else:
                    why = (
                        f"Control mode changed from {current.value} to {target.value}: {path_name} measures "
                        f"{describe(obs)}, outside the {deadline:.0f} ms {current.value} deadline.{met}"
                    )
        else:
            self._mode_bad_since = None
            if (
                cfg.anticipate_mode
                and cfg.use_prediction
                and current is ControlMode.TELEOP
                and support[current] is True
            ):
                # Anticipated: the trend projects a violation of teleop's
                # thresholds inside the horizon, persisting past the debounce.
                # Steering has already had its chance to move control to a path
                # that is not at risk; if it could not, downshift ahead - but
                # only to waypoint. A forecast never removes the command channel
                # altogether: safe hold is entered on measured facts alone.
                risk = self._mode_violation_expected(prediction, current)
                if risk and self._mode_risk_since is None:
                    self._mode_risk_since = t
                if not risk:
                    self._mode_risk_since = None
                if risk and (t - (self._mode_risk_since or t)) >= cfg.risk_debounce_s:
                    lower = ControlMode.WAYPOINT
                    if support[lower] is True:
                        target = lower
                        anticipated = True
                        trigger = "predicted"
                        deadline = float(mode_table()[current]["deadline_ms"])
                        horizon = prediction.horizon_s if prediction is not None else cfg.horizon_s
                        why = (
                            f"Control mode changed from {current.value} to {target.value} ahead of a predicted "
                            f"violation on {path_name}: trend projects past the {deadline:.0f} ms {current.value} "
                            f"deadline within {horizon:.1f} s (now {describe(obs)})."
                        )

        if (
            target is current
            and MODE_RANK[current] < MODE_RANK[ControlMode.TELEOP]
            and control_path is not None
            and (t - self._last_mode_change_t) >= cfg.mode_up_hold_s
        ):
            # Upshift only after the higher mode has been supported on the
            # control path for the hold time, and never within one hold of the
            # previous change. Highest qualifying mode first.
            for mode in DEADLINE_MODES:
                if MODE_RANK[mode] <= MODE_RANK[current]:
                    continue
                since = self._support_since[(control_path, mode)]
                if since is not None and (t - since) >= cfg.mode_up_hold_s:
                    target = mode
                    trigger = "hold met"
                    deadline = float(mode_table()[mode]["deadline_ms"])
                    why = (
                        f"Control mode changed from {current.value} to {mode.value}: {path_name} has met the "
                        f"{deadline:.0f} ms {mode.value} deadline for {t - since:.1f} s "
                        f"(hold {cfg.mode_up_hold_s:.1f} s; now {describe(obs)})."
                    )
                    break

        if target is current:
            return None, ""

        self.mode_changes += 1
        if MODE_RANK[target] < MODE_RANK[current]:
            if anticipated:
                self.anticipated_mode_changes += 1
            else:
                self.late_mode_changes += 1
        self.control_mode = target
        self._last_mode_change_t = t
        self._mode_risk_since = None
        self._mode_bad_since = None
        action = Action(
            kind=ActionKind.MODE_CHANGE,
            link=control_path,
            traffic_class=TrafficClass.CONTROL,
            detail={
                "from": current.value,
                "to": target.value,
                "anticipated": anticipated,
                "trigger": trigger,
                "reason": why,
            },
        )
        return action, why


_VIDEO_LADDER = (0, 1, 2, 3)
