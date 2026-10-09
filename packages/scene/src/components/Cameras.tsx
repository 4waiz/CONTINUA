'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-B73F6E0C578B */

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
import type {
  AccessNetworkId,
  CameraMode,
  HandoffMark,
  SceneState,
  SceneStateSource,
  StoryShot,
  StoryShotId,
} from '@continua/contracts';
import type { DownSpan } from '../engine/engineSource';
import { clamp, lerp } from '../math/noise';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { route } from '../world/route';
import { roadSurfaceY } from '../world/road';
import type { DeadZone } from '../world/deadZones';
import { SATELLITE_SKY, siteForNetwork } from '../world/sites';
import { clampCamera, flightAllowance, keepAboveGround } from '../world/tunnel';
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
// A change of network, flown: out to where the new link comes from, and back
// along it to the rover
// ---------------------------------------------------------------------------

/**
 * When the carrying network changes, the follow and close-up cameras
 * leave the rover and fly to the far end of the new link - the access point,
 * the mast - hold there with the beam leaving it for the rover, ride the beam
 * back down to the rover and settle behind it again. For satellite, whose far
 * end is the sky, the camera climbs high up the rover's beam, looks down it
 * at the island and the rover far below, and rides it down. A camera that
 * only turned toward the new link left a mast two hundred metres off as a
 * speck at the edge of the frame; this one goes there.
 *
 * Every pose is a pure function of the scene clock, the rover's place and
 * when the link changed, so a scrubbed or captured frame is the same as a
 * played one.
 */
const FLIGHT_OUT_S = 1.7;
const FLIGHT_HOLD_S = 1.2;
const FLIGHT_RIDE_S = 2.3;
const FLIGHT_HOME_S = 1.8;
const FLIGHT_S = FLIGHT_OUT_S + FLIGHT_HOLD_S + FLIGHT_RIDE_S + FLIGHT_HOME_S;
/** The beam's end on the rover, above its contact plane (`Network.tsx`'s roof mast). */
const ROOF_M = 2.25;
/** How far up the satellite beam a flight reaches, metres. */
const SKY_REACH_M = 200;

