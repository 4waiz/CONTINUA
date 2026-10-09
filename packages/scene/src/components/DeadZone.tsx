'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-6E455432DFA8 */

/**
 * The cutting that a scenario's radio shadow stands for (`world/deadZones.ts`).
 *
 * The road runs between two grassed embankments, held back by precast
 * retaining panels - an inverted T: a stem tapering from 0.42 m to 0.26 m on a
 * chamfered footing - whose wings step down at each end of a run. Open to the
 * sky: the banks hide the masts and towers beside the route, while the
 * satellite, 45 degrees up, still sees the rover.
 *
 * One instanced mesh for every panel; the banks are a strip mesh along the
 * route drawn with the ground's own shader, so they are the same meadow and
 * lawn as the land they rise from, and rock where they are steep. The panels'
 * surface is procedural like everything else here: cast concrete with a little
 * tone from panel to panel, pores, pour lines, rain streaks from the top, road
 * dirt at the foot, lifting holes, a worn hazard band along the road face and
 * chevrons on the ends of each run. A pure function of position, so a
 * captured frame is unchanged.
 */

import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
  type InstancedMesh,
} from 'three';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { SCENE_COLOR } from '../theme';
import { CAMPUS } from '../world/layout';
import { route } from '../world/route';
import { SEA_LEVEL, terrain } from '../world/terrain';
import { WALL, wallPanels, wallRuns, wallTaper, type DeadZone, type WallRun } from '../world/deadZones';
import { patchStandard, terrainMaterial } from './shaders';

type Profile = readonly (readonly [number, number])[];

/** The stem, in (outward z, up y), metres. */
const STEM: Profile = [
  [0, 0.3],
  [0.42, 0.3],
  [0.26, WALL.height],
  [0, WALL.height],
];
/** The footing: road side 0.55 m, field side 1.15 m, chamfered on top. */
const FOOTING: Profile = [
  [-0.55, 0],
  [1.15, 0],
  [1.15, 0.16],
  [0.6, 0.3],
  [-0.2, 0.3],
  [-0.55, 0.16],
];

/**
 * A convex profile extruded across the panel's width, flat-shaded. Triangles
 * are wound to face the way their normal points, whatever order the profile
 * was written in.
 */
function extrude(profile: Profile, half: number, positions: number[], normals: number[]): void {
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  const tri = (pa: Vector3, pb: Vector3, pc: Vector3, normal: Vector3) => {
    e1.subVectors(pb, pa);
    e2.subVectors(pc, pa);
    const facing = e1.cross(e2).dot(normal) >= 0;
    const order = facing ? [pa, pb, pc] : [pa, pc, pb];
    for (const p of order) {
      positions.push(p.x, p.y, p.z);
      normals.push(normal.x, normal.y, normal.z);
    }
  };
  let cz = 0;
  let cy = 0;
  for (const [z, y] of profile) {
    cz += z / profile.length;
    cy += y / profile.length;
  }
  const d = new Vector3();
  for (let i = 0; i < profile.length; i += 1) {
    const [z0, y0] = profile[i]!;
    const [z1, y1] = profile[(i + 1) % profile.length]!;
    // Outward normal of this edge in the profile plane (y, z): perpendicular
    // to (dz, dy), turned away from the centroid.
    n.set(0, -(z1 - z0), y1 - y0).normalize();
    d.set(0, (y0 + y1) / 2 - cy, (z0 + z1) / 2 - cz);
    if (n.dot(d) < 0) n.negate();
    a.set(-half, y0, z0);
    b.set(half, y0, z0);
    c.set(half, y1, z1);
    tri(a, b, c, n);
    const a2 = new Vector3(-half, y0, z0);
    const c2 = new Vector3(half, y1, z1);
    const d2 = new Vector3(-half, y1, z1);
    tri(a2, c2, d2, n);
  }
  // End caps: a fan, each side.
  for (const sign of [-1, 1]) {
    const normal = new Vector3(sign, 0, 0);
    const origin = new Vector3(sign * half, profile[0]![1], profile[0]![0]);
    for (let i = 1; i < profile.length - 1; i += 1) {
      const p1 = new Vector3(sign * half, profile[i]![1], profile[i]![0]);
      const p2 = new Vector3(sign * half, profile[i + 1]![1], profile[i + 1]![0]);
      tri(origin, p1, p2, normal);
    }
  }
}

