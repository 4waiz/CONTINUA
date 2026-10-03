'use client';

/**
 * World dressing: the authored Blender props, placed on the terrain.
 *
 * Every prop - a single operations centre or four hundred fence panels - goes
 * through one `InstancedMesh` per glTF primitive, so the cost is one draw call
 * per material of each prop type, not per copy. Placements come from two
 * tables: `SITES` (the access-network structures, whose positions the engine
 * shares) and `WORLD_LAYOUT` (set dressing, which no measurement depends on).
 *
 * The only motion is the wind-turbine rotors, and it is a pure function of the
 * scene clock - scrub to a time and the blades are where they were.
 */

import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Box3,
  BufferGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderChunk,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { NETWORK_COLOR } from '../theme';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { PYLON_CONDUCTORS, TURBINE, WORLD_LAYOUT, type Placement } from '../world/layout';
import { SITES, type SiteMarker } from '../world/sites';
import { SEA_LEVEL, terrain } from '../world/terrain';
import { PROPS_MODEL_URL } from './assets';
import { plainGlazing, windowMaterial, type RoomSpec } from './windows';

export { PROPS_MODEL_URL };

export type { Placement };

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

const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _euler = new Euler();
const _placement = new Matrix4();

function placementMatrix(item: Placement, target: Matrix4): Matrix4 {
  _position.set(item.x, terrain.height(item.x, item.z), item.z);
  _quaternion.setFromEuler(_euler.set(0, item.yaw, 0));
  const s = item.scale ?? 1;
  _scale.set(s, s, s);
  return target.compose(_position, _quaternion, _scale);
}

/**
 * The low tier's leaf cards: Lambert instead of physically based shading,
 * same texture, clip and vertex colours. A software rasteriser shades every
 * fragment of every card before the alpha test throws most of them away, and
 * the PBR model was most of that cost. Shared per source material, never
 * disposed with a mesh - like the glTF's own.
 */
const LOW_CARD_MATERIALS = new WeakMap<Material, Material>();

function lowTierMaterial(source: Material): Material {
  // Glazing on the low tier is the plain tinted glass, without rooms.
  const material = plainGlazing(source);
  if (!(material instanceof MeshStandardMaterial) || !material.name.includes('Card')) return material;
  let low = LOW_CARD_MATERIALS.get(material);
  if (!low) {
    low = new MeshLambertMaterial({
      name: `${material.name}_Low`,
      map: material.map,
      color: material.color,
      vertexColors: material.vertexColors,
      alphaTest: material.alphaTest,
      side: material.side,
    });
    LOW_CARD_MATERIALS.set(material, low);
  }
  return low;
}

function InstancedPrimitive({
  primitive,
  placements,
  castShadow = true,
  count,
  lite = false,
}: {
  primitive: Primitive;
  placements: readonly Placement[];
  castShadow?: boolean;
  /** How many of the placements to draw (all by default). */
  count?: number;
  /** The low tier: cheaper shading for foliage cards. */
  lite?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    placements.forEach((item, index) => {
      placementMatrix(item, _placement);
      matrix.copy(_placement).multiply(primitive.relative);
      mesh.setMatrixAt(index, matrix);
    });
    // Drawn instances first; the bounding sphere is of what is drawn.
    mesh.count = count ?? placements.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placements, primitive, count]);

  if (placements.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[primitive.geometry, primitive.material as Material, placements.length]}
      // A tier change swaps the material on the mesh, never rebuilds the mesh.
      material={lite ? lowTierMaterial(primitive.material as Material) : (primitive.material as Material)}
      castShadow={castShadow}
      receiveShadow
      frustumCulled
      // The geometry and material belong to the cached glTF and every other
      // instance of them: never let the renderer dispose them with this mesh.
      dispose={null}
    />
  );
}

/**
 * Material adjustments the exporter cannot express. Applied once per material.
 *
 * (The envMapIntensity values here do not reach the screen: three replaces a
 * material's envMapIntensity with the scene's environmentIntensity whenever
 * the scene's environment lights it, as it lights all of these. The buildings'
 * glazing raises its reflection in its own shader instead - windows.ts.)
 */
