'use client';

/**
 * Taking the wheel: the rover on screen, under the viewer's keys.
 *
 * W (or ↑) drives, S (or ↓) brakes and then reverses, A and D (or ← →) steer,
 * Space holds it, Esc hands it back to the recording. The rover stays on the
 * road - the drive model will not let a wheel off it (`driveModel.ts`).
 *
 * What the network did is never worked out here. Driving needs the whole
 * recorded run, not the part streamed so far: where the rover is picks the
 * moment of that recording at which the recorded rover was there, and every
 * panel shows that moment, verbatim (`drivenSource.ts`). On the public build
 * the recording is already whole; locally a run still going is first
 * finished by the engine - at speed 0 it runs to its end at once - and read
 * back from the engine's store.
 */

import { api } from '@/lib/api';
import { IS_PUBLIC_PREVIEW } from '@/lib/deployment';
import { DrivenSceneStateSource, EngineSceneStateSource, NO_INPUT, route } from '@continua/scene';
import type { EngineEvent, EngineRunState } from '@continua/contracts/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** One recorded run, whole, for reading at any moment. */
export interface Tape {
  /** The run as the page knows it: a replay's id, or the run's own. */
  runId: string;
  events: EngineEvent[];
  source: EngineSceneStateSource;
  /** The events that record a controller action, in time order. */
  decisions: EngineEvent[];
}

export interface DriveSession {
  source: DrivenSceneStateSource;
  main: Tape;
  baseline: Tape | null;
  reverse: boolean;
}

export interface DriveReadout {
  /** The recording's time at the rover's point of the road. */
  t: number;
  /** The rover's own speed, km/h - the viewer's driving, not a network figure. */
  speedKmh: number;
  gear: 'D' | 'R' | 'N';
  /** Against the edge of the road just now. */
  bumped: boolean;
  /** At the road's end, by the ground station. */
  atEnd: boolean;
  /** Route metres. */
  along: number;
}

/** What the panels read while driving: the recording at the rover's point of the road. */
export interface DriveFeed {
  latest: EngineEvent | null;
  decisions: EngineEvent[];
  history: EngineEvent[];
  baseline: EngineEvent | null;
}

const HISTORY_LIMIT = 900;
const READOUT_MS = 110;

/** The last index whose event is at or before `t`, or -1. */
function indexAt(events: readonly EngineEvent[], t: number): number {
  let low = 0;
  let high = events.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (events[mid]!.t <= t + 1e-9) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

function tapeOf(runId: string, events: EngineEvent[], reverse: boolean): Tape {
  const last = events[events.length - 1];
  const source = new EngineSceneStateSource(runId, last ? last.t : 1);
  source.setReverse(reverse);
  for (const event of events) source.ingest(event);
  return {
    runId,
    events,
    source,
    decisions: events.filter((event) => event.action && event.action.kind !== 'none'),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Every event of a run. A replay reads its recording's events; a live local
 * run is finished first.
 */
async function wholeRun(runId: string, state: EngineRunState | null): Promise<EngineEvent[]> {
  const recorded = state?.mode === 'replay' && state.source?.run_id ? state.source.run_id : runId;
  if (!IS_PUBLIC_PREVIEW && state?.mode !== 'replay' && state?.status !== 'completed') {
    await api.controlRun(runId, { action: 'speed', speed: 0 }).catch(() => undefined);
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const info = (await api.getRun(runId).catch(() => null)) as { live?: boolean; state?: { status?: string } } | null;
      if (!info?.live || info.state?.status === 'completed' || info.state?.status === 'cancelled') break;
      await sleep(250);
    }
  }
  const page = await api.getRunEvents(recorded, 0, 20000);
  return page.events as EngineEvent[];
}

/** The keys that drive, by physical position: the same keys on any layout. */
const DRIVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element && (/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || element.isContentEditable));
}

