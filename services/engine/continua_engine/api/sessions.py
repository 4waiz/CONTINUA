"""
Live run sessions and replay sessions.

A session owns one authoritative clock. The frontend never advances time itself;
it renders whatever the session publishes, and may interpolate vehicle motion
between events. It must not invent metrics.

Seeking a live simulation rebuilds it from the same seed and fast-forwards.
That is exact, not approximate, because the simulation is deterministic — the
same seed and scenario always reproduce the same run, so "rewinding" and
replaying gives byte-identical state.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

from ..contracts import (
    EngineEvent,
    ExecutionMode,
    PolicyId,
    RunControl,
    RunStatus,
    ScenarioOverrides,
)
from ..sim.exogenous import apply_overrides, get_scenario
from ..sim.simulator import Simulation
from ..store.store import RunStore

#: How often the session pushes to subscribers while playing.
TICK_S = 0.05


class Broadcaster:
    """Fan-out to websocket subscribers, tolerant of slow or dead clients."""

    def __init__(self) -> None:
        self._queues: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=512)
        self._queues.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._queues.discard(queue)

    def publish(self, message: dict) -> None:
        for queue in list(self._queues):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # A subscriber that cannot keep up is dropped rather than
                # allowed to stall the run. It will resync on reconnect using
                # the sequence number.
                self._queues.discard(queue)

    @property
    def subscriber_count(self) -> int:
        return len(self._queues)


@dataclass
class SessionState:
    run_id: str
    mode: ExecutionMode
    scenario_id: str
    policy_id: str
    seed: int
    status: RunStatus
    t: float
    duration_s: float
    speed: float
    seq: int
    predictor: str
    horizon_s: float
    source_mode: ExecutionMode | None = None
    source_run_id: str | None = None
    recorded_at: str | None = None
    scenario_title: str = ""

    def to_dict(self) -> dict:
        payload = {
            "run_id": self.run_id,
            "mode": self.mode.value,
            "scenario_id": self.scenario_id,
            "scenario_title": self.scenario_title,
            "policy_id": self.policy_id,
            "seed": self.seed,
            "status": self.status.value,
            "t": round(self.t, 3),
            "duration_s": round(self.duration_s, 3),
            "speed": self.speed,
            "seq": self.seq,
            "predictor": self.predictor,
            "horizon_s": self.horizon_s,
        }
        if self.source_mode is not None:
            payload["source"] = {
                "mode": self.source_mode.value,
                "run_id": self.source_run_id,
                "recorded_at": self.recorded_at,
            }
        return payload


class RunSession:
    """A live simulation, driven by its own clock."""

    def __init__(self, control: RunControl, overrides: ScenarioOverrides | None, store: RunStore) -> None:
        self.control = control
        self.store = store
        self.scenario = apply_overrides(
            get_scenario(control.scenario_id),
            overrides.model_dump(exclude_none=True) if overrides else None,
        )
        self.sim = Simulation(
            self.scenario,
            seed=control.seed,
            policy_id=control.policy_id,
            predictor_kind=control.predictor,
            horizon_s=control.horizon_s,
            mode=ExecutionMode.SIMULATION,
        )
        self.run_id = self.sim.run_id
        self.broadcaster = Broadcaster()
        self.status = RunStatus.PENDING
        self.speed = control.speed
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._written = 0
        self.last_event: EngineEvent | None = None

        self.store.begin_run(
            run_id=self.run_id,
            mode=ExecutionMode.SIMULATION,
            scenario=self.scenario,
            policy_id=control.policy_id,
            seed=control.seed,
            predictor=control.predictor,
            horizon_s=control.horizon_s,
            engine_version="2.0.0",
        )

    # -- state ---------------------------------------------------------------

    def state(self) -> SessionState:
        return SessionState(
            run_id=self.run_id,
            mode=ExecutionMode.SIMULATION,
            scenario_id=self.scenario["id"],
            scenario_title=self.scenario.get("title", ""),
            policy_id=self.sim.config.policy_id.value,
            seed=self.sim.seed,
            status=self.status,
            t=self.sim.t,
            duration_s=self.sim.trace.duration_s,
            speed=self.speed,
            seq=self.sim.seq,
            predictor=self.control.predictor,
            horizon_s=self.control.horizon_s,
        )

    def snapshot(self) -> dict:
        return {
            "type": "snapshot",
            "state": self.state().to_dict(),
            "event": json.loads(self.last_event.model_dump_json()) if self.last_event else None,
        }

    # -- transport -----------------------------------------------------------

    def _emit(self, event: EngineEvent | None) -> None:
        if event is None:
            return
        self.last_event = event
        self.broadcaster.publish({"type": "event", "event": json.loads(event.model_dump_json())})

    def _flush(self) -> None:
        pending = self.sim.events[self._written :]
        if pending:
            self.store.write_events(self.run_id, pending)
            self._written = len(self.sim.events)

    def _advance_to(self, target_t: float) -> None:
        guard = 0
        while not self.sim.finished and self.sim.t < target_t and guard < 200_000:
            self._emit(self.sim.step())
            guard += 1

    async def _loop(self) -> None:
        self.status = RunStatus.RUNNING
        self.broadcaster.publish({"type": "status", "state": self.state().to_dict()})
        last_wall = time.monotonic()
        try:
            while not self._stop.is_set() and not self.sim.finished:
                await asyncio.sleep(TICK_S)
                now = time.monotonic()
                delta = now - last_wall
                last_wall = now
                if self.status is not RunStatus.RUNNING:
                    continue
                if self.speed <= 0:
                    self._advance_to(self.sim.trace.duration_s)
                else:
                    self._advance_to(self.sim.t + delta * self.speed)
                self._flush()
                self.broadcaster.publish({"type": "tick", "state": self.state().to_dict()})
        finally:
            self._flush()
            finished = self.sim.finished
            self.status = RunStatus.COMPLETED if finished else RunStatus.CANCELLED
            metrics = None
            if finished:
                from ..experiments.metrics import compute_metrics

                metrics = compute_metrics(self.sim)
            self.store.finish_run(
                self.run_id,
                self.status,
                duration_s=self.sim.t,
                event_count=len(self.sim.events),
                metrics=metrics,
            )
            self.broadcaster.publish(
                {"type": "status", "state": self.state().to_dict(), "metrics": metrics}
            )

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    def pause(self) -> None:
        if self.status is RunStatus.RUNNING:
            self.status = RunStatus.PAUSED
            self.broadcaster.publish({"type": "status", "state": self.state().to_dict()})

    def resume(self) -> None:
        if self.status is RunStatus.PAUSED:
            self.status = RunStatus.RUNNING
            self.broadcaster.publish({"type": "status", "state": self.state().to_dict()})

    def set_speed(self, speed: float) -> None:
        self.speed = max(0.0, min(speed, 64.0))
        self.broadcaster.publish({"type": "status", "state": self.state().to_dict()})

    def seek(self, t: float) -> None:
        """Seek to `t`. Rebuilds and fast-forwards when moving backwards."""
        target = max(0.0, min(t, self.sim.trace.duration_s))
        if target < self.sim.t:
            self.sim = Simulation(
                self.scenario,
                seed=self.control.seed,
                policy_id=self.control.policy_id,
                predictor_kind=self.control.predictor,
                horizon_s=self.control.horizon_s,
                run_id=self.run_id,
                mode=ExecutionMode.SIMULATION,
            )
            self._written = 0
        self._advance_to(target)
        self.broadcaster.publish(
            {
                "type": "seek",
                "state": self.state().to_dict(),
                "event": json.loads(self.last_event.model_dump_json()) if self.last_event else None,
            }
        )

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
            self._task = None


class ReplaySession:
    """Playback of a stored run.

    Emits exactly the events that were recorded. Nothing is re-rolled, no fault
    is re-drawn and no metric is recomputed — a replay that produced a different
    outcome would not be a replay.
    """

    def __init__(self, source_run: dict, events: list[dict], store: RunStore) -> None:
        self.source = source_run
        self.events = events
        self.store = store
        self.run_id = f"replay-{source_run['run_id']}"
        self.broadcaster = Broadcaster()
        self.status = RunStatus.PENDING
        self.speed = 1.0
        self.index = 0
        self.t = 0.0
        self.duration_s = float(source_run.get("duration_s") or (events[-1]["t"] if events else 0.0))
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self.last_event: dict | None = events[0] if events else None

    def state(self) -> SessionState:
        return SessionState(
            run_id=self.run_id,
            mode=ExecutionMode.REPLAY,
            scenario_id=self.source["scenario_id"],
            scenario_title=self.source.get("scenario_title", ""),
            policy_id=self.source["policy_id"],
            seed=self.source["seed"],
            status=self.status,
            t=self.t,
            duration_s=self.duration_s,
            speed=self.speed,
            seq=self.last_event["seq"] if self.last_event else 0,
            predictor=self.source.get("predictor") or "unknown",
            horizon_s=float(self.source.get("horizon_s") or 0.0),
            source_mode=ExecutionMode(self.source["mode"]),
            source_run_id=self.source["run_id"],
            recorded_at=self.source["started_at"],
        )

    def snapshot(self) -> dict:
        return {"type": "snapshot", "state": self.state().to_dict(), "event": self.last_event}

    def _advance_to(self, target_t: float) -> None:
        while self.index < len(self.events) and self.events[self.index]["t"] <= target_t:
            self.last_event = self.events[self.index]
            self.broadcaster.publish({"type": "event", "event": self.last_event})
            self.index += 1
        self.t = min(target_t, self.duration_s)

    def seek(self, t: float) -> None:
        target = max(0.0, min(t, self.duration_s))
        if target < self.t:
            self.index = 0
        self.t = target
        # Move the cursor without re-broadcasting the whole history.
        while self.index < len(self.events) and self.events[self.index]["t"] <= target:
            self.last_event = self.events[self.index]
            self.index += 1
        self.broadcaster.publish(
            {"type": "seek", "state": self.state().to_dict(), "event": self.last_event}
        )

    async def _loop(self) -> None:
        self.status = RunStatus.RUNNING
        self.broadcaster.publish({"type": "status", "state": self.state().to_dict()})
        last_wall = time.monotonic()
        try:
            while not self._stop.is_set() and self.index < len(self.events):
                await asyncio.sleep(TICK_S)
                now = time.monotonic()
                delta = now - last_wall
                last_wall = now
                if self.status is not RunStatus.RUNNING:
                    continue
                self._advance_to(self.t + delta * max(self.speed, 0.01))
                self.broadcaster.publish({"type": "tick", "state": self.state().to_dict()})
        finally:
            self.status = RunStatus.COMPLETED
            self.broadcaster.publish({"type": "status", "state": self.state().to_dict()})

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    def pause(self) -> None:
        self.status = RunStatus.PAUSED
        self.broadcaster.publish({"type": "status", "state": self.state().to_dict()})

    def resume(self) -> None:
        self.status = RunStatus.RUNNING
        self.broadcaster.publish({"type": "status", "state": self.state().to_dict()})

    def set_speed(self, speed: float) -> None:
        self.speed = max(0.05, min(speed, 16.0))
        self.broadcaster.publish({"type": "status", "state": self.state().to_dict()})

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
            self._task = None