function tuneMaterial(material: Material): void {
  if (!(material instanceof MeshStandardMaterial)) return;
  if (material.userData.continuaTuned) return;
  material.userData.continuaTuned = true;
  const name = material.name;
  if (name.includes('Glass')) {
    material.envMapIntensity = 2.6;
  } else if (name.includes('Fence_Mesh')) {
    material.transparent = true;
    material.depthWrite = false;
  } else if (name.includes('Solar')) {
    material.envMapIntensity = 1.3;
  } else if (name.includes('Card')) {
    // Foliage cards (scripts/blender/world_foliage.py): alpha-clipped sprays of
    // leaf, blossom or palm frond, double-sided. Their normals point out of
    // each crown, so a card seen from behind must keep the normal it was
    // given - flipped, as double-sided shading does, half of every crown lit
    // as if it faced inward. (Alpha to coverage was tried for softer edges:
    // in the multisampled post-processing target it dithered a light net
    // across every crown, so the cards are plainly clipped.)
    material.envMapIntensity = 0.55;
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <normal_fragment_begin>',
          ShaderChunk.normal_fragment_begin.replace(
            'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;',
            'float faceDirection = 1.0;',
          ),
        )
        // Mipmaps average the leaves' alpha toward the gaps between them, so
        // a clipped crown thins out with distance. Scale alpha back up by how
        // far the texture is minified - in its least-minified direction, so a
        // card seen edge-on (squeezed one way only) is not turned into a
        // solid bright line - and far crowns stay full.
        .replace(
          '#include <alphatest_fragment>',
          `#ifdef USE_MAP
             {
               vec2 ctTexel = vMapUv * 1024.0;
               float ctMip = max(0.0, 0.5 * log2(min(dot(dFdx(ctTexel), dFdx(ctTexel)), dot(dFdy(ctTexel), dFdy(ctTexel)))));
               diffuseColor.a *= 1.0 + ctMip * 0.28;
             }
           #endif
           #include <alphatest_fragment>`,
        );
    };
    material.customProgramCacheKey = () => 'continua-foliage-card-v3';
    material.needsUpdate = true;
  } else {
    material.envMapIntensity = 0.75;
  }
}

// ---------------------------------------------------------------------------
// Rooms behind the glazing (windows.ts)
// ---------------------------------------------------------------------------

/**
 * The rooms behind each building's glazing, in its own frame (glTF: y up, the
 * front +X). Storeys and floor lines follow the slab edges authored in
 * scripts/blender/world_campus.py and world_coast.py, so a floor never crosses
 * a window. Only buildings: a car's or a lighthouse's glass has no office
 * behind it.
 */
const ROOMS: Record<string, Record<string, RoomSpec>> = {
  // Two upper floors from 4.6 m, 4.1 m apart; the ground floor's colonnade
  // glazing and doors are the dark glass, one 4.6 m storey.
  PROP_Facility_Main: {
    W_Glass: { width: 3.0, storey: 4.1, depth: 6.5, floor: 0.5 },
    W_Glass_Dark: { width: 3.0, storey: 4.6, depth: 8.0, floor: 0 },
  },
  // Three appliance bays 7 m apart behind glazed doors, the crew block's two
  // 4.2 m storeys beside them.
  PROP_ResponseStation: {
    W_Glass_Dark: { width: 7.0, storey: 8.0, depth: 14.0, floor: 0, shift: -0.5, kind: 'garage' },
    W_Glass: { width: 3.0, storey: 4.2, depth: 6.0, floor: 0 },
  },
  // The workshop lean-to's ribbon windows (the crown skylight is horizontal
  // and keeps the plain glass).
  PROP_Facility_Hangar: { W_Glass: { width: 3.2, storey: 4.0, depth: 5.0, floor: 0 } },
  // The rover garage's control room beside its door: one tall room.
  PROP_RoverGarage: { W_Glass: { width: 3.6, storey: 4.4, depth: 4.5, floor: 0 } },
  // The gate's security booth, and the warehouse's two-storey office annex
  // (its roof glazing is the dark glass and stays plain).
  PROP_Gatehouse: { W_Glass: { width: 2.6, storey: 3.2, depth: 3.0, floor: 0 } },
  PROP_Warehouse: { W_Glass: { width: 3.0, storey: 3.3, depth: 6.0, floor: 0 } },
  PROP_Skyline_A: { W_Tower_Glass: { width: 3.4, storey: 3.6, depth: 7.0, floor: 0 } },
  PROP_Skyline_B: { W_Tower_Glass: { width: 3.4, storey: 3.6, depth: 7.0, floor: 0 } },
  PROP_Skyline_C: { W_Tower_Glass: { width: 3.4, storey: 3.6, depth: 7.0, floor: 0 } },
};

