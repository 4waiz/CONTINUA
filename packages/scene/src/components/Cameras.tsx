'use client';

/**
 * Camera rigs.
 *
 * Every camera is a pure function of `clock.time` - no springs, no smoothing
 * over previous frames. That means scrubbing to a timestamp reproduces exactly
 * the frame you would have got by playing to it, which Phase 3 capture needs,
 * and it also removes the jitter a naive lerp-to-target introduces.
 *
 * Smoothness comes instead from sampling the route's *smoothed* heading over a
 * window, which is inherently continuous.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Vector3, type PerspectiveCamera } from 'three';
import type { AccessNetworkId, CameraMode, SceneState, StoryShot, StoryShotId } from '@continua/contracts';
import { clamp } from '../math/noise';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { route } from '../world/route';
import { roadSurfaceY } from '../world/road';
import type { DeadZone } from '../world/deadZones';
import { SATELLITE_SKY, siteForNetwork } from '../world/sites';
import { terrain } from '../world/terrain';

/** Keep the camera this far above whatever ground is beneath it. */
const GROUND_CLEARANCE = 2.2;

interface Shot {
  position: Vector3;
  target: Vector3;
  fov: number;
}

/**
 * The rover's heading along the route, smoothed over `window` metres: the
 * route's own heading, turned round on a reversed run (`dir` -1).
 */
function travelHeading(distance: number, dir: number, window: number, lag = 0): number {
  const heading = route.smoothHeadingAt(distance - lag * dir, window);
  return dir < 0 ? heading + Math.PI : heading;
}

/**
 * Behind and above, aimed a few metres ahead of the rover. Aimed 16 m up the
 * road, as it was, the rover sat low in the frame - under the dock, on a
 * laptop screen. The road ahead still fills the upper half.
 */
function followShot(distance: number, dir: number, out: Shot): Shot {
  const back = 14.5;
  const height = 5.6;
  const lead = 5;

  const heading = travelHeading(distance, dir, 30, 4);
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const anchor = route.at(distance);
  const anchorY = roadSurfaceY(distance);

  out.position.set(anchor.x - cos * back, anchorY + height, anchor.z + sin * back);
  const ahead = route.at(distance + lead * dir);
  out.target.set(ahead.x, roadSurfaceY(distance + lead * dir) + 1.1, ahead.z);
  out.fov = 42;
  return out;
}

function closeupShot(distance: number, dir: number, time: number, out: Shot): Shot {
  const heading = travelHeading(distance, dir, 14);
  const orbit = heading + 2.35 + Math.sin(time * 0.16) * 0.28;
  const radius = 7.4;
  const anchor = route.at(distance);
  const anchorY = roadSurfaceY(distance);

  out.position.set(
    anchor.x + Math.cos(orbit) * radius,
    anchorY + 2.15,
    anchor.z - Math.sin(orbit) * radius,
  );
  out.target.set(anchor.x, anchorY + 1.25, anchor.z);
  out.fov = 34;
  return out;
}

function overviewShot(distance: number, dir: number, time: number, out: Shot): Shot {
  const heading = travelHeading(distance, dir, 90);
  const orbit = heading + 2.2 + Math.sin(time * 0.045) * 0.16;
  const radius = 68;
  const anchor = route.at(distance);
  const anchorY = roadSurfaceY(distance);

  out.position.set(
    anchor.x + Math.cos(orbit) * radius,
    anchorY + 34,
    anchor.z - Math.sin(orbit) * radius,
  );
  const ahead = route.at(distance + 48 * dir);
  out.target.set(
    (anchor.x + ahead.x) / 2,
    anchorY + 4,
    (anchor.z + ahead.z) / 2,
  );
  out.fov = 40;
  return out;
}

// ---------------------------------------------------------------------------
// Cinematic: a director that cuts between angles on the rover
// ---------------------------------------------------------------------------

