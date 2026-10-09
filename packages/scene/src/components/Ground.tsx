'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-F0E6ED4B80D7 */

/**
 * Ground: terrain, the route's carriageway, service roads, building
 * hardstanding, the dock yard where every run starts (world/dock.ts) and the
 * kerbs where paving meets grass (world/kerbs.ts). The horizon ranges and the
 * roadside scatter are in `Landscape.tsx`.
 *
 * All of it is generated once from `terrain.height`, which is also what the
 * rover and the cameras read - so the road cannot float, the wheels cannot sink
 * and the camera cannot dip through a hill. Surfaces are shaded procedurally
 * (`shaders.ts`): pale desert sand with wind ripples, a graded campus, asphalt
 * with painted markings, saw-cut concrete. No texture is downloaded.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  MeshStandardMaterial,
  Path,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { SCENE_COLOR } from '../theme';
import { buildRouteRibbon, ROAD_SURFACE_OFFSET, SHOULDER_HALF_WIDTH } from '../world/road';
import { CAMPUS, PADS, SERVICE_ROADS, type ServiceRoad } from '../world/layout';
import { SEA_LEVEL, TERRAIN, terrain } from '../world/terrain';
import { route } from '../world/route';
import { EDGE_LINES_END, FORECOURT, RING, ROAD_LINE, TURNING_CIRCLE } from '../world/terminus';
import {
  DOCK_BAY,
  DOCK_YARD,
  KEEP_CLEAR,
  LEAD_LINES,
  PARKING,
  ROAD_START,
  dockBayOutline,
  DOCK_BAY_TWO,
  dockYardOutline,
} from '../world/dock';
import { buildKerbRuns, KERB, type KerbRun } from '../world/kerbs';
import {
  concreteMaterial,
  dockYardMaterial,
  kerbMaterial,
  patchStandard,
  roadMaterial,
  terrainMaterial,
  turningCircleMaterial,
} from './shaders';

function buildTerrainGeometry(segmentsX: number, segmentsZ: number): BufferGeometry {
  const { minX, maxX, minZ, maxZ } = TERRAIN;
  const countX = segmentsX + 1;
  const countZ = segmentsZ + 1;
  const positions = new Float32Array(countX * countZ * 3);
  const indices: number[] = [];

  for (let iz = 0; iz < countZ; iz += 1) {
    const z = minZ + ((maxZ - minZ) * iz) / segmentsZ;
    for (let ix = 0; ix < countX; ix += 1) {
      const x = minX + ((maxX - minX) * ix) / segmentsX;
      const index = (iz * countX + ix) * 3;
      positions[index] = x;
      positions[index + 1] = terrain.height(x, z);
      positions[index + 2] = z;
    }
  }
  for (let iz = 0; iz < segmentsZ; iz += 1) {
    for (let ix = 0; ix < segmentsX; ix += 1) {
      const a = iz * countX + ix;
      const b = a + 1;
      const c = a + countX;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** A ribbon along an arbitrary polyline, sitting on the terrain, with UVs
 *  laid out like the route ribbon (u across, v = metres / 12). */
