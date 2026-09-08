'use client';

/**
 * World dressing: the authored Blender props, placed on the terrain.
 *
 * Unique structures are cloned once. Everything repeated — barriers, poles,
 * containers, signs, boulders — goes through one `InstancedMesh` per glTF
 * primitive, so a hundred barriers still cost one draw call each.
 */

import { useGLTF } from '@react-three/drei';
import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  Euler,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Material,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { makeRandom } from '../math/noise';
import { NETWORK_COLOR } from '../theme';
import { route } from '../world/route';
import { SITES, type SiteMarker } from '../world/sites';
import { terrain } from '../world/terrain';

export const PROPS_MODEL_URL = '/models/continua_props.glb';

export interface Placement {
  x: number;
  z: number;
  yaw: number;
  scale?: number;
}

// ---------------------------------------------------------------------------
// Deterministic scatter
// ---------------------------------------------------------------------------

function farEnoughFromRoad(x: number, z: number, minimum: number): boolean {
  return Math.sqrt(route.distanceToRouteSq(x, z).distSq) > minimum;
}

function scatterAlongRoute(
  from: number,
  to: number,
  spacing: number,
  offset: number,
  alternate: boolean,
): Placement[] {
  const out: Placement[] = [];
  let side = 1;
  for (let distance = from; distance <= to; distance += spacing) {
    const sample = route.at(distance);
    const nx = -sample.tz;
    const nz = sample.tx;
    const lateral = alternate ? side * offset : offset;
    out.push({
      x: sample.x + nx * lateral,
      z: sample.z + nz * lateral,
      yaw: sample.heading,
    });
    side *= -1;
  }
  return out;
}

function buildScatter(): Record<string, Placement[]> {
  const random = makeRandom(20260908);

  // Barriers line the service road through the yard and the corridor.
  const barriers = [
    ...scatterAlongRoute(52, 330, 12, 6.6, false),
    ...scatterAlongRoute(58, 324, 12, -6.6, false),
  ];

  const lightPoles = scatterAlongRoute(18, 420, 52, 9.4, true);

  const containers: Placement[] = [];
  for (const [cx, cz, count] of [
    [64, 72, 5],
    [126, -58, 4],
    [206, 52, 3],
  ] as const) {
    for (let i = 0; i < count; i += 1) {
      containers.push({
        x: cx + (i % 2) * 7.4 + random() * 1.2,
        z: cz + Math.floor(i / 2) * 3.2,
        yaw: Math.PI / 2 + (random() - 0.5) * 0.06,
      });
    }
  }

  const signs = [
    { distance: 96, offset: 8.6 },
    { distance: 238, offset: -8.6 },
    { distance: 452, offset: 8.6 },
  ].map(({ distance, offset }) => {
    const sample = route.at(distance);
    return {
      x: sample.x + -sample.tz * offset,
      z: sample.z + sample.tx * offset,
      yaw: sample.heading + (offset > 0 ? -Math.PI / 2 : Math.PI / 2),
    };
  });

  // Boulders in the remote sector, kept clear of the carriageway.
  const rocksA: Placement[] = [];
  const rocksB: Placement[] = [];
  const rocksC: Placement[] = [];
  for (let i = 0; i < 260; i += 1) {
    const x = 300 + random() * 640;
    const z = -240 + random() * 500;
    if (!farEnoughFromRoad(x, z, 13)) continue;
    const placement: Placement = {
      x,
      z,
      yaw: random() * Math.PI * 2,
      scale: 0.65 + random() * 0.9,
    };
    const bucket = random();
    if (bucket < 0.45) rocksA.push(placement);
    else if (bucket < 0.82) rocksB.push(placement);
    else if (rocksC.length < 26) rocksC.push(placement);
  }

  return {
    PROP_Barrier: barriers,
    PROP_LightPole: lightPoles,
    PROP_Container: containers,
    PROP_RoadSign: signs,
    PROP_Rock_A: rocksA,
    PROP_Rock_B: rocksB,
    PROP_Rock_C: rocksC,
  };
}

// ---------------------------------------------------------------------------
// Instancing
// ---------------------------------------------------------------------------

interface Primitive {
  geometry: BufferGeometry;
  material: Material | Material[];
  relative: Matrix4;
}