/** Rover-relative placement: `ahead` along the heading, `left` across it. */
function aroundRover(distance: number, dir: number, ahead: number, left: number, up: number, out: Vector3): Vector3 {
  const heading = travelHeading(distance, dir, 20);
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const anchor = route.at(distance);
  // Heading 0 faces +X; "left" of travel is -Z rotated with it.
  return out.set(
    anchor.x + cos * ahead - sin * left,
    roadSurfaceY(distance) + up,
    anchor.z - sin * ahead - cos * left,
  );
}

type ShotFn = (distance: number, time: number, out: Shot, dir: number) => Shot;

const CINEMATIC: readonly { seconds: number; shot: ShotFn; blend?: number }[] = [
  // The island from the air: high over its north-west shore, looking down
  // across the rover to the coast, the sea and the mountains beyond - then a
  // long descent to the rover.
  {
    seconds: 12,
    blend: 4.5,
    shot: (d, t, out) => {
      const anchor = route.at(d);
      const y = roadSurfaceY(d);
      out.position.set(anchor.x - 250 + Math.sin(t * 0.05) * 30, y + 135, anchor.z + 115);
      out.target.set(anchor.x + 230, y - 12, anchor.z - 135);
      out.fov = 50;
      return out;
    },
  },
  // Behind and above: where the story starts.
  { seconds: 10, shot: (d, _t, out, dir) => followShot(d, dir, out) },
  // Tracking alongside, low: the rover as a vehicle, the world sliding past.
  // Inside the roadside planting (beds at 8.6 m, palms at 12.5 m), so nothing
  // passes between the camera and the rover.
  {
    seconds: 9,
    shot: (d, t, out, dir) => {
      aroundRover(d, dir, 1.2 + Math.sin(t * 0.3) * 1.2, 6.4, 2.1, out.position);
      aroundRover(d, dir, 0.6, 0, 1.2, out.target);
      out.fov = 38;
      return out;
    },
  },
  // A slow high orbit: the rover in its place, the network sites around it.
  {
    seconds: 11,
    shot: (d, t, out, dir) => {
      const heading = travelHeading(d, dir, 60);
      const orbit = heading + 2.4 + t * 0.07;
      const anchor = route.at(d);
      const y = roadSurfaceY(d);
      // High enough to look down past the palm avenue rather than through it.
      out.position.set(anchor.x + Math.cos(orbit) * 42, y + 27, anchor.z - Math.sin(orbit) * 42);
      out.target.set(anchor.x, y + 2, anchor.z);
      out.fov = 40;
      return out;
    },
  },
  // Low and ahead, looking back down the road it is driving.
  {
    seconds: 8,
    shot: (d, _t, out, dir) => {
      aroundRover(d, dir, 17, -3.5, 1.7, out.position);
      aroundRover(d, dir, 0, 0, 1.35, out.target);
      out.fov = 34;
      return out;
    },
  },
  // A crane pulling up and back: the route ahead opening out - and on up,
  // into the aerial that begins the cycle again.
  {
    seconds: 10,
    blend: 4.5,
    shot: (d, t, out, dir) => {
      aroundRover(d, dir, -26, 6, 13 + Math.sin(t * 0.25) * 3, out.position);
      aroundRover(d, dir, 34, 0, 2, out.target);
      out.fov = 42;
      return out;
    },
  },
];
const CINEMATIC_CYCLE = CINEMATIC.reduce((sum, entry) => sum + entry.seconds, 0);
const BLEND_S = 2.5;
const _shotA: Shot = { position: new Vector3(), target: new Vector3(), fov: 40 };
const _shotB: Shot = { position: new Vector3(), target: new Vector3(), fov: 40 };

/**
 * A pure function of time, like every rig here: the same `t` is always the
 * same framing. Each shot holds, then eases into the next over the last
 * seconds of its slot, so the camera never cuts and never stops.
 */