function buildPanelGeometry(): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const half = WALL.width / 2;
  extrude(STEM, half, positions, normals);
  extrude(FOOTING, half, positions, normals);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function wallMaterial(lite: boolean): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });
  return patchStandard(material, {
    key: 'continua-deadzone-wall-v1',
    lite,
    uniforms: {
      uConcrete: { value: new Color('#C7C9C3') },
      uDirt: { value: new Color('#8A8577') },
      uHazardA: { value: new Color('#F2B705') },
      uHazardB: { value: new Color('#2A2B2E') },
    },
    vertexHeader: /* glsl */ `
      attribute vec2 aPanel;
      varying vec3 vCtLocal;
      varying vec2 vCtPanel;
    `,
    vertex: /* glsl */ `
      vCtLocal = position;
      vCtPanel = aPanel;
    `,
    header: /* glsl */ `
      varying vec3 vCtLocal;
      varying vec2 vCtPanel;
      #define CT_WALL_H ${WALL.height.toFixed(3)}
      #define CT_WALL_HALF ${(WALL.width / 2).toFixed(4)}
      // Fine grain of cast concrete on whichever face this is.
      float ctWallGrain(vec3 p, float seed) {
        return ctNoise(vec2(p.x * 9.0 + seed * 31.0 + p.z * 9.0, p.y * 9.0 + p.z * 4.0));
      }
    `,
    colour: /* glsl */ `
      {
        vec3 p = vCtLocal;
        float seed = vCtPanel.x;
        vec3 base = uConcrete * (0.93 + 0.11 * seed);
        float roadFace = step(p.z, 0.004) * step(0.3, p.y);
        #ifndef CT_LITE
          float grain = ctWallGrain(p, seed);
          float pores = step(0.86, ctNoise(vec2(p.x * 41.0 + p.z * 41.0 + seed * 13.0, p.y * 41.0)));
          base *= 0.95 + 0.09 * grain - 0.07 * pores;
          // Pour lines: the formwork's lifts, faint, every 1.2 m.
          base *= 1.0 - 0.035 * (1.0 - smoothstep(0.0, 0.025, abs(fract(p.y / 1.2) - 0.5) - 0.47));
          // Rain streaks running down from the top.
          float streak = ctNoise(vec2(p.x * 6.5 + seed * 17.0 + p.z * 6.5, p.y * 0.32));
          float fromTop = smoothstep(CT_WALL_H - 3.0, CT_WALL_H, p.y);
          base *= 1.0 - 0.12 * smoothstep(0.58, 0.86, streak) * fromTop;
          // Lifting holes, two to a panel, through the stem.
          vec2 hole = vec2(abs(p.x) - 0.36, p.y - (CT_WALL_H - 0.34));
          float lift = 1.0 - smoothstep(0.05, 0.065, length(hole));
          base = mix(base, vec3(0.18), lift * step(p.y, CT_WALL_H - 0.01));
        #endif
        // Road dirt thrown up at the foot.
        float dirtLine = 0.9 + 0.5 * ctNoise(vec2(p.x * 2.7 + seed * 9.0, 3.1));
        float dirt = 1.0 - smoothstep(0.2, dirtLine, p.y);
        base = mix(base, uDirt, 0.5 * dirt);
        // Joints: the panel edges sit in shade.
        base *= 1.0 - 0.2 * smoothstep(CT_WALL_HALF - 0.03, CT_WALL_HALF, abs(p.x));
        // A worn hazard band along the road face, and chevrons on a run's ends.
        float band = roadFace * step(p.y, 0.62);
        float stripes = step(0.5, fract((p.x + p.y) * 2.5));
        vec3 hazard = mix(uHazardB, uHazardA, stripes);
        float endFace = step(0.5, vCtPanel.y) * step(CT_WALL_HALF - 0.002, abs(p.x)) * step(0.3, p.y);
        float chevrons = step(0.5, fract(p.y * 1.25 + abs(p.z - 0.2) * 1.25));
        hazard = mix(hazard, mix(uHazardB, uHazardA, chevrons), endFace);
        float wear = 1.0;
        #ifndef CT_LITE
          wear = smoothstep(0.18, 0.4, ctNoise(vec2(p.x * 14.0 + seed * 5.0, p.y * 14.0)));
        #endif
        base = mix(base, hazard, max(band, endFace) * mix(0.55, 1.0, wear));
        diffuseColor.rgb = base;
      }
    `,
    roughness: /* glsl */ `
      roughnessFactor = mix(0.9, 0.58, step(vCtLocal.z, 0.004) * step(0.3, vCtLocal.y) * step(vCtLocal.y, 0.62));
    `,
    normal: /* glsl */ `
      #ifndef CT_LITE
        {
          float ctNear = 1.0 - smoothstep(25.0, 60.0, vCtDist);
          float grain = ctWallGrain(vCtLocal, vCtPanel.x);
          normal = ctBump(-vViewPosition, normal, grain * ctNear, 0.012);
        }
      #endif
    `,
  });
}