function collectPrimitives(node: Object3D): Primitive[] {
  node.updateWorldMatrix(true, true);
  const inverse = node.matrixWorld.clone().invert();
  const out: Primitive[] = [];
  node.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.updateWorldMatrix(true, false);
    out.push({
      geometry: child.geometry,
      material: child.material,
      relative: inverse.clone().multiply(child.matrixWorld),
    });
  });
  return out;
}

function InstancedPrimitive({
  primitive,
  placements,
}: {
  primitive: Primitive;
  placements: Placement[];
}) {
  const ref = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const placement = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    placements.forEach((item, index) => {
      position.set(item.x, terrain.height(item.x, item.z), item.z);
      quaternion.setFromEuler(new Euler(0, item.yaw, 0));
      const s = item.scale ?? 1;
      scale.set(s, s, s);
      placement.compose(position, quaternion, scale);
      matrix.copy(placement).multiply(primitive.relative);
      mesh.setMatrixAt(index, matrix);
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
      frustumCulled
    />
  );
}

// ---------------------------------------------------------------------------
// Site markers
// ---------------------------------------------------------------------------

function SiteMarkerRing({
  site,
  selected,
  onSelect,
}: {
  site: SiteMarker;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const y = terrain.height(site.x, site.z);
  const color = site.network ? NETWORK_COLOR[site.network] : '#667593';
  const height = site.linkHeight ?? 3;

  return (
    <group position={[site.x, y, site.z]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.08, 0]}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(site.id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <ringGeometry args={[selected ? 3.4 : 2.6, selected ? 4.0 : 3.0, 48]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.85 : 0.42} depthWrite={false} />
      </mesh>
      {selected && (
        <mesh position={[0, height / 2, 0]}>
          <cylinderGeometry args={[0.05, 0.05, height, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.55} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------

export function WorldProps({
  showMarkers,
  selectedSiteId,
  onSelectSite,
}: {
  showMarkers: boolean;
  selectedSiteId: string | null;
  onSelectSite: (id: string) => void;
}) {
  const { scene } = useGLTF(PROPS_MODEL_URL);
  const scatter = useMemo(() => buildScatter(), []);

  const library = useMemo(() => {
    const map = new Map<string, Object3D>();
    for (const child of scene.children) map.set(child.name, child);
    scene.traverse((node) => {
      if (node.name.startsWith('PROP_') && !map.has(node.name)) map.set(node.name, node);
    });
    return map;
  }, [scene]);

  const instanced = useMemo(() => {
    return Object.entries(scatter).map(([name, placements]) => {
      const node = library.get(name);
      if (!node) {
        console.warn(`[CONTINUA] prop "${name}" not found in ${PROPS_MODEL_URL}`);
        return null;
      }
      return { name, placements, primitives: collectPrimitives(node) };
    });
  }, [scatter, library]);

  const structures = useMemo(() => {
    return SITES.map((site) => {
      const node = library.get(site.prop);
      if (!node) {
        console.warn(`[CONTINUA] site prop "${site.prop}" not found`);
        return null;
      }
      const object = node.clone(true);
      object.traverse((child) => {
        if (child instanceof Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) {
            if (material instanceof MeshStandardMaterial) material.envMapIntensity = 0.8;
          }
        }
      });
      return { site, object };
    }).filter((entry): entry is { site: SiteMarker; object: Object3D } => entry !== null);
  }, [library]);

  return (
    <group name="CONTINUA_World">
      {structures.map(({ site, object }) => (
        <group
          key={site.id}
          position={[site.x, terrain.height(site.x, site.z), site.z]}
          rotation={[0, site.yaw, 0]}
          scale={site.scale ?? 1}
        >
          <primitive object={object} />
        </group>
      ))}

      {instanced.map((entry) =>
        entry === null
          ? null
          : entry.primitives.map((primitive, index) => (
              <InstancedPrimitive
                key={`${entry.name}-${index}`}
                primitive={primitive}
                placements={entry.placements}
              />
            )),
      )}

      {showMarkers &&
        SITES.filter((site) => site.selectable).map((site) => (
          <SiteMarkerRing
            key={site.id}
            site={site}
            selected={selectedSiteId === site.id}
            onSelect={onSelectSite}
          />
        ))}
    </group>
  );
}

useGLTF.preload(PROPS_MODEL_URL);