function cinematicShot(distance: number, dir: number, time: number, out: Shot): Shot {
  const local = ((time % CINEMATIC_CYCLE) + CINEMATIC_CYCLE) % CINEMATIC_CYCLE;
  let start = 0;
  let index = 0;
  while (index < CINEMATIC.length - 1 && local >= start + CINEMATIC[index]!.seconds) {
    start += CINEMATIC[index]!.seconds;
    index += 1;
  }
  const current = CINEMATIC[index]!;
  const next = CINEMATIC[(index + 1) % CINEMATIC.length]!;
  current.shot(distance, time, _shotA, dir);
  const blend = current.blend ?? BLEND_S;
  const into = local - (start + current.seconds - blend);
  if (into <= 0) {
    out.position.copy(_shotA.position);
    out.target.copy(_shotA.target);
    out.fov = _shotA.fov;
    return out;
  }
  next.shot(distance, time, _shotB, dir);
  const x = Math.min(1, into / blend);
  const k = x * x * (3 - 2 * x);
  out.position.lerpVectors(_shotA.position, _shotB.position, k);
  out.target.lerpVectors(_shotA.target, _shotB.target, k);
  out.fov = _shotA.fov + (_shotB.fov - _shotA.fov) * k;
  return out;
}

// ---------------------------------------------------------------------------
// Story: the framings the story mode cuts between
// ---------------------------------------------------------------------------

/**
 * Each story framing, a pure function of the rover's place and the clock like
 * every rig here. Rover-relative, so they hold on the rover whatever its speed;
 * the story chooses which one and when.
 */
const STORY_SHOTS: Record<StoryShotId, (d: number, dir: number, t: number, out: Shot) => Shot> = {
  // Round the rover in its bay, wide enough for the bay and its gantry.
  dock: (d, dir, t, out) => {
    const heading = travelHeading(d, dir, 14);
    const orbit = heading + 2.55 + Math.sin(t * 0.14) * 0.22;
    const anchor = route.at(d);
    const y = roadSurfaceY(d);
    out.position.set(anchor.x + Math.cos(orbit) * 11.5, y + 3.6, anchor.z - Math.sin(orbit) * 11.5);
    out.target.set(anchor.x, y + 1.0, anchor.z);
    out.fov = 40;
    return out;
  },
  // Behind and above, aimed at the rover rather than the road ahead: the
  // rover sits in the middle of the frame, clear of the story's caption.
  follow: (d, dir, _t, out) => {
    aroundRover(d, dir, -13, 0, 9.6, out.position);
    aroundRover(d, dir, 8, 0, -4.4, out.target);
    out.fov = 48;
    return out;
  },
  // Alongside, low: the rover as a vehicle - inside a cutting's walls too.
  alongside: (d, dir, t, out) => {
    aroundRover(d, dir, 1.0 + Math.sin(t * 0.3) * 0.8, 6.0, 2.0, out.position);
    aroundRover(d, dir, 0.6, 0, 1.2, out.target);
    out.fov = 40;
    return out;
  },
  // High behind and to one side, looking up the road: what is coming. Aimed
  // 18 m ahead, the rover sits about half-way down the lower half of the
  // frame with the road and the cutting beyond it; aimed 46 m ahead it sat at
  // the frame's foot, under the story's bar.
  crane: (d, dir, _t, out) => {
    aroundRover(d, dir, -20, -12, 15, out.position);
    aroundRover(d, dir, 18, 0, 0, out.target);
    out.fov = 46;
    return out;
  },
  // Low, ahead, looking back at the rover: walls either side, sky above.
  inside: (d, dir, _t, out) => {
    aroundRover(d, dir, 13, -2.4, 2.1, out.position);
    aroundRover(d, dir, -2, 0, 0.1, out.target);
    out.fov = 54;
    return out;
  },
  // The island from the air, as the cinematic cycle opens.
  aerial: (d, _dir, t, out) => {
    const anchor = route.at(d);
    const y = roadSurfaceY(d);
    out.position.set(anchor.x - 250 + Math.sin(t * 0.05) * 30, y + 135, anchor.z + 115);
    out.target.set(anchor.x + 230, y - 12, anchor.z - 135);
    out.fov = 50;
    return out;
  },
  // Low and ahead, looking back down the road it is driving.
  lead: (d, dir, _t, out) => {
    aroundRover(d, dir, 17, -3.5, 1.7, out.position);
    aroundRover(d, dir, 0, 0, 1.35, out.target);
    out.fov = 34;
    return out;
  },
};

