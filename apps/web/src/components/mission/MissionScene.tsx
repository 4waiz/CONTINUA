'use client';

/**
 * The Phase 1 scene, driven by the Phase 2 engine.
 *
 * This is the seam working exactly as designed: `SceneRuntimeProvider` takes a
 * `source`, and here that source is `EngineSceneStateSource` instead of the
 * preview one. Not a line of the scene changed.
 *
 * The scene clock free-runs so vehicle motion interpolates smoothly at 60 fps,
 * and is corrected back to the engine's authoritative time whenever it drifts.
 * Motion is interpolated; **metrics are not** — every number the scene displays
 * comes verbatim from an engine event.
 */

import { SceneRuntimeProvider, useSceneRuntime, type EngineSceneStateSource } from '@continua/scene';
import { useEffect } from 'react';
import { SceneStage } from '../SceneStage';

const DRIFT_TOLERANCE_S = 0.35;

function ClockSync({
  t,
  duration,
  playing,
}: {
  t: number;
  duration: number;
  playing: boolean;
}) {
  const { clock } = useSceneRuntime();

  useEffect(() => {
    if (duration > 0 && Math.abs(clock.duration - duration) > 0.5) clock.setDuration(duration);
  }, [clock, duration]);

  useEffect(() => {
    if (playing) clock.play();
    else clock.pause();
  }, [clock, playing]);

  useEffect(() => {
    // Correct drift rather than snapping every tick: snapping at 20 Hz makes
    // the vehicle stutter, and free-running alone slowly desynchronises.
    if (Math.abs(clock.time - t) > DRIFT_TOLERANCE_S) clock.setTime(t, false);
  }, [clock, t]);

  return null;
}

export function MissionScene({
  source,
  t,
  duration,
  playing,
  className,
}: {
  source: EngineSceneStateSource;
  t: number;
  duration: number;
  playing: boolean;
  className?: string;
}) {
  return (
    <SceneRuntimeProvider source={source}>
      <ClockSync t={t} duration={duration} playing={playing} />
      <SceneStage className={className} />
    </SceneRuntimeProvider>
  );
}
