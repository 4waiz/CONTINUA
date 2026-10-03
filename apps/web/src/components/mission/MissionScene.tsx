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
  EngineSceneStateSource,
  previewSource,
  qualityCeiling,
  SceneRuntimeProvider,
  useSceneRuntime,
  useSetSceneSettings,
} from '@continua/scene';
import { useEffect, useState } from 'react';
import { SceneStage } from '../SceneStage';

/**
 * How far behind the newest engine sample a playing run is shown, in sim
 * seconds. The engine samples every 0.1 s and the scene interpolates only
 * *between* samples - it never extrapolates a position the engine has not
 * reported - so a scene clock level with the newest sample has nothing to
 * interpolate toward: the rover froze until the next sample, then jumped. A
 * quarter of a second behind, there is always a pair to move between.
 */
const PLAYOUT_DELAY_S = 0.25;
/** Past this the clock is resynchronised outright: a seek, a stalled tab. */
const RESYNC_S = 1.0;

/** Site markers are an inspection aid for Scene Lab; the mission view hides them. */
const MISSION_SETTINGS = { showMarkers: false } as const;

function ClockSync({
  t,
  duration,
  playing,
  speed,
  enabled,
}: {
  t: number;
  duration: number;
  playing: boolean;
  /** The run's playback rate; the engine advances this many sim seconds per second. */
  speed: number;
  /**
   * False while the scene is showing the Phase 1 preview, which drives its own
   * looping clock. This component still mounts, so that arriving at a run does
   * not change the shape of the tree underneath the provider - see below.
   */
  enabled: boolean;
}) {
  const { clock, source } = useSceneRuntime();

  useEffect(() => {
    if (!enabled) return;
    if (duration > 0 && Math.abs(clock.duration - duration) > 0.5) clock.setDuration(duration);
  }, [clock, duration, enabled]);

  useEffect(() => {
    // The preview plays on its own loop - the rover touring the island behind
    // the introduction, badged SCENE PREVIEW - until a run takes the clock.
    if (!enabled) {
      clock.play();
      return;
    }
    if (playing) clock.play();
    else clock.pause();
  }, [clock, playing, enabled]);

  useEffect(() => {
    // While paused the timeline is being *scrubbed* - by someone dragging the
    // transport, or by the video harness stepping one frame at a time - and the
    // scene has to sit exactly on the cursor. Frame-stepped capture depends on
    // this being exact.
    if (!enabled || playing) return;
    clock.setTime(t, false);
  }, [clock, t, playing, enabled]);

  useEffect(() => {
    // While playing, the clock free-runs at frame rate and is *steered*, never
    // snapped: its rate is trimmed by a few per cent toward a target a short
    // playout delay behind the newest sample. Snapping it to each engine tick,
    // which is what this used to do past a 0.35 s drift, is what made the rover
    // stop and lurch.
    if (!enabled || !playing) return undefined;
    let frame = 0;
    const follow = () => {
      frame = requestAnimationFrame(follow);
      const newest = source instanceof EngineSceneStateSource ? source.newest : null;
      if (!newest) return;
      const elapsed = (Math.max(0, performance.now() - newest.receivedAt) / 1000) * speed;
      const target = Math.max(0, Math.min(newest.t, newest.t + elapsed - PLAYOUT_DELAY_S));
      const error = target - clock.time;
      if (Math.abs(error) > RESYNC_S) {
        clock.setTime(target, false);
        clock.setSpeed(speed, false);
        return;
      }
      // Close the gap over a second or so, within 30 % of the run's own rate:
      // fast enough to hold the playout delay, too gentle to see.
      clock.setSpeed(speed * Math.min(1.3, Math.max(0.7, 1 + error * 1.5)), false);
    };
    frame = requestAnimationFrame(follow);
    return () => {
      cancelAnimationFrame(frame);
      clock.setSpeed(speed, false);
    };
  }, [clock, source, playing, speed, enabled]);

  return null;
}

/** The three cameras the run views offer; Scene Lab has the full set. */
export type MissionCamera = 'follow' | 'overview' | 'closeup' | 'cinematic';

/** Pushes the page's camera choice into the scene's settings store. */
function CameraSync({ camera }: { camera: MissionCamera }) {
  const setSettings = useSetSceneSettings();
  useEffect(() => {
    setSettings({ camera });
  }, [camera, setSettings]);
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
  onSceneReady,
  camera = 'follow',
  speed = 1,
  adaptive = true,
  inline = false,
}: {
  source: EngineSceneStateSource;
  t: number;
  duration: number;
  playing: boolean;
  /** Playback rate of the run, from its state. */
  speed?: number;
  /** See `SceneStage`'s `adaptive`. */
  adaptive?: boolean;
  /** See `SceneStage`'s `inline`: capture draws on a canvas of its own. */
  inline?: boolean;
  className?: string;
  preview?: boolean;
  /** The scene has loaded and drawn - see `SceneStage`'s `onReady`. */
  onSceneReady?: () => void;
  camera?: MissionCamera;
}) {
  // The device's known ceiling from the first frame: a software rasteriser
  // starts on the low tier instead of compiling the high one and switching.
  const [initialSettings] = useState(() => ({ ...MISSION_SETTINGS, quality: qualityCeiling() }));
  // One tree, whether or not a run has arrived yet. Returning a *different*
  // tree for preview put `SceneStage` at a different child index, so the moment
  // a run appeared React unmounted the canvas and built a new one - a WebGL
  // context and a glTF reload for a change of data source. Swapping only the
  // `source` prop rebuilds the runtime and leaves everything below it alone.
  return (
    <SceneRuntimeProvider source={preview ? previewSource : source} initialSettings={initialSettings}>
      <ClockSync t={t} duration={duration} playing={playing} speed={speed} enabled={!preview} />
      <CameraSync camera={camera} />
      <SceneStage className={className} onReady={onSceneReady} adaptive={adaptive} inline={inline} />
    </SceneRuntimeProvider>
  );
}