/** How long, in scene seconds, the story's camera takes to ease into a new shot. */
const STORY_BLEND_S = 1.6;
const _storyA: Shot = { position: new Vector3(), target: new Vector3(), fov: 40 };

function storyShot(story: StoryShot, distance: number, dir: number, time: number, out: Shot): Shot {
  STORY_SHOTS[story.id](distance, dir, time, out);
  if (!story.from || story.from === story.id) return out;
  const x = Math.max(0, Math.min(1, (time - story.at) / STORY_BLEND_S));
  if (x >= 1) return out;
  STORY_SHOTS[story.from](distance, dir, time, _storyA);
  const k = x * x * (3 - 2 * x);
  out.position.lerpVectors(_storyA.position, out.position, k);
  out.target.lerpVectors(_storyA.target, out.target, k);
  out.fov = _storyA.fov + (out.fov - _storyA.fov) * k;
  return out;
}

function turntableShot(time: number, out: Shot): Shot {
  const anchor = route.at(0);
  const anchorY = roadSurfaceY(0);
  const angle = time * 0.32;
  const radius = 10.6;
  out.position.set(
    anchor.x + Math.cos(angle) * radius,
    anchorY + 3.1 + Math.sin(time * 0.11) * 0.7,
    anchor.z - Math.sin(angle) * radius,
  );
  out.target.set(anchor.x, anchorY + 1.15, anchor.z);
  out.fov = 34;
  return out;
}

/** Degrees to radians and back. */
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// A change of network, shown: where the new link comes from
// ---------------------------------------------------------------------------

/**
 * When the carrying network changes, the follow and close-up cameras turn to
 * show where the new link comes from - the access point, the mast, the sky -
 * hold it, and come back. A beam that ran off the edge of the frame said a
 * link had changed but not to what. Scene seconds, so a scrubbed or captured
 * frame is the same as a played one.
 */
const REVEAL_IN_S = 1.2;
const REVEAL_HOLD_S = 2.6;
const REVEAL_OUT_S = 1.6;
const REVEAL_S = REVEAL_IN_S + REVEAL_HOLD_S + REVEAL_OUT_S;