// ---------------------------------------------------------------------------
// The banks behind the walls
// ---------------------------------------------------------------------------

/** Lateral offset at which the bank meets the back of the panels' tops. */
const BANK_FROM = WALL.lateral + 0.32;
/** The flat crest behind the wall, then a 28-degree face down to the land:
 *  gentle enough to stay grassed (the ground's shader turns steeper ground to rock). */
const CREST_M = 2.4;
const FACE_RUN = 1.0 / Math.tan((28 * Math.PI) / 180);
/** How far the bank's toe runs on under the ground. */
const TOE_SINK = 0.9;
/** The bank runs on past the wall's last panel and slumps to the ground. */
const BANK_OVERRUN = 9.0;

/** Height of the bank at `u` metres beyond the wall, for a wall `h` tall. */
function bankHeight(u: number, h: number): number {
  const foot = CREST_M + h * FACE_RUN;
  if (u <= CREST_M) return h;
  if (u >= foot) return -TOE_SINK;
  const x = (u - CREST_M) / (foot - CREST_M);
  // A rounded shoulder and toe, not a hard plane. The toe dips well under the
  // ground, so the two surfaces cross cleanly instead of flickering where the
  // ground mesh's 6 m facets wander above and below the bank's foot.
  return (h + TOE_SINK) * (0.5 + 0.5 * Math.cos(Math.PI * x)) - TOE_SINK;
}

/**
 * The banks along every run, both sides, as one mesh: rows across the bank
 * every metre along the route, each following the ground beneath it.
 */
