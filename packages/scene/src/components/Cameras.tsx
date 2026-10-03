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
import type { CameraMode } from '@continua/contracts';
import { clamp } from '../math/noise';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { route } from '../world/route';
import { roadSurfaceY } from '../world/road';
import { terrain } from '../world/terrain';

/** Keep the camera this far above whatever ground is beneath it. */
const GROUND_CLEARANCE = 2.2;

interface Shot {
  position: Vector3;
  target: Vector3;
  fov: number;
}

function followShot(distance: number, out: Shot): Shot {
  const back = 14.5;
  const height = 5.2;
  const lead = 16;

  const heading = route.smoothHeadingAt(distance - 4, 30);
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const anchor = route.at(distance);
  const anchorY = roadSurfaceY(distance);

  out.position.set(anchor.x - cos * back, anchorY + height, anchor.z + sin * back);
  const ahead = route.at(distance + lead);
  out.target.set(ahead.x, roadSurfaceY(distance + lead) + 1.4, ahead.z);
  out.fov = 42;
  return out;
}

function closeupShot(distance: number, time: number, out: Shot): Shot {
  const heading = route.smoothHeadingAt(distance, 14);
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

function overviewShot(distance: number, time: number, out: Shot): Shot {
  const heading = route.smoothHeadingAt(distance, 90);
  const orbit = heading + 2.2 + Math.sin(time * 0.045) * 0.16;
  const radius = 68;
  const anchor = route.at(distance);
  const anchorY = roadSurfaceY(distance);

  out.position.set(
    anchor.x + Math.cos(orbit) * radius,
    anchorY + 34,
    anchor.z - Math.sin(orbit) * radius,
  );
  const ahead = route.at(distance + 48);
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
function aroundRover(distance: number, ahead: number, left: number, up: number, out: Vector3): Vector3 {
  const heading = route.smoothHeadingAt(distance, 20);
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

type ShotFn = (distance: number, time: number, out: Shot) => Shot;

const CINEMATIC: readonly { seconds: number; shot: ShotFn }[] = [
  // Behind and above: where the story starts.
  { seconds: 10, shot: (d, _t, out) => followShot(d, out) },
  // Tracking alongside, low: the rover as a vehicle, the world sliding past.
  {
    seconds: 9,
    shot: (d, t, out) => {
      aroundRover(d, 1.2 + Math.sin(t * 0.3) * 1.2, 10, 2.3, out.position);
      aroundRover(d, 0.6, 0, 1.2, out.target);
      out.fov = 38;
      return out;
    },
  },
  // A slow high orbit: the rover in its place, the network sites around it.
  {
    seconds: 11,
    shot: (d, t, out) => {
      const heading = route.smoothHeadingAt(d, 60);
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
    shot: (d, _t, out) => {
      aroundRover(d, 17, -3.5, 1.7, out.position);
      aroundRover(d, 0, 0, 1.35, out.target);
      out.fov = 34;
      return out;
    },
  },
  // A crane pulling up and back: the route ahead opening out.
  {
    seconds: 10,
    shot: (d, t, out) => {
      aroundRover(d, -26, 6, 13 + Math.sin(t * 0.25) * 3, out.position);
      aroundRover(d, 34, 0, 2, out.target);
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
function cinematicShot(distance: number, time: number, out: Shot): Shot {
  const local = ((time % CINEMATIC_CYCLE) + CINEMATIC_CYCLE) % CINEMATIC_CYCLE;
  let start = 0;
  let index = 0;
  while (index < CINEMATIC.length - 1 && local >= start + CINEMATIC[index]!.seconds) {
    start += CINEMATIC[index]!.seconds;
    index += 1;
  }
  const current = CINEMATIC[index]!;
  const next = CINEMATIC[(index + 1) % CINEMATIC.length]!;
  current.shot(distance, time, _shotA);
  const into = local - (start + current.seconds - BLEND_S);
  if (into <= 0) {
    out.position.copy(_shotA.position);
    out.target.copy(_shotA.target);
    out.fov = _shotA.fov;
    return out;
  }
  next.shot(distance, time, _shotB);
  const x = Math.min(1, into / BLEND_S);
  const k = x * x * (3 - 2 * x);
  out.position.lerpVectors(_shotA.position, _shotB.position, k);
  out.target.lerpVectors(_shotA.target, _shotB.target, k);
  out.fov = _shotA.fov + (_shotB.fov - _shotA.fov) * k;
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

export function SceneCameras({ mode }: { mode: CameraMode }) {
  const { clock, frame } = useSceneRuntime();
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const shot = useMemo<Shot>(
    () => ({ position: new Vector3(), target: new Vector3(), fov: 40 }),
    [],
  );
  const lookTarget = useRef(new Vector3());

  useFrame(() => {
    const state = frame.current;
    const distance = state.vehicle.distance;
    const time = clock.time;

    switch (mode) {
      case 'turntable':
        turntableShot(time, shot);
        break;
      case 'closeup':
        closeupShot(distance, time, shot);
        break;
      case 'overview':
        overviewShot(distance, time, shot);
        break;
      case 'cinematic':
        cinematicShot(distance, time, shot);
        break;
      case 'follow':
      default:
        followShot(distance, shot);
        break;
    }

    // Never let the camera dip into a hill.
    const groundY = terrain.surfaceHeight(shot.position.x, shot.position.z) + GROUND_CLEARANCE;
    shot.position.y = Math.max(shot.position.y, groundY);

    camera.position.copy(shot.position);
    lookTarget.current.copy(shot.target);
    camera.lookAt(lookTarget.current);
    if (camera.fov !== shot.fov) {
      camera.fov = shot.fov;
      camera.updateProjectionMatrix();
    }
    camera.near = clamp(shot.position.distanceTo(shot.target) * 0.01, 0.1, 2);
    camera.far = 2600;
    camera.updateProjectionMatrix();
  });

  return null;
}
