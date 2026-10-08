'use client';

/**
 * The ridge tunnel (`world/tunnel.ts`).
 *
 * The portals, the lining, the jet fans, the emergency stations and the
 * pipeline's turn into the ground are the Blender models in
 * continua_tunnel.glb (scripts/blender/world_tunnel.py): one instanced mesh
 * per primitive, like every other prop, each piece laid on the road's own line
 * and grade.
 *
 * The hill over the tunnel is drawn here, in two parts that share their edge:
 * over the bore, route-aligned from one portal's face to the other's; and in
 * front of each portal, in the portal's own frame, its inner edge on the back
 * of the wing walls' copings so the walls hold it back. It is drawn with the
 * ground's own shader - the same meadow as the land round it, rock where the
 * cut is steep - and its foot dips under the ground, so the two surfaces cross
 * cleanly instead of flickering where the ground mesh's 6 m facets wander
 * above and below it.
 *
 * Inside, the lining is in the hill's shadow: lit by its luminaires, which
 * the scene stands in for with a warm light that keeps pace with the rover
 * while it is in the tunnel - from fitting to fitting, never from the sky.
 * Decoration: nothing here is part of any measurement.
 */

import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
  type InstancedMesh,
  type Material,
  type Object3D,
  type PointLight,
} from 'three';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { SCENE_COLOR } from '../theme';
import { CAMPUS } from '../world/layout';
import { route } from '../world/route';
import { SEA_LEVEL, terrain } from '../world/terrain';
import {
  ceilingAt,
  cutEdge,
  hillSurface,
  PIPELINE_PIECES,
  PORTALS,
  SEGMENT_CENTRES,
  TUNNEL,
  TUNNEL_PIECES,
  type TunnelPlacement,
} from '../world/tunnel';
import { TUNNEL_MODEL_URL } from './assets';
import { terrainMaterial } from './shaders';
import { collectPrimitives, type Primitive } from './WorldProps';

// ---------------------------------------------------------------------------
// The hill
// ---------------------------------------------------------------------------

/** Lateral offsets of the hill's columns beyond the wing walls' copings, metres. */
const BEYOND = [8.262, 8.7, 9.3, 10.1, 11.1, 12.4, 14, 16, 18.5, 21.5, 25, 29, 34, 40, 47, 55, 64, 74, 85, 97, 110, 124, 140];
/** Over the bore, between the copings: the hill above the lining. */
const OVER = [-7.6, -6.4, -5.2, -4, -2.7, -1.35, 0, 1.35, 2.7, 4, 5.2, 6.4, 7.6];
const ACROSS = [...BEYOND.map((m) => -m).reverse(), ...OVER, ...BEYOND];
/** How far out in front of each portal the hill's rows run, metres: close where the cut is shaped. */
const OUT = [
  0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14.5, 15, 16, 17.5, 19, 21, 23.5, 26, 29, 33, 38, 44, 51,
  59, 68, 78, 90,
];

/** Route metres of the rows over the bore: close at the faces, where the hill rises off the copings. */
function boreRows(): number[] {
  const rows: number[] = [TUNNEL.from];
  for (const step of [0.6, 1.35, 2.2, 3.2, 4.5]) rows.push(TUNNEL.from + step);
  for (let u = TUNNEL.from + 6.5; u < TUNNEL.to - 6; u += 2.5) rows.push(u);
  for (const step of [4.5, 3.2, 2.2, 1.35, 0.6]) rows.push(TUNNEL.to - step);
  rows.push(TUNNEL.to);
  return rows;
}

