"""
The CONTINUA controller: Observe → Predict → Prepare → Steer → Explain.

Every policy under comparison is implemented here behind one interface, so the
baselines and CONTINUA differ only in the flags set in `PolicyConfig` — not in
which code path they take through the simulator. That is deliberate: it removes
the most common way a comparison quietly stops being fair.

The controller sees only `LinkObservation`s (derived from delivered,
acknowledged and timed-out packets) and `ApplicationHealth` (derived from
receiver logs). It has no access to the exogenous trace.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..contracts import (
    ALL_LINKS,
    Action,
    ActionKind,
    ApplicationHealth,
    ControllerState,
    LinkId,
    LinkObservation,
    LinkPhase,
    PolicyId,
    Prediction,
    TrafficClass,
    VehicleObservation,
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
        packets to compute statistics — a path that has never carried traffic
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
            return ControllerDecision(
                state=self.state,
                carrying=None,
                actions=[Action(kind=ActionKind.SAFE_STOP)],
                reason=reason,
                prediction=None,
                want_active=set(),
                bulk_paused=True,
                video_rung=len(_VIDEO_LADDER) - 1,
            )

        if self.carrying is None or self.carrying not in usable:
            previous = self.carrying
            self.carrying = ranked[0][1]
            self.carrying_since = t
            self._last_switch_t = t
            if previous is not None:
                self.handovers += 1
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
            for link in newly_warm:
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

        # --- application-specific policy -------------------------------------
        duplicate: set[TrafficClass] = set()
        video_rung = 0
        bulk_paused = False

        if cfg.app_aware:
            risky = state in (
                ControllerState.AT_RISK,
                ControllerState.WARMING_BACKUP,
                ControllerState.VALIDATING_BACKUP,
                ControllerState.SWITCHING,
                ControllerState.RECOVERING,
            )
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

            bulk_paused = risky or state is ControllerState.DEGRADED or (headroom and headroom < 20.0)
            if bulk_paused:
                actions.append(Action(kind=ActionKind.THROTTLE_CLASS, traffic_class=TrafficClass.BULK))
        elif cfg.always_redundant:
            # B2 duplicates control unconditionally. That is its whole premise:
            # maximum resilience, paid for in bytes on every link, always.
            duplicate.add(TrafficClass.CONTROL)
            self._duplicating = True

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
        )


_VIDEO_LADDER = (0, 1, 2, 3)
