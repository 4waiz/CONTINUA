'use client';

/**
 * The rover rig.
 *
 * Loads the exported glTF, re-parents the static parts under one body group so
 * suspension can move them without touching the wheels, and drives everything
 * from `sampleAt(clock.time)`.
 *
 * Two of them can share the road: CONTINUA, and the normal rover beside it -
 * the same vehicle in a plainer livery (grey, no blue, no name), driven from
 * the normal rover's own run. A rover whose link is down flashes its hazard
 * lamps until it is moving again.
 *
 * Orientation contract (docs/ASSET_MANIFEST.md): forward +X, up +Y,
 * wheel spin about local Z, steering about local Y.
 */

import type { SceneState, SceneStateSource } from '@continua/contracts';
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
import { SATELLITE_SKY } from '../world/sites';
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
  /** Moving sensors (optional: an older export has none). */
  lidar: Object3D | null;
  satMount: Object3D | null;
  satPanel: Object3D | null;
  /** The tail and stop lamps: this rover's own copy of their material. */
  brake: { material: MeshStandardMaterial; base: number } | null;
  /** The amber lamps, front and rear: this rover's own copy, for its hazard lights. */
  hazard: { material: MeshStandardMaterial; base: number } | null;
  /** Materials this rig cloned for itself, to dispose with it. */
  owned: MeshStandardMaterial[];
  missing: string[];
}

/** Which rover a rig is: CONTINUA, or the normal rover in its plainer livery. */
export type RoverVariant = 'continua' | 'normal';

/**
 * The normal rover's livery: the same vehicle, grey instead of white and no
 * CONTINUA blue - so the two read apart at a glance, and only the one in
 * CONTINUA's colours is CONTINUA. The door and tailgate wordmarks are lettered
 * in the blue accent (scripts/blender/build_vehicle.py, build_identity), so
 * painting the accent the body's colour takes the name off it; the grille's
 * wordmark, in the bright rim finish, is painted out on the body alone.
 */
const NORMAL_PAINT = '#7f8895';
const NORMAL_LIVERY: Record<string, string> = {
  CONTINUA_Paint_White: NORMAL_PAINT,
  CONTINUA_Accent_Blue: NORMAL_PAINT,
  CONTINUA_Plate: '#c3c8cf',
  CONTINUA_Accent_Cyan: '#9aa2ad',
  CONTINUA_Spring_Blue: '#6f7782',
  CONTINUA_Caliper: '#3d444f',
};

/** Whether a node is part of the body shell (not a wheel), by its ancestors' names. */
function onBody(node: Object3D): boolean {
  for (let at: Object3D | null = node; at; at = at.parent) {
    if (at.name === 'CONTINUA_Body') return true;
    if (/^CONTINUA_(Wheel|Steer)_/.test(at.name)) return false;
  }
  return false;
}

/** How much brighter the tail lamps burn under full braking. */
const BRAKE_GAIN = 2.2;
/** Hazard lamps: flashes a second, and how much brighter than their resting glow. */
const HAZARD_HZ = 1.5;
const HAZARD_GAIN = 7;

/** The LiDAR's spin, rad/s: two revolutions a second read as a scanner without strobing. */
const LIDAR_SPIN = Math.PI * 4;
/** How far the satellite panel tilts when deployed: square to a satellite 45 degrees up. */
const SAT_TILT = Math.PI / 2 - Math.asin(SATELLITE_SKY.y);

/**
 * How far the satellite terminal is deployed, 0..1: the share of the last
 * 1.5 s the satellite link spent warming or carrying, eased. It raises over a
 * second and a half as the link is brought up and stows the same way - and,
 * read from the source at fixed offsets, it is a pure function of time.
 */
function satelliteDeploy(source: SceneStateSource, t: number): number {
  const samples = 6;
  let on = 0;
  for (let k = 0; k < samples; k += 1) {
    const state = source.sampleAt(Math.max(0, t - k * 0.3));
    if (state.active === 'satellite' || state.warming.includes('satellite')) on += 1;
  }
  const x = on / samples;
  return x * x * (3 - 2 * x);
}

function buildRig(source: Object3D, variant: RoverVariant): Rig {
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

  // The lamps get a material of their own: the glTF's is shared through the
  // loader's cache, and brightening it would brighten every copy. So does the
  // normal rover's paint, for the same reason.
  // (Typed by assertion: assigned in the callback, it would otherwise be
  // narrowed to its initial null.)
  let brake = null as MeshStandardMaterial | null;
  let hazard = null as MeshStandardMaterial | null;
  const owned: MeshStandardMaterial[] = [];
  const livery = new Map<string, MeshStandardMaterial>();
  cloned.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (node.material instanceof MeshStandardMaterial && node.material.name === 'CONTINUA_Light_Rear') {
      if (!brake) owned.push((brake = node.material.clone()));
      node.material = brake;
    }
    if (node.material instanceof MeshStandardMaterial && node.material.name === 'CONTINUA_Light_Amber') {
      if (!hazard) owned.push((hazard = node.material.clone()));
      node.material = hazard;
    }
    const repaint =
      variant === 'normal' && node.material instanceof MeshStandardMaterial
        ? (NORMAL_LIVERY[node.material.name] ??
          (node.material.name === 'CONTINUA_Rim_Bright' && onBody(node) ? NORMAL_PAINT : undefined))
        : undefined;
    if (repaint && node.material instanceof MeshStandardMaterial) {
      const name = `${node.material.name}:${repaint}`;
      let paint = livery.get(name);
      if (!paint) {
        paint = node.material.clone();
        paint.color.set(repaint);
        // The accents glow faintly in CONTINUA's blue; the normal rover's do not.
        paint.emissive.setRGB(0, 0, 0);
        livery.set(name, paint);
        owned.push(paint);
      }
      node.material = paint;
    }
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
  root.name = variant === 'normal' ? 'CONTINUA_RoverRoot_Normal' : 'CONTINUA_RoverRoot';
  root.add(vehicle);
  return {
    root,
    body,
    wheels,
    steer,
    lidar: root.getObjectByName('CONTINUA_LidarHead') ?? null,
    satMount: root.getObjectByName('CONTINUA_SatMount') ?? null,
    satPanel: root.getObjectByName('CONTINUA_SatPanel') ?? null,
    brake: brake ? { material: brake, base: brake.emissiveIntensity } : null,
    hazard: hazard ? { material: hazard, base: hazard.emissiveIntensity } : null,
    owned,
    missing,
  };
}