function buildBanks(runs: readonly WallRun[]): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const across = 14;
  for (const run of runs) {
    for (const side of [1, -1] as const) {
      const from = run.from - BANK_OVERRUN;
      const to = run.to + BANK_OVERRUN;
      const steps = Math.max(2, Math.ceil(to - from));
      const base = positions.length / 3;
      for (let i = 0; i <= steps; i += 1) {
        const distance = from + ((to - from) * i) / steps;
        const sample = route.at(distance);
        const nx = -sample.tz * side;
        const nz = sample.tx * side;
        // Past the panels the bank slumps away to nothing.
        const beyond = Math.max(run.from - distance, distance - run.to, 0);
        const fall = Math.min(1, beyond / BANK_OVERRUN);
        const slump = 1 - fall * fall * (3 - 2 * fall);
        const taper = wallTaper(run, Math.min(Math.max(distance, run.from), run.to));
        const height = (WALL.height * taper - WALL.sink) * slump;
        const foot = CREST_M + Math.max(height, 0.5) * FACE_RUN;
        for (let j = 0; j <= across; j += 1) {
          // Rows crowd toward the crest, where the shape is.
          const u = foot * Math.pow(j / across, 1.25);
          const lateral = BANK_FROM + u;
          const x = sample.x + nx * lateral;
          const z = sample.z + nz * lateral;
          positions.push(x, terrain.height(x, z) + bankHeight(u, height), z);
        }
      }
      const stride = across + 1;
      for (let i = 0; i < steps; i += 1) {
        for (let j = 0; j < across; j += 1) {
          const a = base + i * stride + j;
          const b = a + stride;
          // Wound to face up on either side of the road.
          if (side > 0) indices.push(a, a + 1, b, b, a + 1, b + 1);
          else indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const _matrix = new Matrix4();
const _basisX = new Vector3();
const _basisY = new Vector3(0, 1, 0);
const _basisZ = new Vector3();
const _position = new Vector3();
const _scale = new Vector3();

export function DeadZoneWalls({ zones, lite = false }: { zones: readonly DeadZone[]; lite?: boolean }) {
  const geometry = useMemo(() => buildPanelGeometry(), []);
  const material = useMemo(() => wallMaterial(lite), [lite]);
  const panels = useMemo(() => wallPanels(zones), [zones]);
  const banks = useMemo(() => {
    const runs = wallRuns(zones);
    return runs.length ? buildBanks(runs) : null;
  }, [zones]);
  // The banks are the ground: the ground's own shader, with its cloud shadows.
  const { clock } = useSceneRuntime();
  const time = useMemo(() => ({ value: 0 }), []);
  useFrame(() => {
    time.value = clock.time;
  });
  const bankMaterial = useMemo(() => {
    const material = terrainMaterial(
      {
        campus: SCENE_COLOR.campus,
        grass: SCENE_COLOR.grass,
        grassLush: SCENE_COLOR.grassLush,
        grassDry: SCENE_COLOR.grassDry,
        heath: SCENE_COLOR.heath,
        beach: SCENE_COLOR.beach,
        rock: SCENE_COLOR.rockTint,
        flowers: [SCENE_COLOR.flowerA, SCENE_COLOR.flowerB, SCENE_COLOR.flowerC, SCENE_COLOR.flowerD],
        seaLevel: SEA_LEVEL,
        campusRect: [CAMPUS.minX, CAMPUS.maxX, CAMPUS.minZ, CAMPUS.maxZ],
        time,
      },
      lite,
    );
    // The banks arrive with a shadowed scenario, after the load-time warm-up,
    // and their back-face shadow program was the last one the story still
    // compiled mid-run (measured): a tenth of a second, the moment they first
    // came into the sun's shadow frustum. Cast from both faces - an open slope
    // either way - they share a program the scene already has.
    material.shadowSide = DoubleSide;
    return material;
  }, [lite, time]);
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    if (panels.length === 0) {
      // No cutting in this scenario: one panel of zero size, so the walls'
      // programs - colour, shadow depth, the AO pass's normals - are compiled
      // with the rest of the scene at load. Compiled the moment a shadowed
      // scenario first stood them, they stalled the frame for a quarter of a
      // second, and again for the shadow pass two seconds later.
      instanced.setMatrixAt(0, _matrix.makeScale(0, 0, 0));
      geometry.setAttribute('aPanel', new InstancedBufferAttribute(new Float32Array(2), 2));
      instanced.instanceMatrix.needsUpdate = true;
      return;
    }
    const seeds = new Float32Array(panels.length * 2);
    panels.forEach((panel, index) => {
      const sample = route.at(panel.distance);
      // The road's right-hand normal; the panel's local +Z faces away from the road.
      const nx = -sample.tz;
      const nz = sample.tx;
      _basisX.set(sample.tx * panel.side, 0, sample.tz * panel.side);
      _basisZ.set(nx * panel.side, 0, nz * panel.side);
      const x = sample.x + nx * panel.side * WALL.lateral;
      const z = sample.z + nz * panel.side * WALL.lateral;
      _position.set(x, terrain.height(x, z) - WALL.sink, z);
      _matrix.makeBasis(_basisX, _basisY, _basisZ).scale(_scale.set(1, panel.height, 1)).setPosition(_position);
      instanced.setMatrixAt(index, _matrix);
      // A fixed tone per panel, from where it stands.
      const hash = Math.sin(panel.distance * 12.9898 + panel.side * 78.233) * 43758.5453;
      seeds[index * 2] = hash - Math.floor(hash);
      seeds[index * 2 + 1] = panel.end ? 1 : 0;
    });
    geometry.setAttribute('aPanel', new InstancedBufferAttribute(seeds, 2));
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [panels, geometry]);

  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => () => material.dispose(), [material]);
  useLayoutEffect(() => () => banks?.dispose(), [banks]);
  useLayoutEffect(() => () => bankMaterial.dispose(), [bankMaterial]);

  return (
    <group name="CONTINUA_DeadZone">
      <instancedMesh
        key={panels.length}
        ref={mesh}
        name="CONTINUA_DeadZone_Walls"
        args={[geometry, material, Math.max(1, panels.length)]}
        castShadow
        receiveShadow
        // The zero-size stand-in is drawn every frame, so its programs exist.
        frustumCulled={panels.length > 0}
      />
      {banks && <mesh name="CONTINUA_DeadZone_Banks" geometry={banks} material={bankMaterial} castShadow receiveShadow />}
    </group>
  );
}
