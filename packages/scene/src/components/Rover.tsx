'use client';

/**
 * The rover rig.
 *
 * Loads the exported glTF, re-parents the static parts under one body group so
 * suspension can move them without touching the wheels, and drives everything
 * from `sampleAt(clock.time)`.
 *
 * Orientation contract (docs/ASSET_MANIFEST.md): forward +X, up +Y,
 * wheel spin about local Z, steering about local Y.
 */

import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import {
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  RGBAFormat,
  type Object3D,
} from 'three';
import { clamp, smoothstep } from '../math/noise';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { ROAD_SURFACE_OFFSET } from '../world/road';
import { VEHICLE } from '../preview/previewSource';
import { ROVER_MODEL_LOD1_URL, ROVER_MODEL_URL } from './assets';

export { ROVER_MODEL_LOD1_URL, ROVER_MODEL_URL };

/**
 * A soft contact shadow under the rover, computed once into a small texture.
 *
 * The sun's shadow map gives the rover a cast shadow, but under a canopy or in
 * a building's shade it has none, and a vehicle with no contact darkness reads
 * as floating. This footprint - a rounded-rectangle falloff plus a darker patch
 * under each tyre - is always there. It is a pure function of its size, so
 * every frame is identical.
 */
function contactShadowTexture(width = 256, height = 128): DataTexture {
  const data = new Uint8Array(width * height * 4);
  const halfL = 2.55;
  const halfW = 1.18;
  const sizeX = 6.4;
  const sizeY = 3.2;
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const x = ((i + 0.5) / width - 0.5) * sizeX;
      const y = ((j + 0.5) / height - 0.5) * sizeY;
      // Signed distance to a rounded rectangle the size of the body.
      const qx = Math.abs(x) - (halfL - 0.5);
      const qy = Math.abs(y) - (halfW - 0.5);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.5;
      let alpha = (1 - smoothstep(-0.35, 0.55, outside)) * 0.55;
      for (const [wx, wy] of [
        [1.425, 0.845],
        [1.425, -0.845],
        [-1.425, 0.845],
        [-1.425, -0.845],
      ] as const) {
        const d = Math.hypot((x - wx) / 0.42, (y - wy) / 0.24);
        alpha = Math.max(alpha, (1 - smoothstep(0.35, 1.1, d)) * 0.85);
      }
      const index = (j * width + i) * 4;
      data[index] = 18;
      data[index + 1] = 22;
      data[index + 2] = 30;
      data[index + 3] = Math.round(clamp(alpha, 0, 1) * 255);
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function ContactShadow() {
  const texture = useMemo(() => contactShadowTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} renderOrder={1} name="CONTINUA_ContactShadow">
      <planeGeometry args={[6.4, 3.2]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-6}
        polygonOffsetUnits={-6}
        toneMapped={false}
        fog
      />
    </mesh>
  );
}


const WHEEL_TAGS = ['FL', 'FR', 'RL', 'RR'] as const;
const STEER_TAGS = ['FL', 'FR'] as const;

interface Rig {
  root: Group;
  body: Group;
  wheels: Object3D[];
  steer: Object3D[];
  missing: string[];
}

function buildRig(source: Object3D): Rig {
  const cloned = source.clone(true);
  const vehicle = (cloned.getObjectByName('CONTINUA_Vehicle') ?? cloned) as Object3D;
  const missing: string[] = [];

  const wheels = WHEEL_TAGS.map((tag) => {
    const node = vehicle.getObjectByName(`CONTINUA_Wheel_${tag}`);
    if (!node) missing.push(`CONTINUA_Wheel_${tag}`);
    return node;
  }).filter((node): node is Object3D => Boolean(node));

  const steer = STEER_TAGS.map((tag) => {
    const node = vehicle.getObjectByName(`CONTINUA_Steer_${tag}`);
    if (!node) missing.push(`CONTINUA_Steer_${tag}`);
    return node;
  }).filter((node): node is Object3D => Boolean(node));

  // Everything that is not a wheel or a steering pivot rides on the suspension.
  const body = new Group();
  body.name = 'CONTINUA_BodyGroup';
  const statics = vehicle.children.filter(
    (child) => !/^CONTINUA_(Wheel|Steer)_/.test(child.name),
  );
  for (const child of statics) body.add(child);
  vehicle.add(body);

  cloned.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.castShadow = true;
    node.receiveShadow = true;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      // Tinted glass must not occlude the interior behind it.
      if (material.name.includes('Glass')) {
        material.depthWrite = false;
        node.renderOrder = 3;
      }
      material.envMapIntensity = 0.85;
    }
  });

  const root = new Group();
  root.name = 'CONTINUA_RoverRoot';
  root.add(vehicle);
  return { root, body, wheels, steer, missing };
}

export function Rover({
  lod = false,
  onRigReport,
}: {
  lod?: boolean;
  onRigReport?: (report: { missing: string[] }) => void;
}) {
  const { source, frame } = useSceneRuntime();
  const url = lod ? ROVER_MODEL_LOD1_URL : ROVER_MODEL_URL;
  const { scene } = useGLTF(url);

  const rig = useMemo(() => buildRig(scene), [scene]);
  const groupRef = useRef<Group>(null);

  useEffect(() => {
    onRigReport?.({ missing: rig.missing });
    if (rig.missing.length > 0) {
      console.warn('[CONTINUA] rover rig is missing nodes:', rig.missing.join(', '));
    }
  }, [rig, onRigReport]);

  useFrame(() => {
    // `SceneDriver` has already advanced the clock and published this frame.
    const state = frame.current;
    const group = groupRef.current;
    if (!group) return;
    const pose = state.vehicle;

    // --- restrained suspension, still a pure function of time -------------
    const ahead = source.sampleAt(Math.min(state.simTime + 0.35, source.duration));
    const behind = source.sampleAt(Math.max(state.simTime - 0.35, 0));
    const acceleration = (ahead.vehicle.speedMps - behind.vehicle.speedMps) / 0.7;
    const lateral = pose.speedMps * pose.speedMps * Math.tan(pose.steerAngle) / VEHICLE.wheelbase;

    const pitchTrim = clamp(-acceleration * 0.010, -0.030, 0.030);
    const rollTrim = clamp(-lateral * 0.0022, -0.045, 0.045);
    const bob =
      0.011 * Math.sin(pose.distance * 0.53) + 0.006 * Math.sin(pose.distance * 1.37 + 1.1);

    group.position.set(
      pose.position.x,
      pose.position.y + ROAD_SURFACE_OFFSET,
      pose.position.z,
    );
    group.rotation.set(pose.pitch, pose.heading, pose.roll, 'YXZ');

    rig.body.position.y = bob;
    rig.body.rotation.set(pitchTrim, 0, rollTrim, 'YXZ');

    for (const wheel of rig.wheels) wheel.rotation.z = -pose.wheelAngle;
    for (const pivot of rig.steer) pivot.rotation.y = pose.steerAngle;
  });

  return (
    <group ref={groupRef} name="CONTINUA_Rover">
      <ContactShadow />
      <primitive object={rig.root} />
    </group>
  );
}

useGLTF.preload(ROVER_MODEL_URL);