export function Rover({
  lod = false,
  onRigReport,
  variant = 'continua',
  source: sourceOverride,
  frame: frameOverride,
}: {
  lod?: boolean;
  onRigReport?: (report: { missing: string[] }) => void;
  /** CONTINUA (the default), or the normal rover in its own livery. */
  variant?: RoverVariant;
  /** The run this rover is drawn from, when it is not the scene's own (the normal rover's). */
  source?: SceneStateSource;
  /** Its state this frame, written by `SceneDriver`; null hides the rover. */
  frame?: { current: SceneState | null };
}) {
  const runtime = useSceneRuntime();
  const source = sourceOverride ?? runtime.source;
  const frame = frameOverride ?? runtime.frame;
  const url = lod ? ROVER_MODEL_LOD1_URL : ROVER_MODEL_URL;
  const { scene } = useGLTF(url);

  const rig = useMemo(() => buildRig(scene, variant), [scene, variant]);
  // The lamps' and the livery's materials are this rig's own (the rest belong
  // to the glTF cache).
  useEffect(() => () => rig.owned.forEach((material) => material.dispose()), [rig]);
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
    if (!state) {
      group.visible = false;
      return;
    }
    group.visible = true;
    const pose = state.vehicle;

    // --- restrained suspension, still a pure function of time -------------
    const ahead = source.sampleAt(Math.min(state.simTime + 0.35, source.duration));
    const behind = source.sampleAt(Math.max(state.simTime - 0.35, 0));
    const acceleration = (ahead.vehicle.speedMps - behind.vehicle.speedMps) / 0.7;
    const lateral = pose.speedMps * pose.speedMps * Math.tan(pose.steerAngle) / VEHICLE.wheelbase;

    // The body squats (nose up) as it accelerates and dives as it brakes, and
    // leans to the outside of a turn; `lateral` is positive turning left.
    const pitchTrim = clamp(acceleration * 0.010, -0.030, 0.030);
    const rollTrim = clamp(lateral * 0.0022, -0.045, 0.045);
    const bob =
      0.011 * Math.sin(pose.distance * 0.53) + 0.006 * Math.sin(pose.distance * 1.37 + 1.1);

    group.position.set(
      pose.position.x,
      pose.position.y + ROAD_SURFACE_OFFSET,
      pose.position.z,
    );
    // Forward is +X, so pitch turns about the lateral Z axis and roll about X.
    // (These were swapped: a climbing rover leaned sideways instead of nosing up.)
    group.rotation.set(pose.roll, pose.heading, pose.pitch, 'YXZ');

    rig.body.position.y = bob;
    rig.body.rotation.set(rollTrim, 0, pitchTrim, 'YXZ');

    // The tail lamps brighten as it brakes - read from the same speed profile
    // as the body's dive - and stay lit while it stands with no link; the
    // hazards flash from the moment its session drops until it is moving
    // again. All on the scene clock, so a frame is still a pure function of time.
    const held = state.held ?? 0;
    const hazards = state.sessionDown === true || held > 0.05;
    if (rig.brake) {
      rig.brake.material.emissiveIntensity =
        rig.brake.base * (1 + BRAKE_GAIN * Math.max(smoothstep(0.35, 1.5, -acceleration), held));
    }
    if (rig.hazard) {
      const on = hazards && (state.simTime * HAZARD_HZ) % 1 < 0.55;
      rig.hazard.material.emissiveIntensity = rig.hazard.base * (on ? HAZARD_GAIN : 1);
    }

    for (const wheel of rig.wheels) wheel.rotation.z = -pose.wheelAngle;
    for (const pivot of rig.steer) pivot.rotation.y = pose.steerAngle;

    // The LiDAR head spins, always.
    if (rig.lidar) rig.lidar.rotation.y = state.simTime * LIDAR_SPIN;

    // The satellite terminal turns its panel to the satellite and tilts it up
    // while that link is warming or carrying; otherwise it lies stowed. The
    // panel is hinged along its back edge, so it faces back over the hinge:
    // the turntable puts the hinge on the satellite's side.
    if (rig.satMount && rig.satPanel) {
      const deploy = satelliteDeploy(source, state.simTime);
      const heading = pose.heading;
      // The satellite's horizontal bearing in the rover's own frame.
      const localX = SATELLITE_SKY.x * Math.cos(heading) - SATELLITE_SKY.z * Math.sin(heading);
      const localZ = SATELLITE_SKY.x * Math.sin(heading) + SATELLITE_SKY.z * Math.cos(heading);
      const bearing = Math.atan2(-localZ, localX);
      rig.satMount.rotation.y = (bearing + Math.PI) * deploy;
      rig.satPanel.rotation.z = SAT_TILT * deploy;
    }
  });

  return (
    <group ref={groupRef} name={variant === 'normal' ? 'CONTINUA_Rover_Normal' : 'CONTINUA_Rover'}>
      <ContactShadow />
      <primitive object={rig.root} />
    </group>
  );
}

useGLTF.preload(ROVER_MODEL_URL);