function smooth01(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/** How far into a change's reveal the camera is: 0 before and after, 1 while it holds. */
function revealWeight(age: number): number {
  if (age < 0 || age > REVEAL_S) return 0;
  if (age < REVEAL_IN_S) return smooth01(age / REVEAL_IN_S);
  if (age < REVEAL_IN_S + REVEAL_HOLD_S) return 1;
  return 1 - smooth01((age - REVEAL_IN_S - REVEAL_HOLD_S) / REVEAL_OUT_S);
}

const SKY = new Vector3(SATELLITE_SKY.x, SATELLITE_SKY.y, SATELLITE_SKY.z).normalize();
const _end = new Vector3();
const _toRover = new Vector3();
const _toEnd = new Vector3();
const _aim = new Vector3();
/** The furthest the rover may sit from the middle of a reveal, so it stays in the clear part of the screen. */
const REVEAL_ROVER_MAX = 15 * (Math.PI / 180);
/** Metres around a cutting in which a reveal keeps to the road, clear of the walls and banks. */
const CUTTING_MARGIN_M = 30;

/**
 * Toward the other end of `network`'s link - the access point, the mast, or
 * the sky the satellite link climbs into - with the rover in the frame.
 *
 * The camera stands back from the rover and a little above it, part-way
 * between behind it on the road and over its shoulder away from the far end,
 * so the rover and the far end line up near the middle of the screen - a mast
 * far off to one side otherwise sat behind a side panel - and low enough that
 * the rover below and the antenna beyond both fit between the status cards
 * and the dock. Near a cutting, and for satellite,
 * it keeps to the road - a camera off to the side stood inside the walls.
 * When the far end is behind the rover, the camera looks back from in front.
 * False when there is nothing to show - the cable, at the dock.
 */
function revealShot(state: SceneState, network: AccessNetworkId, out: Shot, zones: readonly DeadZone[]): boolean {
  if (network === 'wired') return false;
  const rover = state.vehicle.position;
  if (network === 'satellite') {
    _end.set(rover.x + SKY.x * 10, rover.y + 2 + SKY.y * 10, rover.z + SKY.z * 10);
  } else {
    const site = siteForNetwork(network, rover.x, rover.z);
    if (!site) return false;
    const ax = site.x + (site.linkOffset?.[0] ?? 0);
    const az = site.z + (site.linkOffset?.[1] ?? 0);
    _end.set(ax, terrain.height(ax, az) + (site.linkHeight ?? 3), az);
  }
  const along = state.vehicle.distance;
  const heading = travelHeading(along, state.vehicle.direction ?? 1, 20);
  const forwardX = Math.cos(heading);
  const forwardZ = -Math.sin(heading);
  const offX = _end.x - rover.x;
  const offZ = _end.z - rover.z;
  const across = Math.hypot(offX, offZ);
  const ahead = offX * forwardX + offZ * forwardZ;
  const behind = ahead < -0.5 * across;
  const nearCutting = zones.some(
    (zone) => along > zone.from - zone.ramp - CUTTING_MARGIN_M && along < zone.to + zone.ramp + CUTTING_MARGIN_M,
  );
  const onRoad = network === 'satellite' || nearCutting || across < 2;
  // Which way from the rover the camera stands, flat: behind it on the road
  // (or in front, when the far end is behind), turned toward over-the-shoulder.
  let dx = behind ? forwardX : -forwardX;
  let dz = behind ? forwardZ : -forwardZ;
  if (!onRoad) {
    const share = behind ? 1 : 0.4;
    dx = dx * (1 - share) - (offX / across) * share;
    dz = dz * (1 - share) - (offZ / across) * share;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
  }
  out.position.set(rover.x + dx * 16, rover.y + 5, rover.z + dz * 16);
  // Between the rover and the far end, leaning to the far end - but never so
  // far that the rover leaves the middle of the frame.
  _toRover.set(rover.x, rover.y + 1, rover.z).sub(out.position).normalize();
  _toEnd.copy(_end).sub(out.position).normalize();
  _aim.copy(_toRover).multiplyScalar(0.45).addScaledVector(_toEnd, 0.55).normalize();
  const apart = _aim.angleTo(_toRover);
  if (apart > REVEAL_ROVER_MAX) _aim.lerpVectors(_toRover, _aim, REVEAL_ROVER_MAX / apart).normalize();
  out.target.copy(out.position).addScaledVector(_aim, 20);
  out.fov = 50;
  return true;
}

const _base: Shot = { position: new Vector3(), target: new Vector3(), fov: 40 };
const _reveal: Shot = { position: new Vector3(), target: new Vector3(), fov: 40 };
const _delta = new Vector3();

function mixInto(shot: Shot, reveal: Shot, weight: number): void {
  shot.position.addScaledVector(_delta.subVectors(reveal.position, _base.position), weight);
  shot.target.addScaledVector(_delta.subVectors(reveal.target, _base.target), weight);
  shot.fov += (reveal.fov - _base.fov) * weight;
}

/**
 * Mixes the reveal of the latest change - and, while it fades, the one before
 * it - into `shot`. A change that comes while the last one is still on screen
 * takes over from it rather than cutting back to the rover first.
 */
function applyReveals(state: SceneState, time: number, shot: Shot, zones: readonly DeadZone[]): void {
  const latest = state.handoff ?? null;
  if (!latest) return;
  const before = state.handoffBefore ?? null;
  const w1 = revealWeight(time - latest.at);
  let w0 = before ? revealWeight(time - before.at) : 0;
  if (w0 > 0 && time >= latest.at) w0 *= 1 - smooth01((time - latest.at) / REVEAL_IN_S);
  if (w0 <= 1e-4 && w1 <= 1e-4) return;
  _base.position.copy(shot.position);
  _base.target.copy(shot.target);
  _base.fov = shot.fov;
  if (before && w0 > 1e-4 && revealShot(state, before.to, _reveal, zones)) mixInto(shot, _reveal, w0);
  if (w1 > 1e-4 && revealShot(state, latest.to, _reveal, zones)) mixInto(shot, _reveal, w1);
}

const NO_ZONES: readonly DeadZone[] = [];

export function SceneCameras({
  mode,
  story,
  inset,
  zones = NO_ZONES,
}: {
  mode: CameraMode;
  story?: StoryShot;
  /** The page's panels over the canvas, top and bottom, in CSS pixels. */
  inset?: { top: number; bottom: number };
  /** The scenario's cuttings, where a reveal keeps to the road. */
  zones?: readonly DeadZone[];
}) {
  const { clock, frame } = useSceneRuntime();
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const size = useThree((state) => state.size);
  const shot = useMemo<Shot>(
    () => ({ position: new Vector3(), target: new Vector3(), fov: 40 }),
    [],
  );
  const lookTarget = useRef(new Vector3());

  useFrame(() => {
    const state = frame.current;
    const distance = state.vehicle.distance;
    const dir = state.vehicle.direction ?? 1;
    const time = clock.time;

    switch (mode) {
      case 'turntable':
        turntableShot(time, shot);
        break;
      case 'closeup':
        closeupShot(distance, dir, time, shot);
        applyReveals(state, time, shot, zones);
        break;
      case 'overview':
        overviewShot(distance, dir, time, shot);
        break;
      case 'cinematic':
        cinematicShot(distance, dir, time, shot);
        break;
      case 'story':
        if (story) storyShot(story, distance, dir, time, shot);
        else followShot(distance, dir, shot);
        break;
      case 'follow':
      default:
        followShot(distance, dir, shot);
        applyReveals(state, time, shot, zones);
        break;
    }

    // Never let the camera dip into a hill.
    const groundY = terrain.surfaceHeight(shot.position.x, shot.position.z) + GROUND_CLEARANCE;
    shot.position.y = Math.max(shot.position.y, groundY);

    camera.position.copy(shot.position);
    lookTarget.current.copy(shot.target);
    camera.lookAt(lookTarget.current);

    // A lens shift, not a different shot: with panels over part of the
    // canvas, the picture is moved so the framed subject sits in the middle of
    // the part that shows. The full frustum is the visible one plus the shift,
    // widened so the visible part keeps the shot's own field of view.
    const width = size.width;
    const height = size.height;
    const shift = inset ? (inset.bottom - inset.top) / 2 : 0;
    if (Math.abs(shift) >= 1 && width > 0 && height > 0) {
      const fullHeight = height + 2 * Math.abs(shift);
      camera.setViewOffset(width, fullHeight, 0, shift > 0 ? 2 * Math.abs(shift) : 0, width, height);
      camera.aspect = width / fullHeight;
      camera.fov = (2 * Math.atan(Math.tan((shot.fov * DEG) / 2) * (fullHeight / height))) / DEG;
    } else {
      if (camera.view?.enabled) camera.clearViewOffset();
      if (height > 0) camera.aspect = width / height;
      camera.fov = shot.fov;
    }
    camera.near = clamp(shot.position.distanceTo(shot.target) * 0.01, 0.1, 2);
    camera.far = 2600;
    camera.updateProjectionMatrix();
  });

  return null;
}
