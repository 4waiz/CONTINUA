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
  NO_DEAD_ZONES,
  previewSource,
  qualityCeiling,
  SceneRuntimeProvider,
  useSceneRuntime,
  useSetSceneSettings,
  type DeadZone,
} from '@continua/scene';
import type { StoryShot } from '@continua/contracts';
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
/** How long an arrival keeps a say in where the engine is - see `ClockSync`. */
const ANCHOR_WINDOW_MS = 3000;
/**
 * The landing's picture: the preview held still at this moment, so nothing
 * moves - and nothing looks as if it has started - until the viewer presses
 * the way in.
 */
const STILL_AT_S = 4.5;

/** Site markers are an inspection aid for Scene Lab; the mission view hides them. */
const MISSION_SETTINGS = { showMarkers: false } as const;

function ClockSync({
  t,
  duration,
  playing,
  speed,
  enabled,
  still,
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
  /** Hold the preview still (the landing). */
  still: boolean;
}) {
  const { clock, source } = useSceneRuntime();

  useEffect(() => {
    if (!enabled) return;
    if (duration > 0 && Math.abs(clock.duration - duration) > 0.5) clock.setDuration(duration);
  }, [clock, duration, enabled]);

  useEffect(() => {
    // Behind the introduction the preview holds one picture; elsewhere it plays
    // its own loop - the rover touring the island, badged SCENE PREVIEW - until
    // a run takes the clock.
    if (!enabled && still) {
      clock.pause();
      clock.setTime(STILL_AT_S, false);
      return;
    }
    if (!enabled) {
      clock.play();
      return;
    }
    if (playing) clock.play();
    else clock.pause();
  }, [clock, playing, enabled, still]);

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
    // playout delay behind the engine. Snapping it to each engine tick, which
    // is what this used to do past a 0.35 s drift, is what made the rover stop
    // and lurch.
    //
    // The target follows where the engine *is*, not when its newest sample
    // happened to arrive. Samples are 0.1 s apart and reach the browser in
    // ticks of a sixteenth of a second, each a little late, so "newest sample
    // plus the time since it arrived" jumps back and forth by tens of
    // milliseconds at every arrival - and the clock, chasing it, sped up and
    // slowed down several times a second. Each arrival instead gives an
    // estimate of the engine's sim time at a wall time; a late one
    // underestimates it, never overestimates, so the best estimate is the
    // highest of the last few seconds' - a line that only ever moves when the
    // engine itself changes pace.
    if (!enabled || !playing) return undefined;
    let frame = 0;
    const arrivals: { at: number; offset: number }[] = [];
    let lastArrival = -1;
    const follow = () => {
      frame = requestAnimationFrame(follow);
      const newest = source instanceof EngineSceneStateSource ? source.newest : null;
      if (!newest) return;
      const now = performance.now();
      if (newest.receivedAt !== lastArrival) {
        lastArrival = newest.receivedAt;
        arrivals.push({ at: newest.receivedAt, offset: newest.t - (newest.receivedAt / 1000) * speed });
      }
      while (arrivals.length > 1 && now - arrivals[0]!.at > ANCHOR_WINDOW_MS) arrivals.shift();
      let anchor = -Infinity;
      for (const arrival of arrivals) anchor = Math.max(anchor, arrival.offset);
      const engineNow = (now / 1000) * speed + anchor;
      // Never ahead of the newest sample: past it there is nothing to show.
      const target = Math.max(0, Math.min(newest.t, engineNow - PLAYOUT_DELAY_S));
      const error = target - clock.time;
      if (Math.abs(error) > RESYNC_S) {
        clock.setTime(target, false);
        clock.setSpeed(speed, false);
        return;
      }
      // Close the gap over a second or so, within a quarter of the run's own
      // rate: fast enough to hold the playout delay, too gentle to see.
      clock.setSpeed(speed * Math.min(1.25, Math.max(0.75, 1 + error * 1.2)), false);
    };
    frame = requestAnimationFrame(follow);
    return () => {
      cancelAnimationFrame(frame);
      clock.setSpeed(speed, false);
    };
  }, [clock, source, playing, speed, enabled]);

  return null;
}

/** The cameras the run views offer; Scene Lab has the full set. 'story' is the story mode's. */
export type MissionCamera = 'follow' | 'overview' | 'closeup' | 'cinematic' | 'story';