function withRooms(prop: string, primitive: Primitive): Primitive {
  const material = primitive.material;
  if (Array.isArray(material) || !(material instanceof MeshStandardMaterial)) return primitive;
  const room = ROOMS[prop]?.[material.name];
  if (!room) return primitive;
  return { ...primitive, material: windowMaterial(material, room, `${prop}/${material.name}`) };
}

// ---------------------------------------------------------------------------
// The dock's status line
// ---------------------------------------------------------------------------

/**
 * The line under the dock's number on both faces of its gantry
 * (world_industry.py, `dock_status`): red while the rover stands in the bay,
 * green from the moment it pulls out. Read from the rover's distance along
 * the route, so a frame is still a pure function of the clock. Decoration: it
 * shows where the rover is, never anything measured.
 */
const DOCK_STATUS = 'W_Dock_Status';
const STATUS_DOCKED = new Color('#FF3B30');
const STATUS_CLEAR = new Color('#2FD35C');

function withStatus(primitive: Primitive, status: MeshStandardMaterial | null): Primitive {
  const material = primitive.material;
  if (!status || Array.isArray(material) || material.name !== DOCK_STATUS) return primitive;
  return { ...primitive, material: status };
}

function DockStatus({ material }: { material: MeshStandardMaterial }) {
  const { frame } = useSceneRuntime();
  useFrame(() => {
    const clear = smoothstep(0.15, 0.45, frame.current.vehicle.distance);
    material.emissive.copy(STATUS_DOCKED).lerp(STATUS_CLEAR, clear);
  });
  return null;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Ground contact: a soft occlusion footprint under every solid prop
// ---------------------------------------------------------------------------

/**
 * Open structures, compounds and things whose footprint is not their bounding
 * box: a dark rectangle under a lattice tower or a fenced yard reads as a
 * stain, not as contact.
 */
const NO_FOOTPRINT = new Set([
  'PROP_Fence', 'PROP_Bund', 'PROP_Helipad', 'PROP_Skyline_A', 'PROP_Skyline_B', 'PROP_Skyline_C',
  'PROP_WindTurbine_Rotor', 'PROP_RoadSign', 'PROP_Pylon', 'PROP_PipeRack', 'PROP_SatTerminal',
  'PROP_Substation', 'PROP_ValveStation', 'PROP_DockStation', 'PROP_Gatehouse', 'PROP_Carport',
  'PROP_WaterTower', 'PROP_SolarField', 'PROP_Flagpole', 'PROP_LightPole', 'PROP_Bollard',
  'PROP_Pipeline', 'PROP_CellTower', 'PROP_WifiMast',
  // Plants and boulders: a dark square under a palm on a lawn reads as a stain.
  'PROP_Palm', 'PROP_Ghaf', 'PROP_Shrub_A', 'PROP_Shrub_B', 'PROP_Rock_A', 'PROP_Rock_B', 'PROP_Rock_C',
  'PROP_FlameTree', 'PROP_Jacaranda', 'PROP_FlowerBed', 'PROP_FlowerBush_Magenta', 'PROP_FlowerBush_Coral',
  'PROP_FlowerBush_Yellow', 'PROP_FlowerBush_White', 'PROP_Jetty', 'PROP_LifeguardTower',
]);

const FOOTPRINT_VERTEX = /* glsl */ `
  attribute vec2 aInner;
  attribute float aStrength;
  varying vec2 vUv;
  varying vec2 vInner;
  varying float vStrength;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vInner = aInner;
    vStrength = aStrength;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FOOTPRINT_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vInner;
  varying float vStrength;
  #include <fog_pars_fragment>
  void main() {
    // 0 inside the prop's own footprint, 1 at the edge of its soft skirt.
    vec2 p = abs(vUv * 2.0 - 1.0);
    vec2 d = max(p - vInner, 0.0) / max(1.0 - vInner, vec2(1e-3));
    float r = length(d);
    float a = (1.0 - smoothstep(0.0, 1.0, r));
    a = a * a * vStrength;
    gl_FragColor = vec4(0.16, 0.13, 0.10, a);
    #include <fog_fragment>
    #ifdef USE_FOG
      gl_FragColor.a *= 1.0 - fogFactor;
    #endif
  }
`;

interface Footprint {
  cx: number;
  cz: number;
  width: number;
  depth: number;
  height: number;
}

function footprintOf(primitives: Primitive[]): Footprint | null {
  const box = new Box3();
  const part = new Box3();
  for (const primitive of primitives) {
    if (!primitive.geometry.boundingBox) primitive.geometry.computeBoundingBox();
    if (!primitive.geometry.boundingBox) continue;
    part.copy(primitive.geometry.boundingBox).applyMatrix4(primitive.relative);
    box.union(part);
  }
  if (box.isEmpty()) return null;
  return {
    cx: (box.min.x + box.max.x) / 2,
    cz: (box.min.z + box.max.z) / 2,
    width: box.max.x - box.min.x,
    depth: box.max.z - box.min.z,
    height: box.max.y - box.min.y,
  };
}

/**
 * Baked AO darkens a prop's own surfaces, but nothing darkened the ground
 * under it, so buildings and tanks sat *on* the sand rather than in it. One
 * instanced draw lays a soft rounded footprint under every solid prop, its
 * skirt scaled to the prop's height, fading with the fog like everything else.
 */
function GroundContact({ entries }: { entries: { name: string; placements: Placement[]; primitives: Primitive[] }[] }) {
  const mesh = useMemo(() => {
    const items: { matrix: Matrix4; inner: [number, number]; strength: number }[] = [];
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const euler = new Euler();
    for (const entry of entries) {
      if (NO_FOOTPRINT.has(entry.name)) continue;
      const footprint = footprintOf(entry.primitives);
      if (!footprint || footprint.width < 0.2 || footprint.depth < 0.2) continue;
      for (const item of entry.placements) {
        const s = item.scale ?? 1;
        const skirt = Math.min(7, Math.max(0.5, footprint.height * s * 0.22));
        const width = footprint.width * s + skirt * 2;
        const depth = footprint.depth * s + skirt * 2;
        const cos = Math.cos(item.yaw);
        const sin = Math.sin(item.yaw);
        const ox = footprint.cx * s;
        const oz = footprint.cz * s;
        const x = item.x + ox * cos + oz * sin;
        const z = item.z - ox * sin + oz * cos;
        position.set(x, terrain.height(x, z) + 0.05, z);
        rotation.setFromEuler(euler.set(0, item.yaw, 0));
        scale.set(width, 1, depth);
        const area = footprint.width * footprint.depth * s * s;
        items.push({
          matrix: new Matrix4().compose(position, rotation, scale),
          inner: [(footprint.width * s) / width, (footprint.depth * s) / depth],
          // Big footprints get a lighter touch, or a hall reads as a hole.
          strength: area > 600 ? 0.42 : area > 60 ? 0.5 : 0.46,
        });
      }
    }
    const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geometry.setAttribute('aInner', new InstancedBufferAttribute(Float32Array.from(items.flatMap((item) => item.inner)), 2));
    geometry.setAttribute('aStrength', new InstancedBufferAttribute(Float32Array.from(items.map((item) => item.strength)), 1));
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.clone(UniformsLib.fog),
      vertexShader: FOOTPRINT_VERTEX,
      fragmentShader: FOOTPRINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    const instanced = new InstancedMesh(geometry, material, items.length);
    items.forEach((item, index) => instanced.setMatrixAt(index, item.matrix));
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
    instanced.renderOrder = 1;
    instanced.name = 'CONTINUA_GroundContact';
    return instanced;
  }, [entries]);

  return <primitive object={mesh} />;
}

// ---------------------------------------------------------------------------
// Wind turbines: rotors turn with the clock
// ---------------------------------------------------------------------------

function TurbineRotors({ library, placements }: { library: Map<string, Object3D>; placements: readonly Placement[] }) {
  const { clock } = useSceneRuntime();
  const primitives = useMemo(() => {
    const node = library.get(TURBINE.rotor);
    return node ? collectPrimitives(node) : [];
  }, [library]);
  const refs = useRef<(InstancedMesh | null)[]>([]);
  const hub = useMemo(() => new Matrix4().makeTranslation(TURBINE.hub[0], TURBINE.hub[1], TURBINE.hub[2]), []);
  const spin = useMemo(() => new Matrix4(), []);
  const matrix = useMemo(() => new Matrix4(), []);

  useFrame(() => {
    // Each turbine starts at its own phase so the farm does not turn in lockstep.
    placements.forEach((item, index) => {
      const angle = clock.time * TURBINE.speed + index * 1.7;
      placementMatrix(item, _placement);
      spin.makeRotationX(angle);
      for (let p = 0; p < primitives.length; p += 1) {
        const mesh = refs.current[p];
        if (!mesh) continue;
        matrix.copy(_placement).multiply(hub).multiply(spin).multiply(primitives[p]!.relative);
        mesh.setMatrixAt(index, matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }
    });
  });

  if (placements.length === 0) return null;
  return (
    <group name="CONTINUA_TurbineRotors">
      {primitives.map((primitive, index) => (
        <instancedMesh
          key={index}
          ref={(mesh) => {
            refs.current[index] = mesh;
          }}
          args={[primitive.geometry, primitive.material as Material, placements.length]}
          castShadow
          frustumCulled={false}
          dispose={null}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Boats: yachts and the rescue boat at sea, the rescue boat's twin at the jetty
// ---------------------------------------------------------------------------

/**
 * Boats on slow elliptical courses well offshore, and a rescue boat moored at
 * the jetty, all riding a gentle swell. Every pose is a pure function of the
 * scene clock, so a scrubbed or captured frame puts each boat where it was.
 * Decoration only: nothing here is part of any measurement.
 */
interface Course {
  prop: string;
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  /** Seconds per lap; negative sails the other way round. */
  period: number;
  phase: number;
  /** Steady heel under sail, radians. */
  heel: number;
}

const COURSES: readonly Course[] = [
  { prop: 'PROP_Boat_Sail', cx: 380, cz: -405, rx: 230, rz: 60, period: 640, phase: 0.1, heel: 0.12 },
  { prop: 'PROP_Boat_Sail', cx: 830, cz: -340, rx: 150, rz: 55, period: -520, phase: 0.55, heel: -0.1 },
  { prop: 'PROP_Boat_Rescue', cx: 300, cz: -292, rx: 250, rz: 40, period: 300, phase: 0.3, heel: 0 },
];

/** Moored alongside the jetty below the campus, bow out to sea. */
const MOORED: readonly { prop: string; x: number; z: number; yaw: number }[] = [
  { prop: 'PROP_Boat_Rescue', x: 64.6, z: -201, yaw: Math.PI / 2 },
];

const _boatEuler = new Euler();
const _boatQuaternion = new Quaternion();
const _boatPosition = new Vector3();
const _boatScale = new Vector3(1, 1, 1);

function boatMatrix(x: number, z: number, yaw: number, heel: number, time: number, seed: number, target: Matrix4): Matrix4 {
  // A long, low swell: a few centimetres of heave and a degree or two of pitch and roll.
  const heave = 0.06 * Math.sin(time * 1.15 + seed) + 0.025 * Math.sin(time * 2.3 + seed * 1.7);
  const pitch = 0.022 * Math.sin(time * 0.9 + seed * 0.6);
  const roll = heel + 0.035 * Math.sin(time * 0.7 + seed * 1.3);
  _boatPosition.set(x, SEA_LEVEL + heave, z);
  _boatQuaternion.setFromEuler(_boatEuler.set(roll, yaw, pitch, 'YXZ'));
  return target.compose(_boatPosition, _boatQuaternion, _boatScale);
}

function Boats({ library }: { library: Map<string, Object3D> }) {
  const { clock } = useSceneRuntime();
  const boats = useMemo(() => {
    const out: { primitives: Primitive[]; course?: Course; moored?: (typeof MOORED)[number]; seed: number }[] = [];
    COURSES.forEach((course, index) => {
      const node = library.get(course.prop);
      if (node) out.push({ primitives: collectPrimitives(node), course, seed: index * 2.1 + 0.4 });
    });
    MOORED.forEach((moored, index) => {
      const node = library.get(moored.prop);
      if (node) out.push({ primitives: collectPrimitives(node), moored, seed: 7.3 + index });
    });
    return out;
  }, [library]);
  const refs = useRef<(Mesh | null)[][]>([]);
  const base = useMemo(() => new Matrix4(), []);

  useFrame(() => {
    const time = clock.time;
    boats.forEach(({ primitives, course, moored, seed }, b) => {
      if (course) {
        const angle = course.phase * Math.PI * 2 + (time / course.period) * Math.PI * 2;
        const direction = Math.sign(course.period);
        const x = course.cx + course.rx * Math.cos(angle);
        const z = course.cz + course.rz * Math.sin(angle);
        const tx = -course.rx * Math.sin(angle) * direction;
        const tz = course.rz * Math.cos(angle) * direction;
        boatMatrix(x, z, Math.atan2(-tz, tx), course.heel, time, seed, base);
      } else if (moored) {
        boatMatrix(moored.x, moored.z, moored.yaw, 0, time * 0.8, seed, base);
      }
      primitives.forEach((primitive, index) => {
        const mesh = refs.current[b]?.[index];
        if (mesh) mesh.matrix.copy(base).multiply(primitive.relative);
      });
    });
  });

  return (
    <group name="CONTINUA_Boats">
      {boats.map(({ primitives }, b) =>
        primitives.map((primitive, index) => (
          <mesh
            key={`${b}-${index}`}
            ref={(mesh) => {
              (refs.current[b] ??= [])[index] = mesh;
            }}
            geometry={primitive.geometry}
            material={primitive.material}
            matrixAutoUpdate={false}
            castShadow
            receiveShadow
            frustumCulled={false}
            dispose={null}
          />
        )),
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Ambient traffic: a few vehicles about the campus and the corridor
// ---------------------------------------------------------------------------

/**
 * Shuttles on the service roads, clear of the rover's carriageway: drive out,
 * park, drive back, park. Position is a pure function of the clock, so a
 * scrubbed frame puts every van where it was. Decoration only - nothing here
 * is part of any measurement.
 */
const SHUTTLES: readonly { prop: string; from: [number, number]; to: [number, number]; period: number; offset: number }[] = [
  { prop: 'PROP_Van', from: [40, 6], to: [40, 17], period: 24, offset: 0 },
  { prop: 'PROP_Car_C', from: [100, -8], to: [100, 40], period: 30, offset: 9 },
  { prop: 'PROP_Van', from: [392, -9], to: [392, 50], period: 34, offset: 17 },
];

function shuttleAt(time: number, period: number, offset: number): { along: number; outbound: boolean } {
  const p = ((((time + offset) % period) + period) % period) / period;
  const ease = (x: number) => x * x * (3 - 2 * x);
  // 12 % parked at the start, 34 % driving out, 12 % parked, 34 % back, 8 % parked.
  if (p < 0.12) return { along: 0, outbound: true };
  if (p < 0.46) return { along: ease((p - 0.12) / 0.34), outbound: true };
  if (p < 0.58) return { along: 1, outbound: true };
  if (p < 0.92) return { along: 1 - ease((p - 0.58) / 0.34), outbound: false };
  return { along: 0, outbound: false };
}

function AmbientTraffic({ library }: { library: Map<string, Object3D> }) {
  const { clock } = useSceneRuntime();
  const vehicles = useMemo(
    () =>
      SHUTTLES.flatMap((shuttle) => {
        const node = library.get(shuttle.prop);
        return node ? [{ shuttle, primitives: collectPrimitives(node) }] : [];
      }),
    [library],
  );
  const refs = useRef<(Mesh | null)[][]>([]);
  const base = useMemo(() => new Matrix4(), []);

  useFrame(() => {
    vehicles.forEach(({ shuttle, primitives }, v) => {
      const { along, outbound } = shuttleAt(clock.time, shuttle.period, shuttle.offset);
      const [ax, az] = shuttle.from;
      const [bx, bz] = shuttle.to;
      const x = ax + (bx - ax) * along;
      const z = az + (bz - az) * along;
      const dx = (bx - ax) * (outbound ? 1 : -1);
      const dz = (bz - az) * (outbound ? 1 : -1);
      placementMatrix({ x, z, yaw: Math.atan2(-dz, dx) }, base);
      primitives.forEach((primitive, index) => {
        const mesh = refs.current[v]?.[index];
        if (mesh) mesh.matrix.copy(base).multiply(primitive.relative);
      });
    });
  });

  return (
    <group name="CONTINUA_Traffic">
      {vehicles.map(({ primitives }, v) =>
        primitives.map((primitive, index) => (
          <mesh
            key={`${v}-${index}`}
            ref={(mesh) => {
              (refs.current[v] ??= [])[index] = mesh;
            }}
            geometry={primitive.geometry}
            material={primitive.material}
            matrixAutoUpdate={false}
            castShadow
            receiveShadow
            frustumCulled={false}
            dispose={null}
          />
        )),
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Power lines between pylons
// ---------------------------------------------------------------------------

function buildConductors(pylons: readonly Placement[]): BufferGeometry {
  const sorted = [...pylons].sort((a, b) => a.x - b.x);
  const points: number[] = [];
  const attach = (pylon: Placement, across: number, height: number): Vector3 => {
    const cos = Math.cos(pylon.yaw);
    const sin = Math.sin(pylon.yaw);
    // Local (0, height, -across) rotated by yaw about +Y.
    const lx = 0;
    const lz = -across;
    return new Vector3(
      pylon.x + lx * cos + lz * sin,
      terrain.height(pylon.x, pylon.z) + height,
      pylon.z - lx * sin + lz * cos,
    );
  };
  const segments = 18;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    for (const [across, height] of PYLON_CONDUCTORS) {
      const a = attach(sorted[i]!, across, height);
      const b = attach(sorted[i + 1]!, across, height);
      const sag = a.distanceTo(b) * 0.035;
      let previous = a.clone();
      for (let s = 1; s <= segments; s += 1) {
        const t = s / segments;
        const p = new Vector3().lerpVectors(a, b, t);
        p.y -= sag * 4 * t * (1 - t);
        points.push(previous.x, previous.y, previous.z, p.x, p.y, p.z);
        previous = p;
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function PowerLines({ pylons }: { pylons: readonly Placement[] }) {
  const geometry = useMemo(() => buildConductors(pylons), [pylons]);
  if (pylons.length < 2) return null;
  return (
    <lineSegments geometry={geometry} name="CONTINUA_PowerLines">
      <lineBasicMaterial color="#4A5361" transparent opacity={0.55} depthWrite={false} />
    </lineSegments>
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
        position={[0, 0.12, 0]}
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

/**
 * The planting carries most of the world's triangles and, on a software
 * rasteriser, most of its pixels - every leaf card is shaded before it is
 * clipped. The low tier draws this many in five of each: one tree, two of the
 * scrub and flowering bushes. Placements are ordered keepers-first so the
 * tier only changes how many instances are drawn - never the instanced mesh
 * itself, whose rebuild would release the glTF's shared materials mid-compile.
 */
const THINNED_ON_LOW: ReadonlyMap<string, number> = new Map([
  ['PROP_Ghaf', 1],
  ['PROP_FlameTree', 1],
  ['PROP_Jacaranda', 1],
  ['PROP_Shrub_A', 2],
  ['PROP_Shrub_B', 2],
  ['PROP_FlowerBush_Magenta', 2],
  ['PROP_FlowerBush_Coral', 2],
  ['PROP_FlowerBush_Yellow', 2],
  ['PROP_FlowerBush_White', 2],
]);

function keepersFirst(list: readonly Placement[], keep: number): Placement[] {
  return [...list.filter((_, index) => index % 5 < keep), ...list.filter((_, index) => index % 5 >= keep)];
}

/** How many of `n` placements `keepersFirst` keeps: those with index % 5 < keep. */
function keeperCount(n: number, keep: number): number {
  return Math.floor(n / 5) * keep + Math.min(n % 5, keep);
}

/** Placement lists by prop node name: network sites first, then dressing. */

function allPlacements(): Map<string, Placement[]> {
  const byProp = new Map<string, Placement[]>();
  for (const site of SITES) {
    const list = byProp.get(site.prop) ?? [];
    list.push({ x: site.x, z: site.z, yaw: site.yaw, scale: site.scale });
    byProp.set(site.prop, list);
  }
  for (const [prop, placements] of Object.entries(WORLD_LAYOUT)) {
    const list = byProp.get(prop) ?? [];
    // Seeded scatter can land past the shore; only the wind farm and the
    // jetty stand at sea.
    const afloat = prop === TURBINE.tower || prop === TURBINE.rotor || prop === 'PROP_Jetty';
    const kept = afloat ? [...placements] : placements.filter((item) => terrain.height(item.x, item.z) > SEA_LEVEL + 0.25);
    const keep = THINNED_ON_LOW.get(prop);
    list.push(...(keep ? keepersFirst(kept, keep) : kept));
    byProp.set(prop, list);
  }
  return byProp;
}

/** Small, numerous dressing that is not worth a shadow-map pass. */
const NO_SHADOW = new Set([
  'PROP_Fence', 'PROP_Shrub_A', 'PROP_Shrub_B', 'PROP_Bollard', 'PROP_Skyline_A', 'PROP_Skyline_B', 'PROP_Skyline_C',
  'PROP_FlowerBed',
]);

export function WorldProps({
  showMarkers,
  selectedSiteId,
  onSelectSite,
  lite = false,
}: {
  showMarkers: boolean;
  selectedSiteId: string | null;
  onSelectSite: (id: string) => void;
  /** The low tier: fewer trees. */
  lite?: boolean;
}) {
  const { scene } = useGLTF(PROPS_MODEL_URL);

  const library = useMemo(() => {
    const map = new Map<string, Object3D>();
    for (const child of scene.children) map.set(child.name, child);
    scene.traverse((node) => {
      if (node.name.startsWith('PROP_') && !map.has(node.name)) map.set(node.name, node);
    });
    scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(tuneMaterial);
    });
    return map;
  }, [scene]);

  const placements = useMemo(() => allPlacements(), []);

  // This scene's own copy of the dock's status material: the glTF's is shared
  // through the cache with every other canvas, each on its own clock.
  const status = useMemo(() => {
    let found: MeshStandardMaterial | null = null;
    scene.traverse((node) => {
      if (found || !(node instanceof Mesh)) return;
      const material = node.material;
      if (material instanceof MeshStandardMaterial && material.name === DOCK_STATUS) found = material;
    });
    return found ? (found as MeshStandardMaterial).clone() : null;
  }, [scene]);
  useEffect(() => () => status?.dispose(), [status]);

  const instanced = useMemo(() => {
    const out: { name: string; placements: Placement[]; primitives: Primitive[] }[] = [];
    for (const [name, list] of placements) {
      if (name === TURBINE.rotor) continue;
      const node = library.get(name);
      if (!node) {
        console.warn(`[CONTINUA] prop "${name}" not found in ${PROPS_MODEL_URL}`);
        continue;
      }
      out.push({
        name,
        placements: list,
        primitives: collectPrimitives(node).map((primitive) => withStatus(withRooms(name, primitive), status)),
      });
    }
    return out;
  }, [placements, library, status]);

  return (
    <group name="CONTINUA_World">
      {instanced.map((entry) =>
        entry.primitives.map((primitive, index) => (
          <InstancedPrimitive
            key={`${entry.name}-${index}`}
            primitive={primitive}
            placements={entry.placements}
            castShadow={!NO_SHADOW.has(entry.name)}
            count={lite && THINNED_ON_LOW.has(entry.name) ? keeperCount(entry.placements.length, THINNED_ON_LOW.get(entry.name)!) : undefined}
            lite={lite}
          />
        )),
      )}

      <GroundContact entries={instanced} />
      {status && <DockStatus material={status} />}
      <AmbientTraffic library={library} />
      <Boats library={library} />
      <TurbineRotors library={library} placements={placements.get(TURBINE.tower) ?? []} />
      <PowerLines pylons={placements.get('PROP_Pylon') ?? []} />

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