function smooth01(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/** Smoother at both ends than `smooth01`: a camera that starts and lands without a jolt. */
function smoother01(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

const SKY = new Vector3(SATELLITE_SKY.x, SATELLITE_SKY.y, SATELLITE_SKY.z).normalize();

/** One link, as the flight sees it: the rover's end, the far end, and the arc the beam draws between. */
interface LinkPath {
  sky: boolean;
  rover: Vector3;
  far: Vector3;
  /** The beam's upward bow at its middle, metres, as `Network.tsx` draws it. */
  sag: number;
  span: number;
  /** Flat unit vectors: from the rover toward the far end, and to its left. */
  dir: { x: number; z: number };
  side: { x: number; z: number };
  /** The rover's facing, flat. */
  forward: { x: number; z: number };
}

const _path: LinkPath = {
  sky: false,
  rover: new Vector3(),
  far: new Vector3(),
  sag: 0,
  span: 1,
  dir: { x: 1, z: 0 },
  side: { x: 0, z: -1 },
  forward: { x: 1, z: 0 },
};

/** The link the rover now uses on `network`, or false when there is nothing to fly to (the cable). */
function linkPath(state: SceneState, network: AccessNetworkId, out: LinkPath): boolean {
  if (network === 'wired') return false;
  const vehicle = state.vehicle;
  out.rover.set(vehicle.position.x, vehicle.position.y + ROOF_M, vehicle.position.z);
  out.forward.x = Math.cos(vehicle.heading);
  out.forward.z = -Math.sin(vehicle.heading);
  if (network === 'satellite') {
    out.sky = true;
    out.far.copy(out.rover).addScaledVector(SKY, SKY_REACH_M);
  } else {
    const site = siteForNetwork(network, vehicle.position.x, vehicle.position.z);
    if (!site) return false;
    const ax = site.x + (site.linkOffset?.[0] ?? 0);
    const az = site.z + (site.linkOffset?.[1] ?? 0);
    out.sky = false;
    out.far.set(ax, terrain.height(ax, az) + (site.linkHeight ?? 3), az);
  }
  out.span = Math.max(1, out.rover.distanceTo(out.far));
  out.sag = out.sky ? 0 : Math.min(14, out.span * 0.11);
  let dx = out.far.x - out.rover.x;
  let dz = out.far.z - out.rover.z;
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-3) {
    dx = out.forward.x;
    dz = out.forward.z;
  } else {
    dx /= flat;
    dz /= flat;
  }
  out.dir.x = dx;
  out.dir.z = dz;
  // Left of a flat direction (x, z) is (z, -x): +X's left is -Z.
  out.side.x = dz;
  out.side.z = -dx;
  return true;
}

/** A point on the beam: 0 at the rover, 1 at the far end, bowed as the beam is drawn. */
function pathPoint(path: LinkPath, t: number, out: Vector3): Vector3 {
  out.lerpVectors(path.rover, path.far, t);
  out.y += Math.sin(t * Math.PI) * path.sag;
  return out;
}

/**
 * The far end of a ground link: past the antenna from the rover and off to
 * one side, a little above it, looking back down the beam - the mast in the
 * foreground, its link leaving for the rover in the distance.
 *
 * For satellite the far end is the sky, and the camera goes up there: high
 * on the rover's beam, off to one side of it, looking down it at the island
 * and the rover at its foot - the satellite's view of the link.
 */
function sourceShot(path: LinkPath, out: Shot): Shot {
  if (path.sky) return rideShot(path, 0, out);
  const back = clamp(path.span * 0.14, 9, 28);
  const aside = back * 0.5;
  const lift = clamp(path.span * 0.05, 2.5, 8);
  out.position.set(
    path.far.x + path.dir.x * back + path.side.x * aside,
    path.far.y + lift,
    path.far.z + path.dir.z * back + path.side.z * aside,
  );
  pathPoint(path, 0.84, out.target);
  out.target.y -= 1.5;
  out.fov = 46;
  return out;
}

const _near = new Vector3();
/** Where a ride ends: this far from the rover along the beam, metres, so it lands beside it, not on its roof. */
const RIDE_END_M = 15;

/**
 * Riding the beam down to the rover, `k` from 0 to 1: from just off the
 * antenna - or high up the satellite's beam - beside the beam and a little
 * above it, looking down it and, near the end, at the rover.
 */
function rideShot(path: LinkPath, k: number, out: Shot): Shot {
  const eased = smooth01(k);
  const start = path.sky ? 0.62 : 0.9;
  const end = clamp(RIDE_END_M / path.span, 0.06, 0.45);
  const u = start + (end - start) * eased;
  const off = path.sky ? 8 * (1 - eased) + 3 : clamp(path.span * 0.03, 1.6, 4);
  pathPoint(path, u, out.position);
  out.position.x += path.side.x * off;
  out.position.z += path.side.z * off;
  // Just under the satellite's beam, so it runs from the top of the frame
  // down to the rover; just over a ground link's.
  out.position.y += path.sky ? -12 * (1 - eased) : 2.2;
  _near.set(path.rover.x, path.rover.y - 1.0, path.rover.z);
  if (path.sky) {
    // Down the beam the whole way: the rover at its foot.
    out.target.copy(_near);
    out.fov = 50;
    return out;
  }
  pathPoint(path, Math.max(0, u - 0.22), out.target);
  // The last stretch looks at the rover itself.
  out.target.lerp(_near, smooth01((0.55 - u) / 0.4));
  out.fov = 50;
  return out;
}

function copyShot(from: Shot, to: Shot): Shot {
  to.position.copy(from.position);
  to.target.copy(from.target);
  to.fov = from.fov;
  return to;
}

/**
 * `a` to `b` by `k`, the camera lifting on the way - a swoop, not a slide
 * along the ground. The lift grows with the distance covered.
 */
function swoop(a: Shot, b: Shot, k: number, out: Shot): Shot {
  const lift = clamp(a.position.distanceTo(b.position) * 0.22, 2, 36);
  out.position.lerpVectors(a.position, b.position, k);
  out.position.y += Math.sin(k * Math.PI) * lift;
  out.target.lerpVectors(a.target, b.target, k);
  out.fov = a.fov + (b.fov - a.fov) * k;
  return out;
}

const _source: Shot = { position: new Vector3(), target: new Vector3(), fov: 50 };
const _ride: Shot = { position: new Vector3(), target: new Vector3(), fov: 50 };
/**
 * Above the ground, metres, a flying camera keeps to: clear of the masts'
 * own yards while it holds, and over the crowns of the palm avenue - which a
 * camera riding a Wi-Fi beam down at mast height went straight through - for
 * the ride's second half and the start of the way home. It comes down from
 * it only as it lands behind the rover, on the road.
 */
const FLIGHT_FLOOR_M = 10;
const RIDE_FLOOR_M = 16;

/**
 * Where a flight puts the camera `age` seconds into it: from `from` (where
 * the camera was) out to the far end, a hold there, the ride back along the
 * beam, and home to `home` (where it would otherwise be). False for a link
 * with nothing to fly to.
 */
function flightPose(state: SceneState, network: AccessNetworkId, age: number, from: Shot, home: Shot, out: Shot): boolean {
  if (!linkPath(state, network, _path)) return false;
  sourceShot(_path, _source);
  // A slow drift while it holds, so the far end reads in depth.
  const held = clamp(age - FLIGHT_OUT_S, 0, FLIGHT_HOLD_S);
  _source.position.x += _path.side.x * held * 0.9;
  _source.position.z += _path.side.z * held * 0.9;
  _source.position.y += held * 0.4;
  let floor = FLIGHT_FLOOR_M;
  if (age < FLIGHT_OUT_S) {
    const k = smoother01(age / FLIGHT_OUT_S);
    swoop(from, _source, k, out);
    floor = FLIGHT_FLOOR_M * smooth01(age / (FLIGHT_OUT_S * 0.45));
  } else if (age < FLIGHT_OUT_S + FLIGHT_HOLD_S) {
    copyShot(_source, out);
  } else if (age < FLIGHT_OUT_S + FLIGHT_HOLD_S + FLIGHT_RIDE_S) {
    const k = (age - FLIGHT_OUT_S - FLIGHT_HOLD_S) / FLIGHT_RIDE_S;
    rideShot(_path, k, _ride);
    // Off the hold and onto the beam over the first stretch of the ride.
    const w = smoother01(k / 0.35);
    out.position.lerpVectors(_source.position, _ride.position, w);
    out.target.lerpVectors(_source.target, _ride.target, w);
    out.fov = _source.fov + (_ride.fov - _source.fov) * w;
    floor = FLIGHT_FLOOR_M + (RIDE_FLOOR_M - FLIGHT_FLOOR_M) * smooth01((k - 0.25) / 0.45);
  } else {
    const k = (age - FLIGHT_OUT_S - FLIGHT_HOLD_S - FLIGHT_RIDE_S) / FLIGHT_HOME_S;
    rideShot(_path, 1, _ride);
    swoop(_ride, home, smoother01(k), out);
    floor = RIDE_FLOOR_M * (1 - smooth01((k - 0.3) / 0.62));
  }
  // Over the hill as well as the land: a flight never goes through it.
  keepAboveGround(out.position, floor);
  return true;
}

const _base: Shot = { position: new Vector3(), target: new Vector3(), fov: 40 };
const _earlier: Shot = { position: new Vector3(), target: new Vector3(), fov: 40 };
const _flown: Shot = { position: new Vector3(), target: new Vector3(), fov: 40 };

/**
 * Flies `shot` - the camera's own framing on entry - out to the newest change
 * of link while that flight lasts. A change that comes while the last one is
 * still being flown takes over from wherever that flight has the camera, so
 * the camera never cuts back to the rover first. `pace` stretches every beat
 * by the run's playback rate. Near the ridge tunnel a flight eases back to
 * the rover's own framing, and none flies while the rover is inside: the
 * camera goes in with it rather than coming back through the hill.
 */
function applyFlights(state: SceneState, time: number, pace: number, shot: Shot): void {
  const latest = state.handoff ?? null;
  if (!latest) return;
  const allowance = flightAllowance(state.vehicle.distance, state.vehicle.direction ?? 1);
  if (allowance <= 0) return;
  const before = state.handoffBefore ?? null;
  const ageOf = (mark: HandoffMark) => (time - mark.at) / pace;
  const flying = (mark: HandoffMark) => ageOf(mark) >= 0 && ageOf(mark) <= FLIGHT_S;
  copyShot(shot, _base);
  if (flying(latest)) {
    let from = _base;
    if (before && flying(before) && flightPose(state, before.to, ageOf(before), _base, _base, _earlier)) from = _earlier;
    if (flightPose(state, latest.to, ageOf(latest), from, _base, _flown)) {
      shot.position.lerpVectors(_base.position, _flown.position, allowance);
      shot.target.lerpVectors(_base.target, _flown.target, allowance);
      shot.fov = _base.fov + (_flown.fov - _base.fov) * allowance;
    }
  }
}

// ---------------------------------------------------------------------------
// The normal rover stops: a look back at it
// ---------------------------------------------------------------------------

/**
 * When the normal rover beside the run loses its link for long enough to stand
 * still, the follow and close-up cameras swing round to it: from behind it and
 * off its outer side, over it and up the road to the run's rover driving on.
 * They hold while it stands and ease back once it pulls away. A pure function
 * of the clock and the normal rover's recorded outage, like every rig here;
 * one that lasts less than `LOOK_AFTER_S` is never looked at, so a live run
 * never starts a look it would have to abandon.
 */
const LOOK_AFTER_S = 1.2;
const LOOK_IN_S = 1.1;
/** After its link is back: long enough to see it pull away. */
const LOOK_HOLD_AFTER_S = 1.3;
const LOOK_OUT_S = 1.6;
/** A long outage gets a look this long, then the camera goes back to the run. */
const LOOK_MAX_S = 7;

function smoothUnit(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/** How far into the look the camera is at `time`, 0..1. */
function lookWeight(spans: readonly DownSpan[], time: number, pace: number): number {
  let weight = 0;
  for (const span of spans) {
    const start = span.from + LOOK_AFTER_S * pace;
    if (time < start || (span.to !== Infinity && span.to < start)) continue;
    const end = Math.min(span.to + LOOK_HOLD_AFTER_S * pace, span.from + LOOK_MAX_S * pace);
    const into = smoothUnit((time - start) / (LOOK_IN_S * pace));
    const out = smoothUnit((time - end) / (LOOK_OUT_S * pace));
    weight = Math.max(weight, into * (1 - out));
  }
  return weight;
}

/** Behind the normal rover and off its outer side, aimed past it up the road to the other. */
function lookShot(companion: SceneState, main: SceneState, out: Shot): Shot {
  const c = companion.vehicle.position;
  const m = main.vehicle.position;
  const heading = companion.vehicle.heading;
  const fx = Math.cos(heading);
  const fz = -Math.sin(heading);
  // Left of a flat direction (x, z) is (z, -x). The outer side is the one
  // away from the other rover.
  const lx = fz;
  const lz = -fx;
  const outer = (m.x - c.x) * lx + (m.z - c.z) * lz > 0 ? -1 : 1;
  // Aimed a little past the stopped rover toward the other, not half-way:
  // the stopped one is the subject, the other the background.
  const toward = Math.min(0.22, 9 / Math.max(1, Math.hypot(m.x - c.x, m.z - c.z)));
  out.position.set(c.x - fx * 11 + lx * outer * 4.6, c.y + 4.6, c.z - fz * 11 + lz * outer * 4.6);
  out.target.set(lerp(c.x, m.x, toward), lerp(c.y, m.y, toward) + 1.2, lerp(c.z, m.z, toward));
  out.fov = 50;
  return out;
}

const _look: Shot = { position: new Vector3(), target: new Vector3(), fov: 46 };

export function SceneCameras({
  mode,
  story,
  inset,
  flights = true,
  pace = 1,
  companion = null,
}: {
  mode: CameraMode;
  story?: StoryShot;
  /** The page's panels over the canvas, top and bottom, in CSS pixels. */
  inset?: { top: number; bottom: number };
  /** The scenario's cuttings. Kept for callers; a flight now keeps clear of them by flying. */
  zones?: readonly DeadZone[];
  /** Fly out to each new link, and look back at the normal rover when it stops (follow and close-up cameras). */
  flights?: boolean;
  /** The run's playback rate: a flight's beats last this many scene seconds per second. */
  pace?: number;
  /** The normal rover's run, when it drives beside this one. */
  companion?: SceneStateSource | null;
}) {
  const { clock, frame, companionFrame } = useSceneRuntime();
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const size = useThree((state) => state.size);
  const shot = useMemo<Shot>(
    () => ({ position: new Vector3(), target: new Vector3(), fov: 40 }),
    [],
  );
  const lookTarget = useRef(new Vector3());

  /** Blends the look back at a stopped normal rover over whatever `shot` holds. */
  const applyLook = (state: SceneState, time: number, lookPace: number) => {
    const other = companionFrame.current;
    const spans = (companion as { downSpans?: () => readonly DownSpan[] } | null)?.downSpans?.();
    if (!other || !spans || spans.length === 0) return;
    const weight = lookWeight(spans, time, lookPace);
    if (weight <= 0) return;
    lookShot(other, state, _look);
    shot.position.lerp(_look.position, weight);
    shot.target.lerp(_look.target, weight);
    shot.fov += (_look.fov - shot.fov) * weight;
  };

  useFrame(() => {
    const state = frame.current;
    const distance = state.vehicle.distance;
    const dir = state.vehicle.direction ?? 1;
    const time = clock.time;
    const flightPace = Math.max(1, pace);

    switch (mode) {
      case 'turntable':
        turntableShot(time, shot);
        break;
      case 'closeup':
        closeupShot(distance, dir, time, shot);
        if (flights) applyFlights(state, time, flightPace, shot);
        if (flights) applyLook(state, time, flightPace);
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
        if (flights) applyFlights(state, time, flightPace, shot);
        if (flights) applyLook(state, time, flightPace);
        break;
    }

    // Never let the camera dip into a hill - and in the ridge tunnel, keep it
    // inside the lining.
    clampCamera(shot.position, GROUND_CLEARANCE);

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