/** Pushes the flight settings - on or off, and the run's playback rate - into the scene. */
function FlightSync({ on, pace }: { on: boolean; pace: number }) {
  const setSettings = useSetSceneSettings();
  useEffect(() => {
    setSettings({ linkFlights: on, flightPace: pace });
  }, [on, pace, setSettings]);
  return null;
}

/** Pushes the normal rover's run - the second rover, when comparing - and the run's own rover's name into the scene. */
function CompanionSync({ source, name }: { source: EngineSceneStateSource | null; name: string }) {
  const setSettings = useSetSceneSettings();
  useEffect(() => {
    setSettings({ companion: source, roverName: name });
    return () => setSettings({ companion: null });
  }, [source, name, setSettings]);
  return null;
}

/** Pushes the coverage overlay - where each network reaches - into the scene. */
function CoverageSync({ on }: { on: boolean }) {
  const setSettings = useSetSceneSettings();
  useEffect(() => {
    setSettings({ showCoverage: on });
  }, [on, setSettings]);
  return null;
}

/** Pushes the page's camera choice into the scene's settings store. */
function CameraSync({ camera }: { camera: MissionCamera }) {
  const setSettings = useSetSceneSettings();
  useEffect(() => {
    setSettings({ camera });
  }, [camera, setSettings]);
  return null;
}

/**
 * Pushes the scenario's dead zones - where it shadows the radio links - into
 * the scene, which stands the walled lane there. The same array for the same
 * scenario, so the walls are built once.
 */
function DeadZoneSync({ zones }: { zones: readonly DeadZone[] }) {
  const setSettings = useSetSceneSettings();
  useEffect(() => {
    setSettings({ deadZones: zones });
  }, [zones, setSettings]);
  return null;
}

/** Pushes how much of the canvas the page's panels cover into the scene's cameras. */
function InsetSync({ top, bottom }: { top: number; bottom: number }) {
  const setSettings = useSetSceneSettings();
  useEffect(() => {
    setSettings({ viewInset: { top, bottom } });
  }, [top, bottom, setSettings]);
  return null;
}

/** Pushes the story's framing into the scene; the camera eases into it from the last. */
function StoryShotSync({ shot }: { shot: StoryShot | null }) {
  const setSettings = useSetSceneSettings();
  useEffect(() => {
    if (shot) setSettings({ storyShot: shot });
  }, [shot, setSettings]);
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
  deadZones = NO_DEAD_ZONES,
  storyShot = null,
  inset,
  still = false,
  flights = true,
  coverage = false,
  companion = null,
  roverName = 'CONTINUA',
}: {
  source: EngineSceneStateSource;
  /** The normal rover's run, drawn as a second rover beside this one; null for one rover. */
  companion?: EngineSceneStateSource | null;
  /** The run's own rover's name, for its tag when the normal rover drives beside it. */
  roverName?: string;
  /** Fly the camera out to each new link. */
  flights?: boolean;
  /** Show where each network reaches. */
  coverage?: boolean;
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
  /** Where the scenario on screen shadows the links (`deadZonesFromFaults`). */
  deadZones?: readonly DeadZone[];
  /** The story mode's framing, used with `camera` 'story'. */
  storyShot?: StoryShot | null;
  /**
   * How much of the canvas the page's own panels cover, top and bottom, in CSS
   * pixels: the cameras centre what they frame in the part that shows.
   */
  inset?: { top: number; bottom: number };
  /** Hold the preview on one still picture - the landing, before anything is pressed. */
  still?: boolean;
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
      <ClockSync t={t} duration={duration} playing={playing} speed={speed} enabled={!preview} still={still} />
      <FlightSync on={flights} pace={speed} />
      <CoverageSync on={coverage} />
      <CompanionSync source={preview ? null : companion} name={roverName} />
      <CameraSync camera={camera} />
      <DeadZoneSync zones={deadZones} />
      <StoryShotSync shot={storyShot} />
      <InsetSync top={inset?.top ?? 0} bottom={inset?.bottom ?? 0} />
      <SceneStage className={className} onReady={onSceneReady} adaptive={adaptive} inline={inline} />
    </SceneRuntimeProvider>
  );
}