function buildPathRibbon(road: ServiceRoad, yOffset: number): BufferGeometry {
  const pts = road.points;
  const samples: { x: number; z: number; tx: number; tz: number; s: number }[] = [];
  let travelled = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, z0] = pts[i]!;
    const [x1, z1] = pts[i + 1]!;
    const length = Math.hypot(x1 - x0, z1 - z0);
    const tx = (x1 - x0) / length;
    const tz = (z1 - z0) / length;
    const steps = Math.max(2, Math.ceil(length / 2));
    for (let s = 0; s <= steps; s += 1) {
      if (i > 0 && s === 0) continue;
      const t = s / steps;
      samples.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, tx, tz, s: travelled + length * t });
    }
    travelled += length;
  }
  const positions = new Float32Array(samples.length * 6);
  const uvs = new Float32Array(samples.length * 4);
  const indices: number[] = [];
  samples.forEach((sample, i) => {
    const nx = -sample.tz;
    const nz = sample.tx;
    const lx = sample.x + nx * road.halfWidth;
    const lz = sample.z + nz * road.halfWidth;
    const rx = sample.x - nx * road.halfWidth;
    const rz = sample.z - nz * road.halfWidth;
    positions.set([lx, terrain.height(lx, lz) + yOffset, lz, rx, terrain.height(rx, rz) + yOffset, rz], i * 6);
    uvs.set([0, sample.s / 12, 1, sample.s / 12], i * 4);
    if (i < samples.length - 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Flat hardstanding over a pad's level area, slightly above the ground. */
function buildPadGeometry(pads: typeof PADS): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const pad of pads) {
    const y = terrain.height(pad.x, pad.z) + 0.035;
    const base = positions.length / 3;
    positions.push(
      pad.x - pad.hx, y, pad.z - pad.hz,
      pad.x + pad.hx, y, pad.z - pad.hz,
      pad.x + pad.hx, y, pad.z + pad.hz,
      pad.x - pad.hx, y, pad.z + pad.hz,
    );
    // u = 0.5 everywhere: the asphalt shader paints no edge lines on a car park.
    uvs.push(0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0);
    indices.push(base, base + 3, base + 1, base + 1, base + 3, base + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A flat shape laid on the terrain: a capsule - every point within `radius`
 * of the segment a-b, a disc when a = b - meshed as rings from its middle to
 * its edge so it follows the ground.
 */
function buildDrapedCapsule(
  a: { x: number; z: number },
  b: { x: number; z: number },
  radius: number,
  yOffset: number,
): BufferGeometry {
  const heading = Math.atan2(b.z - a.z, b.x - a.x);
  const outline: [number, number][] = [];
  const arc = 28;
  for (const [centre, from] of [[b, heading - Math.PI / 2], [a, heading + Math.PI / 2]] as const) {
    for (let i = 0; i <= arc; i += 1) {
      const angle = from + (Math.PI * i) / arc;
      outline.push([centre.x + radius * Math.cos(angle), centre.z + radius * Math.sin(angle)]);
    }
  }
  const middle = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const rings = 14;
  const positions: number[] = [];
  const uvs: number[] = [];
  const vertex = (x: number, z: number) => {
    positions.push(x, terrain.height(x, z) + yOffset, z);
    uvs.push(0.5, 0.5);
  };
  vertex(middle.x, middle.z);
  for (let k = 1; k <= rings; k += 1) {
    const f = k / rings;
    for (const [x, z] of outline) vertex(middle.x + (x - middle.x) * f, middle.z + (z - middle.z) * f);
  }
  const count = outline.length;
  const at = (k: number, j: number) => 1 + (k - 1) * count + (j % count);
  const indices: number[] = [];
  for (let j = 0; j < count; j += 1) {
    indices.push(0, at(1, j + 1), at(1, j));
    for (let k = 1; k < rings; k += 1) {
      indices.push(at(k, j), at(k, j + 1), at(k + 1, j), at(k + 1, j), at(k, j + 1), at(k + 1, j + 1));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // The faces must look up; turn them over if the outline ran the other way.
  if ((geometry.getAttribute('normal').getY(0) ?? 1) < 0) {
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The dock yard (world/dock.ts): one flat surface at the road deck's height,
 * the bay's floor - a slab in the dock prop - left out of it, so the two
 * never lie at one height over the same ground.
 */
function buildYardGeometry(): BufferGeometry {
  // Shape space is (x, -z): turned down onto the ground, its faces look up.
  const shape = new Shape(dockYardOutline().map(([x, z]) => new Vector2(x, -z)));
  shape.holes.push(new Path(dockBayOutline(0.01).map(([x, z]) => new Vector2(x, -z))));
  shape.holes.push(new Path(dockBayOutline(0.01, DOCK_BAY_TWO).map(([x, z]) => new Vector2(x, -z))));
  const geometry = new ShapeGeometry(shape, 1);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    position.setY(i, terrain.height(position.getX(i), position.getZ(i)) + ROAD_SURFACE_OFFSET);
  }
  geometry.deleteAttribute('uv');
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Kerbs along every run (world/kerbs.ts): a profile swept along the paving's
 * edge on the grass side - an upstand with a chamfered top, its outer face
 * down into the turf - with a square end where a run stops. `uv.x` is metres
 * along the run, for the precast units' joints.
 */
function buildKerbGeometry(runs: readonly KerbRun[]): BufferGeometry {
  const { width, height } = KERB;
  const chamfer = 0.025;
  const s = Math.SQRT1_2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, 0);
  };
  for (const run of runs) {
    const points = run.closed ? [...run.points, run.points[0]!] : [...run.points];
    const base = positions.length / 3;
    const profiles: [number, number, number][][] = [];
    let along = 0;
    points.forEach((p, i) => {
      if (i > 0) along += Math.hypot(p.x - points[i - 1]!.x, p.z - points[i - 1]!.z);
      const ground = terrain.height(p.x, p.z) + run.level;
      const top = ground + height;
      const cx = p.x + p.nx * chamfer * p.mitre;
      const cz = p.z + p.nz * chamfer * p.mitre;
      const ox = p.x + p.nx * width * p.mitre;
      const oz = p.z + p.nz * width * p.mitre;
      const low = terrain.height(ox, oz) - 0.05;
      // Inner face, chamfer, top, outer face: each its own pair, flat across.
      push(p.x, ground - 0.01, p.z, -p.nx, 0, -p.nz, along);
      push(p.x, top - chamfer, p.z, -p.nx, 0, -p.nz, along);
      push(p.x, top - chamfer, p.z, -p.nx * s, s, -p.nz * s, along);
      push(cx, top, cz, -p.nx * s, s, -p.nz * s, along);
      push(cx, top, cz, 0, 1, 0, along);
      push(ox, top, oz, 0, 1, 0, along);
      push(ox, top, oz, p.nx, 0, p.nz, along);
      push(ox, low, oz, p.nx, 0, p.nz, along);
      profiles.push([
        [p.x, ground - 0.01, p.z],
        [p.x, top - chamfer, p.z],
        [cx, top, cz],
        [ox, top, oz],
        [ox, low, oz],
      ]);
    });
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = base + i * 8;
      const b = a + 8;
      for (let f = 0; f < 4; f += 1) {
        const a0 = a + f * 2;
        const b0 = b + f * 2;
        indices.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      }
    }
    if (run.closed) continue;
    // Square ends, facing back along the run at its start and on at its end.
    if (points.length < 2) continue;
    for (const [index, neighbour, last] of [[0, 1, false], [points.length - 1, points.length - 2, true]] as const) {
      const here = points[index]!;
      const from = points[neighbour]!;
      const length = Math.hypot(here.x - from.x, here.z - from.z) || 1;
      const nx = (here.x - from.x) / length;
      const nz = (here.z - from.z) / length;
      const cap = positions.length / 3;
      for (const [x, y, z] of profiles[index]!) push(x, y, z, nx, 0, nz, index === 0 ? 0 : along);
      const order = last ? [0, 2, 1, 0, 3, 2, 0, 4, 3] : [0, 1, 2, 0, 2, 3, 0, 3, 4];
      for (const k of order) indices.push(cap + k);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function gravelMaterial(colour: string): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.97, metalness: 0 });
  return patchStandard(material, {
    key: 'continua-gravel-v1',
    uniforms: { uGravel: { value: new Color(colour) } },
    colour: /* glsl */ `
      vec2 p = vCtWorld.xz;
      float fade = 1.0 - smoothstep(40.0, 160.0, vCtDist);
      vec3 g = uGravel * (0.94 + 0.08 * ctFbm(p * 0.3));
      g *= 0.92 + 0.14 * ctNoise(p * 6.0) * fade;
      diffuseColor.rgb *= g;
    `,
  });
}

export function Ground({ quality }: { quality: 'high' | 'balanced' | 'low' }) {
  const detail = quality === 'high' ? 1 : quality === 'balanced' ? 0.7 : 0.45;

  const terrainGeometry = useMemo(
    () => buildTerrainGeometry(Math.round(TERRAIN.segmentsX * detail), Math.round(TERRAIN.segmentsZ * detail)),
    [detail],
  );

  // The carriageway starts at the dock yard's mouth (world/dock.ts) and runs
  // into the turning circle, stopping where its edge lines meet the circle's:
  // the circle carries on from there. Its gravel verges start where the
  // yard's kerb has curved in to meet it.
  const road = useMemo(() => buildRouteRibbon({ from: ROAD_START, to: EDGE_LINES_END }), []);
  const shoulder = useMemo(
    () =>
      buildRouteRibbon({
        halfWidth: SHOULDER_HALF_WIDTH,
        yOffset: ROAD_SURFACE_OFFSET - 0.03,
        from: ROAD_START + DOCK_YARD.flare,
      }),
    [],
  );
  const yard = useMemo(() => buildYardGeometry(), []);
  const kerbs = useMemo(() => buildKerbGeometry(buildKerbRuns()), []);
  // Where the road ends (world/terminus.ts): it opens into a turning circle,
  // set in a concrete forecourt that reaches back to the ground station. The
  // circle is at the road deck's height, where the rover's tyres rest - a
  // centimetre lower, they stood clear of it.
  const forecourt = useMemo(() => buildDrapedCapsule(FORECOURT.a, FORECOURT.b, FORECOURT.radius, 0.035), []);
  const turningCircle = useMemo(
    () => buildDrapedCapsule(TURNING_CIRCLE, TURNING_CIRCLE, TURNING_CIRCLE.radius, ROAD_SURFACE_OFFSET),
    [],
  );
  const serviceRoads = useMemo(() => SERVICE_ROADS.map((entry) => buildPathRibbon(entry, 0.045)), []);
  const concretePads = useMemo(() => buildPadGeometry(PADS.filter((pad) => pad.surface === 'concrete')), []);
  const asphaltPads = useMemo(() => buildPadGeometry(PADS.filter((pad) => pad.surface === 'asphalt')), []);

  const materials = useMemo(() => {
    const set = {
      road: roadMaterial(
        { road: SCENE_COLOR.road, line: SCENE_COLOR.roadLine, centre: SCENE_COLOR.roadLine },
        { centreLine: true, key: 'continua-road-main-v3', linesEnd: EDGE_LINES_END, linesStart: ROAD_START },
      ),
      turning: turningCircleMaterial(
        { road: SCENE_COLOR.road, line: SCENE_COLOR.roadLine },
        {
          x: TURNING_CIRCLE.x,
          z: TURNING_CIRCLE.z,
          ring: RING,
          back: TURNING_CIRCLE.back,
          lineOffset: ROAD_LINE.offset,
          lineHalf: ROAD_LINE.half,
        },
      ),
      serviceRoad: roadMaterial(
        { road: SCENE_COLOR.road, line: SCENE_COLOR.roadLine, centre: SCENE_COLOR.roadLine },
        { centreLine: false, key: 'continua-road-service-v2' },
      ),
      shoulder: gravelMaterial(SCENE_COLOR.roadEdge),
      concrete: concreteMaterial(SCENE_COLOR.concrete),
      apron: concreteMaterial(SCENE_COLOR.apron, 'continua-apron-v2'),
      yard: dockYardMaterial(
        { concrete: SCENE_COLOR.concrete, line: SCENE_COLOR.roadLine, hatch: SCENE_COLOR.hatch },
        { centreZ: DOCK_BAY.z, lead: LEAD_LINES, keepClear: KEEP_CLEAR, parking: PARKING },
      ),
      kerb: kerbMaterial(SCENE_COLOR.kerb),
    };
    // Layering on near-coplanar ribbons: shoulder under service roads and
    // pads, the carriageway on top of everything.
    const offset = (material: MeshStandardMaterial, amount: number) => {
      material.polygonOffset = true;
      material.polygonOffsetFactor = amount;
      material.polygonOffsetUnits = amount;
    };
    offset(set.shoulder, -1);
    offset(set.concrete, -2);
    offset(set.apron, -2);
    // The yard lies 2.5 cm above the pads it overlaps, and must win at range.
    offset(set.yard, -3);
    offset(set.serviceRoad, -3);
    offset(set.turning, -3);
    offset(set.road, -4);
    return set;
  }, []);
  useEffect(() => () => Object.values(materials).forEach((material) => material.dispose()), [materials]);

  // The ground's own shader has a lighter variant for the low tier.
  const lite = quality === 'low';
  const { clock } = useSceneRuntime();
  const time = useMemo(() => ({ value: 0 }), []);
  useFrame(() => {
    time.value = clock.time;
  });
  const terrainShading = useMemo(
    () =>
      terrainMaterial({
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
      }, lite),
    [lite, time],
  );
  useEffect(() => () => terrainShading.dispose(), [terrainShading]);

  return (
    <group name="CONTINUA_Ground">
      <mesh geometry={terrainGeometry} material={terrainShading} receiveShadow />

      <mesh geometry={concretePads} material={materials.concrete} receiveShadow />
      <mesh geometry={asphaltPads} material={materials.serviceRoad} receiveShadow />
      <mesh geometry={yard} material={materials.yard} receiveShadow />
      <mesh geometry={kerbs} material={materials.kerb} receiveShadow />
      <mesh geometry={forecourt} material={materials.apron} receiveShadow />
      <mesh geometry={turningCircle} material={materials.turning} receiveShadow />
      <mesh geometry={shoulder} material={materials.shoulder} receiveShadow />
      {serviceRoads.map((geometry, index) => (
        <mesh key={index} geometry={geometry} material={materials.serviceRoad} receiveShadow />
      ))}
      <mesh geometry={road} material={materials.road} receiveShadow />
    </group>
  );
}

/** Exposed for tests: the route length actually used to build the ribbon. */
export const groundRouteLength = route.length;
