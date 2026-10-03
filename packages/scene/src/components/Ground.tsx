'use client';

/**
 * Ground: terrain, the route's carriageway, service roads and building
 * hardstanding. The horizon ranges and the roadside scatter are in
 * `Landscape.tsx`.
 *
 * All of it is generated once from `terrain.height`, which is also what the
 * rover and the cameras read - so the road cannot float, the wheels cannot sink
 * and the camera cannot dip through a hill. Surfaces are shaded procedurally
 * (`shaders.ts`): pale desert sand with wind ripples, a graded campus, asphalt
 * with painted markings, saw-cut concrete. No texture is downloaded.
 */

import { useEffect, useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  MeshStandardMaterial,
} from 'three';
import { SCENE_COLOR } from '../theme';
import { buildRouteRibbon, ROAD_HALF_WIDTH, ROAD_SURFACE_OFFSET } from '../world/road';
import { CAMPUS, PADS, SERVICE_ROADS, type ServiceRoad } from '../world/layout';
import { SEA_LEVEL, TERRAIN, terrain } from '../world/terrain';
import { route } from '../world/route';
import { concreteMaterial, patchStandard, roadMaterial, terrainMaterial } from './shaders';

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

  const road = useMemo(() => buildRouteRibbon(), []);
  const shoulder = useMemo(
    () => buildRouteRibbon({ halfWidth: ROAD_HALF_WIDTH + 1.6, yOffset: ROAD_SURFACE_OFFSET - 0.03 }),
    [],
  );
  // A turnaround pad at the ground station, so the carriageway ends at a
  // destination instead of stopping dead in open ground.
  const terminus = useMemo(
    () =>
      buildRouteRibbon({
        halfWidth: 13,
        yOffset: ROAD_SURFACE_OFFSET - 0.02,
        from: Math.max(0, route.length - 46),
        to: route.length,
      }),
    [],
  );
  const serviceRoads = useMemo(() => SERVICE_ROADS.map((entry) => buildPathRibbon(entry, 0.045)), []);
  const concretePads = useMemo(() => buildPadGeometry(PADS.filter((pad) => pad.surface === 'concrete')), []);
  const asphaltPads = useMemo(() => buildPadGeometry(PADS.filter((pad) => pad.surface === 'asphalt')), []);

  const materials = useMemo(() => {
    const set = {
      road: roadMaterial(
        { road: SCENE_COLOR.road, line: SCENE_COLOR.roadLine, centre: SCENE_COLOR.roadLine },
        { centreLine: true, key: 'continua-road-main-v1' },
      ),
      serviceRoad: roadMaterial(
        { road: SCENE_COLOR.road, line: SCENE_COLOR.roadLine, centre: SCENE_COLOR.roadLine },
        { centreLine: false, key: 'continua-road-service-v1' },
      ),
      shoulder: gravelMaterial(SCENE_COLOR.roadEdge),
      concrete: concreteMaterial(SCENE_COLOR.concrete),
      apron: concreteMaterial(SCENE_COLOR.apron, 'continua-apron-v1'),
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
    offset(set.serviceRoad, -3);
    offset(set.road, -4);
    return set;
  }, []);
  useEffect(() => () => Object.values(materials).forEach((material) => material.dispose()), [materials]);

  // The ground's own shader has a lighter variant for the low tier.
  const lite = quality === 'low';
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
      }, lite),
    [lite],
  );
  useEffect(() => () => terrainShading.dispose(), [terrainShading]);

  return (
    <group name="CONTINUA_Ground">
      <mesh geometry={terrainGeometry} material={terrainShading} receiveShadow />

      <mesh geometry={concretePads} material={materials.concrete} receiveShadow />
      <mesh geometry={asphaltPads} material={materials.serviceRoad} receiveShadow />
      <mesh geometry={terminus} material={materials.apron} receiveShadow />
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
