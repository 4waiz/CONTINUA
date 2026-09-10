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
 * Motion is interpolated; **metrics are not** - every number the scene displays
 * comes verbatim from an engine event.
 */

import {
  previewSource,
  SceneRuntimeProvider,
  useSceneRuntime,
  type EngineSceneStateSource,
} from '@continua/scene';
import { useEffect } from 'react';
import { SceneStage } from '../SceneStage';

const DRIFT_TOLERANCE_S = 0.35;

function ClockSync({
  t,
  duration,
  playing,
  enabled,
}: {
  t: number;
  duration: number;
  playing: boolean;
  /**
   * False while the scene is showing the Phase 1 preview, which drives its own
   * looping clock. This component still mounts, so that arriving at a run does
   * not change the shape of the tree underneath the provider - see below.
   */
  enabled: boolean;
}) {
  const { clock } = useSceneRuntime();

  useEffect(() => {
    if (!enabled) return;
    if (duration > 0 && Math.abs(clock.duration - duration) > 0.5) clock.setDuration(duration);
  }, [clock, duration, enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (playing) clock.play();
    else clock.pause();
  }, [clock, playing, enabled]);

  useEffect(() => {
    // While paused the timeline is being *scrubbed* - by someone dragging the
    // transport, or by the video harness stepping one frame at a time - and the
    // scene has to sit exactly on the cursor.
    //
    // The tolerance below exists for live playback, where the clock free-runs at
    // 60 fps and snapping it to every engine tick makes the vehicle stutter.
    // Applying that same tolerance to a paused scrub was wrong in both places it
    // showed up: scrubbing by hand moved the vehicle in visible jumps, and
    // frame-stepped capture froze it for ten frames and then jumped it, which is
    // what made the recorded footage judder.
    if (!enabled) return;
    if (!playing) {
      clock.setTime(t, false);
      return;
    }
    if (Math.abs(clock.time - t) > DRIFT_TOLERANCE_S) clock.setTime(t, false);
  }, [clock, t, playing, enabled]);

  return null;
}

/**
 * @param preview  no run exists yet. The scene is driven by the Phase 1 preview
 *   source and plays its own route loop, so the operator sees the world rather
 *   than an empty rectangle. Nothing in preview is a measurement, and the
 *   caller is responsible for badging it `SCENE PREVIEW` - `SceneState.source`
 *   carries the same fact for anything that reads the state directly.
 */
export function MissionScene({
  source,
  t,
  duration,
  playing,
  className,
  preview = false,
}: {
  source: EngineSceneStateSource;
  t: number;
  duration: number;
  playing: boolean;
  className?: string;
  preview?: boolean;
}) {
  // One tree, whether or not a run has arrived yet. Returning a *different*
  // tree for preview put `SceneStage` at a different child index, so the moment
  // a run appeared React unmounted the canvas and built a new one - a WebGL
  // context and a glTF reload for a change of data source. Swapping only the
  // `source` prop rebuilds the runtime and leaves everything below it alone.
  return (
    <SceneRuntimeProvider source={preview ? previewSource : source}>
      <ClockSync t={t} duration={duration} playing={playing} enabled={!preview} />
      <SceneStage className={className} />
    </SceneRuntimeProvider>
  );
}