export function useDrive({
  enabled,
  runId,
  runState,
  baselineId,
  baselineState,
  reverse,
  onTake,
  onRelease,
}: {
  /** Driving is offered: the drive view, with a run on screen. */
  enabled: boolean;
  runId: string | null;
  runState: EngineRunState | null;
  baselineId: string | null;
  baselineState: EngineRunState | null;
  reverse: boolean;
  /** The page's own part in taking over: pause the transport, change the camera. */
  onTake?: () => void;
  /** And in handing back, from the recording's time at the rover's point of the road. */
  onRelease?: (t: number) => void;
}) {
  const [taken, setTaken] = useState<DriveSession | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState<DriveReadout | null>(null);
  const pressed = useRef(new Set<string>());
  // A different run on screen ends the drive - its recording is not this one -
  // and so does leaving the drive view. Derived, not reset from an effect.
  const session = taken && enabled && runId === taken.main.runId ? taken : null;
  const sessionRef = useRef<DriveSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const take = useCallback(async () => {
    if (!runId || preparing || sessionRef.current) return;
    setPreparing(true);
    setError(null);
    try {
      const at = runState?.t ?? 0;
      const [events, baseEvents] = await Promise.all([
        wholeRun(runId, runState),
        baselineId ? wholeRun(baselineId, baselineState) : Promise.resolve(null),
      ]);
      if (events.length === 0) throw new Error('The recording has no events to drive through.');
      const source = new DrivenSceneStateSource({ events, runId, at, reverse });
      const next: DriveSession = {
        source,
        main: tapeOf(runId, events, reverse),
        baseline: baselineId && baseEvents ? tapeOf(baselineId, baseEvents, reverse) : null,
        reverse,
      };
      // Keys go to the rover now, not to the button that was pressed.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      sessionRef.current = next;
      setTaken(next);
      onTake?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the whole run to drive.');
    } finally {
      setPreparing(false);
    }
  }, [runId, runState, baselineId, baselineState, reverse, preparing, onTake]);

  const release = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    const t = current.source.recordedTime;
    current.source.input = { ...NO_INPUT };
    pressed.current.clear();
    sessionRef.current = null;
    setTaken(null);
    setReadout(null);
    onRelease?.(t);
  }, [onRelease]);

  // --- the keys ------------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return undefined;
    const apply = () => {
      const current = sessionRef.current;
      if (!current) return;
      const keys = pressed.current;
      const throttle = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const steer = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
      current.source.input = { throttle, steer, brake: keys.has('Space') };
    };
    const onDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      if (event.code === 'Escape' && sessionRef.current) {
        release();
        return;
      }
      if (!DRIVE_CODES.has(event.code)) return;
      if (!sessionRef.current) {
        // Any driving key takes the wheel - except Space, which a focused
        // button would also take as a click.
        if (event.code !== 'Space' && !event.repeat) void take();
        return;
      }
      event.preventDefault();
      pressed.current.add(event.code);
      apply();
    };
    const onUp = (event: KeyboardEvent) => {
      if (!pressed.current.delete(event.code)) return;
      apply();
    };
    // Keys held as the window loses focus are never released: let go of them all.
    const onBlur = () => {
      pressed.current.clear();
      apply();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled, take, release]);

  // --- what the panels read, at a pace a person reads at -------------------------
  useEffect(() => {
    if (!session) return undefined;
    const timer = setInterval(() => {
      const pose = session.source.pose;
      const next: DriveReadout = {
        t: session.source.recordedTime,
        speedKmh: Math.abs(pose.speed) * 3.6,
        gear: pose.speed > 0.15 ? 'D' : pose.speed < -0.15 ? 'R' : 'N',
        bumped: session.source.bumped,
        atEnd: pose.along >= route.length - 3,
        along: pose.along,
      };
      setReadout((previous) =>
        previous &&
        Math.abs(previous.t - next.t) < 0.02 &&
        Math.abs(previous.speedKmh - next.speedKmh) < 0.4 &&
        previous.gear === next.gear &&
        previous.bumped === next.bumped &&
        previous.atEnd === next.atEnd
          ? previous
          : next,
      );
    }, READOUT_MS);
    return () => clearInterval(timer);
  }, [session]);

  const current = session && readout ? readout : null;
  const t = current?.t ?? session?.source.recordedTime ?? 0;
  const feed = useMemo((): DriveFeed | null => {
    if (!session) return null;
    const events = session.main.events;
    const index = indexAt(events, t);
    const decisionIndex = indexAt(session.main.decisions, t);
    return {
      latest: index >= 0 ? events[index]! : null,
      decisions: session.main.decisions.slice(0, decisionIndex + 1),
      history: events.slice(Math.max(0, index + 1 - HISTORY_LIMIT), index + 1),
      baseline: session.baseline ? (session.baseline.source.eventAt(t) ?? null) : null,
    };
  }, [session, t]);

  return { session, preparing, error, readout: current, feed, t, take, release };
}
