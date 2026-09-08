'use client';

/**
 * Ground: terrain surface, survey wireframe, distant ridges and the road.
 *
 * All of it is generated once from `terrain.height`, which is also what the
 * rover and the cameras read — so the road cannot float, the wheels cannot sink
 * and the camera cannot dip through a hill.
 */

import { useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
} from 'three';
import { clamp, makeRandom, smoothstep } from '../math/noise';
import { SCENE_COLOR } from '../theme';
import { buildRouteRibbon, ROAD_HALF_WIDTH, ROAD_SURFACE_OFFSET } from '../world/road';
import { ridgeHeight, TERRAIN, terrain } from '../world/terrain';
import { route } from '../world/route';

/** Blend the ground palette by position: engineered near the site, sand far out. */
function groundColour(x: number, height: number, target: Color): Color {
  const near = new Color(SCENE_COLOR.groundNear);
  const far = new Color(SCENE_COLOR.groundFar);
  const high = new Color(SCENE_COLOR.groundHigh);
  target.copy(near).lerp(far, smoothstep(120, 480, x));
  target.lerp(high, clamp(height / 16, 0, 1) * 0.75);
  return target;
}

function buildTerrainGeometry(segmentsX: number, segmentsZ: number): BufferGeometry {
  const { minX, maxX, minZ, maxZ } = TERRAIN;
  const countX = segmentsX + 1;
  const countZ = segmentsZ + 1;
  const positions = new Float32Array(countX * countZ * 3);
  const colors = new Float32Array(countX * countZ * 3);
  const indices: number[] = [];
  const scratch = new Color();

  for (let iz = 0; iz < countZ; iz += 1) {
    const z = minZ + ((maxZ - minZ) * iz) / segmentsZ;
    for (let ix = 0; ix < countX; ix += 1) {
      const x = minX + ((maxX - minX) * ix) / segmentsX;
      const height = terrain.height(x, z);
      const index = (iz * countX + ix) * 3;
      positions[index] = x;
      positions[index + 1] = height;
      positions[index + 2] = z;
      groundColour(x, height, scratch);
      colors[index] = scratch.r;
      colors[index + 1] = scratch.g;
      colors[index + 2] = scratch.b;
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
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Coarse wireframe sitting exactly on the terrain — the "survey surface". */
function buildSurveyGrid(step = 16): BufferGeometry {
  const { minX, maxX, minZ, maxZ } = TERRAIN;
  const points: number[] = [];
  const lift = 0.12;
  const detail = 4; // sub-samples per cell so lines hug the surface

  for (let x = minX; x <= maxX; x += step) {
    for (let z = minZ; z < maxZ; z += step / detail) {
      points.push(x, terrain.height(x, z) + lift, z);
      points.push(x, terrain.height(x, z + step / detail) + lift, z + step / detail);
    }
  }
  for (let z = minZ; z <= maxZ; z += step) {
    for (let x = minX; x < maxX; x += step / detail) {
      points.push(x, terrain.height(x, z) + lift, z);
      points.push(x + step / detail, terrain.height(x + step / detail, z) + lift, z);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Low-poly silhouette ridges well beyond the playable area. */
function buildRidges(radius: number, seed: number, height: number): BufferGeometry {
  const random = makeRandom(seed);
  const segments = 96;
  const positions: number[] = [];
  const previous = { x: 0, z: 0, h: 0, set: false };

  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const wobble = 1 + (random() - 0.5) * 0.16;
    const x = 380 + Math.cos(angle) * radius * wobble;
    const z = Math.sin(angle) * radius * wobble * 0.82;
    const h = ridgeHeight(x, z) * height * (0.55 + random() * 0.75);
    if (previous.set) {
      positions.push(previous.x, 0, previous.z, x, 0, z, previous.x, previous.h, previous.z);
      positions.push(x, 0, z, x, h, z, previous.x, previous.h, previous.z);
    }
    previous.x = x;
    previous.z = z;
    previous.h = h;
    previous.set = true;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function Ground({ quality }: { quality: 'high' | 'balanced' | 'low' }) {
  const detail = quality === 'high' ? 1 : quality === 'balanced' ? 0.68 : 0.45;

  const terrainGeometry = useMemo(
    () =>
      buildTerrainGeometry(
        Math.round(TERRAIN.segmentsX * detail),
        Math.round(TERRAIN.segmentsZ * detail),
      ),
    [detail],
  );
  const survey = useMemo(() => buildSurveyGrid(quality === 'low' ? 26 : 16), [quality]);
  const ridgeNear = useMemo(() => buildRidges(520, 4242, 0.85), []);
  const ridgeFar = useMemo(() => buildRidges(760, 9191, 1.35), []);

  const road = useMemo(() => buildRouteRibbon(), []);
  const roadEdgeLeft = useMemo(
    () => buildRouteRibbon({ halfWidth: 0.22, yOffset: ROAD_SURFACE_OFFSET + 0.012 }),
    [],
  );
  const shoulder = useMemo(
    () => buildRouteRibbon({ halfWidth: ROAD_HALF_WIDTH + 1.7, yOffset: ROAD_SURFACE_OFFSET - 0.03 }),
    [],
  );

  const apron = useMemo(
    () => buildRouteRibbon({ halfWidth: 26, yOffset: ROAD_SURFACE_OFFSET - 0.05, from: 0, to: 96 }),
    [],
  );

  return (
    <group>
      <mesh geometry={terrainGeometry} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.96} metalness={0} />
      </mesh>

      <lineSegments geometry={survey} renderOrder={1}>
        <lineBasicMaterial
          color={SCENE_COLOR.grid}
          transparent
          opacity={quality === 'low' ? 0.2 : 0.32}
          depthWrite={false}
        />
      </lineSegments>

      <mesh geometry={ridgeNear} position={[0, 0, 0]}>
        <meshBasicMaterial color={SCENE_COLOR.ridge} side={DoubleSide} fog />
      </mesh>
      <mesh geometry={ridgeFar} position={[0, 0, 0]}>
        <meshBasicMaterial color={SCENE_COLOR.ridgeFar} side={DoubleSide} fog />
      </mesh>

      {/* Facility apron, then shoulder, then the carriageway, then the centre line. */}
      <mesh geometry={apron} receiveShadow renderOrder={0}>
        <meshStandardMaterial color={SCENE_COLOR.apron} roughness={0.9} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <mesh geometry={shoulder} receiveShadow>
        <meshStandardMaterial color={SCENE_COLOR.roadEdge} roughness={0.94} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      <mesh geometry={road} receiveShadow>
        <meshStandardMaterial color={SCENE_COLOR.road} roughness={0.88} polygonOffset polygonOffsetFactor={-3} />
      </mesh>
      <mesh geometry={roadEdgeLeft} renderOrder={2}>
        <meshBasicMaterial color={SCENE_COLOR.roadCentre} transparent opacity={0.85} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Exposed for tests: the route length actually used to build the ribbon. */
export const groundRouteLength = route.length;
