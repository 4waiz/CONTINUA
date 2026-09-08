'use client';

/**
 * Camera rigs.
 *
 * Every camera is a pure function of `clock.time` — no springs, no smoothing
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
      case 'follow':
      default:
        followShot(distance, shot);
        break;
    }

    // Never let the camera dip into a hill.
    const groundY = terrain.height(shot.position.x, shot.position.z) + GROUND_CLEARANCE;
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