function buildHill(): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const vertex = (x: number, z: number): number => {
    positions.push(x, hillSurface(x, z) ?? terrain.height(x, z) - 1, z);
    return positions.length / 3 - 1;
  };
  // Each triangle wound to face up, whichever way round its grid runs.
  const triangle = (a: number, b: number, c: number) => {
    const ux = positions[b * 3]! - positions[a * 3]!;
    const uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
    const vx = positions[c * 3]! - positions[a * 3]!;
    const vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    if (uz * vx - ux * vz >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };
  const quad = (a: number, b: number, c: number, d: number) => {
    triangle(a, b, c);
    triangle(a, c, d);
  };

  // Over the bore, from face to face.
  const bore = boreRows().map((u) => {
    const sample = route.at(u);
    const length = Math.hypot(sample.tx, sample.tz) || 1;
    const nx = -sample.tz / length;
    const nz = sample.tx / length;
    return ACROSS.map((v) => vertex(sample.x + nx * v, sample.z + nz * v));
  });
  for (let i = 0; i < bore.length - 1; i += 1) {
    for (let j = 0; j < ACROSS.length - 1; j += 1) quad(bore[i]![j]!, bore[i]![j + 1]!, bore[i + 1]![j + 1]!, bore[i + 1]![j]!);
  }

  // In front of each portal, either side of its cut. The first row is the
  // bore's row in the face: the portal's lateral axis is the route's left
  // normal at the exit and its opposite at the entry.
  PORTALS.forEach((portal, index) => {
    const face = index === 0 ? bore[0]! : bore[bore.length - 1]!;
    const flip = index === 0 ? -1 : 1;
    for (const side of [1, -1]) {
      const grid = OUT.map((out, k) =>
        BEYOND.map((m) => {
          if (k === 0) return face[ACROSS.indexOf(flip * side * m)]!;
          // The innermost column follows the cut's edge; the next ones ease
          // back to their places, so the grid fans out with the cut.
          const ease = Math.max(0, 1 - (m - BEYOND[0]!) / 30);
          const reach = m + (cutEdge(out) + 0.002 - BEYOND[0]!) * ease;
          return vertex(
            portal.x + portal.fx * out - portal.fz * side * reach,
            portal.z + portal.fz * out + portal.fx * side * reach,
          );
        }),
      );
      for (let k = 0; k < grid.length - 1; k += 1) {
        for (let j = 0; j < BEYOND.length - 1; j += 1) quad(grid[k]![j]!, grid[k]![j + 1]!, grid[k + 1]![j + 1]!, grid[k + 1]![j]!);
      }
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

const _ex = new Vector3();
const _ey = new Vector3();
const _ez = new Vector3();

/** A piece's frame: +X its forward on the road's grade, +Y up, +Z to its right. */
function pieceMatrix(piece: TunnelPlacement, target: Matrix4): Matrix4 {
  _ex.set(piece.fx, piece.slope, piece.fz).normalize();
  _ez.set(-piece.fz, 0, piece.fx).normalize();
  _ey.crossVectors(_ez, _ex).normalize();
  _ez.crossVectors(_ex, _ey).normalize();
  return target.makeBasis(_ex, _ey, _ez).setPosition(piece.x, piece.y, piece.z);
}

const _matrix = new Matrix4();
const _placement = new Matrix4();

function Pieces({ primitive, placements }: { primitive: Primitive; placements: readonly TunnelPlacement[] }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    placements.forEach((piece, index) => {
      pieceMatrix(piece, _placement);
      mesh.setMatrixAt(index, _matrix.copy(_placement).multiply(primitive.relative));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placements, primitive]);
  if (placements.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[primitive.geometry, primitive.material as Material, placements.length]}
      castShadow
      receiveShadow
      // The cached glTF's geometry and materials: never disposed with the mesh.
      dispose={null}
    />
  );
}

/**
 * The tunnel's own finishes, adjusted once. The luminaires' diffusers are
 * the brightest thing inside and stay white under tone mapping; the lining is
 * in the hill's shadow, so the glazed cladding gets a little of the fittings'
 * light back as its own, which is what makes a tunnel read as lit.
 */
function tuneTunnelMaterial(material: Material): void {
  if (!(material instanceof MeshStandardMaterial) || material.userData.continuaTuned) return;
  material.userData.continuaTuned = true;
  if (material.name === 'W_Tunnel_Cladding') {
    material.emissive.set('#FFF3E0');
    material.emissiveIntensity = 0.16;
  } else if (material.name === 'W_Tunnel_Arch') {
    material.emissive.set('#FFF3E0');
    material.emissiveIntensity = 0.07;
  } else if (material.name === 'W_Tunnel_Walkway' || material.name === 'W_Tunnel_Kerb') {
    material.emissive.set('#FFF3E0');
    material.emissiveIntensity = 0.06;
  }
}

// ---------------------------------------------------------------------------
// The light inside
// ---------------------------------------------------------------------------

/** Where the luminaires hang, metres along each segment from its centre (world_tunnel.py). */
const FITTINGS = [-1.5, 1.5];
/** Route metres of every fitting, entry to exit. */
const FITTING_AT = SEGMENT_CENTRES.flatMap((centre) => FITTINGS.map((offset) => centre + offset));
const LIGHT_INTENSITY = 26;

/**
 * A warm light under the crown, at whichever fitting is nearest the rover,
 * while the rover is in the tunnel: the rover and the road round it lit as
 * the luminaires would light them. It steps from fitting to fitting with a
 * short cross-fade - a pure function of the rover's place - and goes out as
 * the rover leaves.
 */
function InteriorLight() {
  const { frame } = useSceneRuntime();
  const light = useRef<PointLight>(null);
  useFrame(() => {
    const point = light.current;
    if (!point) return;
    const distance = frame.current.vehicle.distance;
    const inside = Math.min(distance - TUNNEL.from, TUNNEL.to - distance);
    if (inside < -6) {
      point.intensity = 0;
      return;
    }
    let nearest = FITTING_AT[0]!;
    for (const at of FITTING_AT) if (Math.abs(at - distance) < Math.abs(nearest - distance)) nearest = at;
    // Halfway between two fittings the light sits between them, so it never jumps.
    const offset = distance - nearest;
    const along = nearest + offset * (1 - Math.min(1, Math.abs(offset) / 1.5) * 0.65);
    const sample = route.at(along);
    point.position.set(sample.x, terrain.elevationAtDistance(along) + ceilingAt(0) - 1.2, sample.z);
    point.intensity = LIGHT_INTENSITY * Math.min(1, Math.max(0, (inside + 6) / 8));
  });
  return <pointLight ref={light} color="#FFE7C2" intensity={0} distance={22} decay={1.6} castShadow={false} />;
}

// ---------------------------------------------------------------------------

export function Tunnel({ lite = false }: { lite?: boolean }) {
  const { scene } = useGLTF(TUNNEL_MODEL_URL);
  const library = useMemo(() => {
    const map = new Map<string, Object3D>();
    for (const child of scene.children) map.set(child.name, child);
    scene.traverse((node) => {
      const mesh = node as Object3D & { material?: Material | Material[] };
      if (!mesh.material) return;
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(tuneTunnelMaterial);
    });
    return map;
  }, [scene]);

  const pieces = useMemo(
    () =>
      Object.entries({ ...TUNNEL_PIECES, ...PIPELINE_PIECES }).flatMap(([name, placements]) => {
        const node = library.get(name);
        if (!node) {
          console.warn(`[CONTINUA] tunnel piece "${name}" not found in ${TUNNEL_MODEL_URL}`);
          return [];
        }
        return collectPrimitives(node).map((primitive, index) => ({ key: `${name}-${index}`, primitive, placements }));
      }),
    [library],
  );

  const hill = useMemo(() => buildHill(), []);
  useEffect(() => () => hill.dispose(), [hill]);

  // The hill is the ground: the ground's own shader, with its cloud shadows.
  const { clock } = useSceneRuntime();
  const time = useMemo(() => ({ value: 0 }), []);
  useFrame(() => {
    time.value = clock.time;
  });
  const hillMaterial = useMemo(() => {
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
    // An open surface, lit from above: cast from both faces, or the sun's
    // shadow pass - which draws back faces - would see none of it.
    material.shadowSide = DoubleSide;
    return material;
  }, [lite, time]);
  useEffect(() => () => hillMaterial.dispose(), [hillMaterial]);

  return (
    <group name="CONTINUA_Tunnel">
      <mesh name="CONTINUA_TunnelHill" geometry={hill} material={hillMaterial} castShadow receiveShadow />
      {pieces.map(({ key, primitive, placements }) => (
        <Pieces key={key} primitive={primitive} placements={placements} />
      ))}
      <InteriorLight />
    </group>
  );
}

useGLTF.preload(TUNNEL_MODEL_URL);
