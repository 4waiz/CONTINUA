'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-D43B22CD6829 */

/**
 * The second dock bay, DOCK 02 (scripts/blender/build_dock_two.py): the first
 * bay's twin, across the route from the dock's equipment, where the normal
 * rover starts when it drives beside CONTINUA (`world/lanes.ts`). Its tether
 * is where the normal rover's cable hangs while it is docked.
 *
 * Its status line, like DOCK 01's (`WorldProps.tsx`), is red while a rover
 * stands in the bay and green once the bay is clear: read from the normal
 * rover's place on the route, so a frame is still a pure function of the
 * clock - and green with no normal rover in it. Decoration, never a
 * measurement.
 */

import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Color, Mesh, MeshStandardMaterial } from 'three';
import { smoothstep } from '../math/noise';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { DOCK_TWO_PLACEMENT } from '../world/dock';
import { terrain } from '../world/terrain';
import { DOCK_TWO_MODEL_URL } from './assets';

const STATUS = 'W_Dock_Status';
const STATUS_DOCKED = new Color('#FF3B30');
const STATUS_CLEAR = new Color('#2FD35C');

export function DockTwo() {
  const { scene } = useGLTF(DOCK_TWO_MODEL_URL);
  const { companionFrame } = useSceneRuntime();
  const { object, status } = useMemo(() => {
    const object = scene.clone(true);
    // This scene's own status material: the glTF's is shared through the cache.
    let status = null as MeshStandardMaterial | null;
    object.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.material instanceof MeshStandardMaterial && node.material.name === STATUS) {
        status ??= node.material.clone();
        node.material = status;
      }
    });
    return { object, status };
  }, [scene]);
  useEffect(() => () => status?.dispose(), [status]);

  useFrame(() => {
    if (!status) return;
    const distance = companionFrame.current?.vehicle.distance ?? Infinity;
    status.emissive.copy(STATUS_DOCKED).lerp(STATUS_CLEAR, smoothstep(0.15, 0.45, distance));
  });

  const { x, z, yaw } = DOCK_TWO_PLACEMENT;
  return (
    <group name="CONTINUA_DockTwo" position={[x, terrain.height(x, z), z]} rotation={[0, yaw, 0]}>
      <primitive object={object} />
    </group>
  );
}

useGLTF.preload(DOCK_TWO_MODEL_URL);
