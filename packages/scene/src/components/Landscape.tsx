'use client';

/**
 * The land beyond the props: the sea around the island, mountain ranges across
 * the water, and the grass, wildflowers and gravel at the roadside.
 *
 * The sea is one plane at `SEA_LEVEL`. Its colour comes from the depth of the
 * water under each point - the island's own heights, sampled once into a small
 * texture - so it runs from turquoise over the sandy shelf to sapphire offshore,
 * with surf breathing at the waterline. Its waves, like the grass's sway, are a
 * function of the scene clock alone, so a captured frame is still a pure
 * function of time.
 *
 * The ranges are solid bands with real slopes, so the sun models them - lit
 * faces, shaded gullies - and the haze lays aerial perspective over them:
 * green and rocky near, blue-grey far. The south is left open: the sea runs to
 * the horizon there.
 *
 * At the roadside, tufts of grass with wildflowers and scattered gravel fringe
 * the road out of the campus, thickest at the shoulder and thinning into the
 * meadow. All of it is generated once from fixed seeds: the same build is the
 * same world.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DataUtils,
  DoubleSide,
  Float32BufferAttribute,
  HalfFloatType,
  IcosahedronGeometry,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RedFormat,
  ShaderChunk,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { clamp, fbm2, lerp, makeRandom, smoothstep, valueNoise2 } from '../math/noise';
import { useSceneRuntime } from '../runtime/SceneRuntime';
import { SCENE_COLOR } from '../theme';
import { PADS, SERVICE_ROADS } from '../world/layout';
import { ROAD_HALF_WIDTH, ROAD_SURFACE_OFFSET } from '../world/road';
import { route } from '../world/route';
import { SEA_LEVEL, TERRAIN, terrain } from '../world/terrain';
import { patchStandard } from './shaders';

// ---------------------------------------------------------------------------
// Mountain ranges
// ---------------------------------------------------------------------------

interface RangeSpec {
  /** Centre of the ellipse the range's inner edge follows. */
  cx: number;
  cz: number;
  /** Semi-axes of the inner edge, metres. */
  a: number;
  b: number;
  /** How far the band reaches outward from its inner edge. */
  depth: number;
  /** Peak heights toward the east (behind the ground station) and elsewhere. */
  peakEast: number;
  peakElse: number;
  /** The arc the range covers, radians (0 = +X, PI/2 = +Z). */
  from: number;
  to: number;
  seed: number;
  segments: number;
  rows: number;
  foot: string;
  rock: string;
}

/** Across the strait to the north and the water east of the headland. */
const NEAR_RANGE: RangeSpec = {
  cx: 470,
  cz: 20,
  a: 860,
  b: 600,
  depth: 560,
  peakEast: 190,
  peakElse: 130,
  from: -0.55,
  to: 2.45,
  seed: 4242,
  segments: 720,
  rows: 44,
  foot: SCENE_COLOR.mountainFoot,
  rock: SCENE_COLOR.mountainRock,
};

/** The mainland beyond: everywhere but the open sea to the south. */
const FAR_RANGE: RangeSpec = {
  cx: 420,
  cz: 0,
  a: 1330,
  b: 1020,
  depth: 560,
  peakEast: 330,
  peakElse: 260,
  from: -0.75,
  to: 4.05,
  seed: 9191,
  segments: 640,
  rows: 22,
  foot: SCENE_COLOR.mountainFar,
  rock: SCENE_COLOR.mountainFarRock,
};

function buildRange(spec: RangeSpec, detail: number): BufferGeometry {
  const segments = Math.round(spec.segments * detail);
  const rows = Math.max(4, Math.round(spec.rows * detail));
  const span = spec.to - spec.from;
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const foot = new Color(spec.foot);
  const rock = new Color(spec.rock);
  const colour = new Color();

  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const theta = spec.from + u * span;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    // Noise on a circle, so the range has no seam; broad massifs plus sharp
    // ridged peaks, taller to the east, tapering into the plain at both ends.
    const massif = fbm2(cos * 2.1 + 10, sin * 2.1 + 10, 4, spec.seed);
    const crest = 1 - Math.abs(2 * valueNoise2(cos * 8.5 + 3, sin * 8.5 + 7, spec.seed + 5) - 1);
    const east = smoothstep(-0.25, 0.85, cos);
    const taper = smoothstep(0, 0.1, u) * smoothstep(0, 0.1, 1 - u);
    const peak = lerp(spec.peakElse, spec.peakEast, east);
    const crestHeight = peak * taper * clamp(0.42 + 0.5 * massif + 0.38 * crest * crest, 0.06, 1.25);

    for (let j = 0; j <= rows; j += 1) {
      const t = j / rows;
      const reach = t * spec.depth;
      const x = spec.cx + (spec.a + reach) * cos;
      const z = spec.cz + (spec.b + reach) * sin;
      // Steep toward the viewer, a long fall behind. Spurs and gullies are
      // shaped in world space, so they run down the faces, not around them.
      const rise = smoothstep(0, 0.55, t);
      const fall = 1 - 0.5 * smoothstep(0.62, 1, t);
      const spur = 1 - Math.abs(2 * valueNoise2(x * 0.011, z * 0.011, spec.seed + 9) - 1);
      const rough = fbm2(x * 0.032, z * 0.032, 3, spec.seed + 17);
      const relief = 0.7 + 0.42 * spur * spur + 0.1 * rough;
      const y = -8 + crestHeight * rise * fall * relief;
      positions.push(x, y, z);

      const height = clamp((y + 8) / Math.max(peak, 1), 0, 1);
      // Woods in clumps on the lower slopes, bare rock up the spurs and crests.
      const clump = valueNoise2(x * 0.05, z * 0.05, spec.seed + 13);
      const rockiness = smoothstep(0.34, 0.78, height + 0.22 * (spur - 0.5) + 0.08 * rough);
      colour.copy(foot).multiplyScalar(0.82 + 0.3 * clump).lerp(rock, rockiness);
      colours.push(colour.r, colour.g, colour.b);
    }
  }
  const stride = rows + 1;
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const a = i * stride + j;
      const b = a + stride;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function Mountains({ quality }: { quality: 'high' | 'balanced' | 'low' }) {
  // Half the mesh on the low tier: at that distance the silhouette carries it.
  const detail = quality === 'low' ? 0.5 : 1;
  const near = useMemo(() => buildRange(NEAR_RANGE, detail), [detail]);
  const far = useMemo(() => buildRange(FAR_RANGE, detail), [detail]);
  const material = useMemo(
    () => new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: DoubleSide }),
    [],
  );
  // Separate lifetimes: a change of tier replaces the meshes, never the
  // material still drawing them.
  useEffect(
    () => () => {
      near.dispose();
      far.dispose();
    },
    [near, far],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <group name="CONTINUA_Mountains">
      <mesh geometry={far} material={material} />
      <mesh geometry={near} material={material} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// The sea
// ---------------------------------------------------------------------------

const DEPTH_SAMPLES_X = 256;
const DEPTH_SAMPLES_Z = 128;

/** The island's height above the water, sampled once over the modelled ground. */
function buildShoreTexture(): DataTexture {
  const { minX, maxX, minZ, maxZ } = TERRAIN;
  const data = new Uint16Array(DEPTH_SAMPLES_X * DEPTH_SAMPLES_Z);
  for (let iz = 0; iz < DEPTH_SAMPLES_Z; iz += 1) {
    const z = minZ + ((maxZ - minZ) * iz) / (DEPTH_SAMPLES_Z - 1);
    for (let ix = 0; ix < DEPTH_SAMPLES_X; ix += 1) {
      const x = minX + ((maxX - minX) * ix) / (DEPTH_SAMPLES_X - 1);
      data[iz * DEPTH_SAMPLES_X + ix] = DataUtils.toHalfFloat(terrain.height(x, z) - SEA_LEVEL);
    }
  }
  const texture = new DataTexture(data, DEPTH_SAMPLES_X, DEPTH_SAMPLES_Z, RedFormat, HalfFloatType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function seaMaterial(shore: DataTexture, time: { value: number }, lite: boolean): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.07,
    metalness: 0,
    transparent: true,
    depthWrite: false,
  });
  material.envMapIntensity = 1.1;
  const { minX, maxX, minZ, maxZ } = TERRAIN;
  return patchStandard(material, {
    key: 'continua-sea-v3',
    lite,
    uniforms: {
      uShore: { value: shore },
      uShoreRect: { value: [minX, maxX, minZ, maxZ] },
      uShoreTexels: { value: [DEPTH_SAMPLES_X, DEPTH_SAMPLES_Z] },
      uShallow: { value: new Color(SCENE_COLOR.seaShallow) },
      uMid: { value: new Color(SCENE_COLOR.seaMid) },
      uDeep: { value: new Color(SCENE_COLOR.seaDeep) },
      uTime: time,
    },
    header: /* glsl */ `
      // Water depth under a point: the island's sampled height, and beyond
      // the modelled ground the depth at its edge, shelving away - so the
      // colour carries on across the boundary without a seam.
      float ctDepth(vec2 p) {
        vec4 r = uShoreRect;
        vec2 t = (p - r.xz) / vec2(r.y - r.x, r.w - r.z);
        vec2 inside = clamp(t, 0.0, 1.0);
        vec2 uv = (inside * (uShoreTexels - 1.0) + 0.5) / uShoreTexels;
        float depth = -texture2D(uShore, uv).r;
        float beyond = length((t - inside) * vec2(r.y - r.x, r.w - r.z));
        return depth + 0.02 * beyond;
      }
      float ctWaves(vec2 p, float t) {
        #ifdef CT_LITE
          return ctNoise(p * 0.12 + vec2(t * 0.06, t * 0.04));
        #else
          return ctNoise(p * 0.09 + vec2(t * 0.045, t * 0.028)) * 0.55
               + ctNoise(p * 0.31 - vec2(t * 0.10, -t * 0.06)) * 0.3
               + ctNoise(p * 1.15 + vec2(t * 0.27, t * 0.19)) * 0.15;
        #endif
      }
    `,
    colour: /* glsl */ `
      vec2 p = vCtWorld.xz;
      float depth = ctDepth(p);
      // Turquoise over the sandy shelf, sapphire offshore.
      vec3 water = mix(uDeep, uMid, smoothstep(16.0, 5.0, depth));
      water = mix(water, uShallow, smoothstep(3.2, 0.4, depth));
      // Surf: a band at the waterline that swells and ebbs.
      float swell = 0.5 + 0.5 * sin(uTime * 0.9 - depth * 3.2 + ctNoise(p * 0.04) * 6.0);
      float lace = ctNoise(p * 0.8 + vec2(uTime * 0.15, -uTime * 0.11));
      float foam = (1.0 - smoothstep(0.0, 0.5 + 0.35 * swell, depth)) * smoothstep(0.25, 0.7, lace + 0.35 * swell);
      foam += (1.0 - smoothstep(0.0, 0.12, depth)) * 0.6;
      foam = clamp(foam, 0.0, 1.0);
      #ifndef CT_LITE
        float cloudShade = smoothstep(0.5, 0.74, ctFbm2(p * 0.0055 + vec2(uTime * 0.03, uTime * 0.011)));
        water *= 1.0 - 0.1 * cloudShade;
      #endif
      diffuseColor.rgb = mix(water, vec3(1.0), foam * 0.88);
      // The sand shows through the shallows; deep water is opaque.
      diffuseColor.a = clamp(mix(0.5, 0.97, smoothstep(0.2, 6.0, depth)) + foam * 0.45, 0.0, 1.0);
    `,
    roughness: /* glsl */ `
      roughnessFactor = mix(roughnessFactor, 0.6, foam);
    `,
    normal: /* glsl */ `
      {
        vec2 p = vCtWorld.xz;
        float fade = 1.0 - smoothstep(60.0, 1100.0, vCtDist);
        normal = ctBump(-vViewPosition, normal, ctWaves(p, uTime) * fade, 0.55);
      }
    `,
  });
}

export function Sea({ quality }: { quality: 'high' | 'balanced' | 'low' }) {
  const { clock } = useSceneRuntime();
  const lite = quality === 'low';
  const parts = useMemo(() => {
    const time = { value: 0 };
    const shore = buildShoreTexture();
    const geometry = new PlaneGeometry(9000, 9000, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(400, SEA_LEVEL, 0);
    return { time, shore, geometry, material: seaMaterial(shore, time, lite) };
  }, [lite]);
  useEffect(
    () => () => {
      parts.shore.dispose();
      parts.geometry.dispose();
      parts.material.dispose();
    },
    [parts],
  );
  useFrame(() => {
    parts.time.value = clock.time;
  });
  return (
    <mesh name="CONTINUA_Sea" geometry={parts.geometry} material={parts.material} receiveShadow renderOrder={1} />
  );
}

// ---------------------------------------------------------------------------
// Roadside grass and gravel
// ---------------------------------------------------------------------------

/** Where the open road begins: past the campus gate, the meadow reaches the road. */
const OPEN_ROAD_FROM_X = 236;

function nearServiceRoad(x: number, z: number, margin: number): boolean {
  for (const road of SERVICE_ROADS) {
    for (let i = 0; i < road.points.length - 1; i += 1) {
      const [x0, z0] = road.points[i]!;
      const [x1, z1] = road.points[i + 1]!;
      const dx = x1 - x0;
      const dz = z1 - z0;
      const t = clamp(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz), 0, 1);
      if (Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t)) < road.halfWidth + margin) return true;
    }
  }
  return false;
}

function onPad(x: number, z: number, grow: number): boolean {
  return PADS.some((pad) => Math.abs(x - pad.x) < pad.hx + grow && Math.abs(z - pad.z) < pad.hz + grow);
}

interface Spot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** 0..1, for colour variation. */
  tone: number;
}

/**
 * Seeded scatter along the open road: `perMetre` candidates per metre of
 * route, each thrown sideways by an exponential distance from `from` metres
 * outside the carriageway edge - thick at the shoulder, thinning outward.
 */
function scatter(seed: number, perMetre: number, from: number, spread: number, maxReach: number, scaleRange: [number, number]): Spot[] {
  const random = makeRandom(seed);
  const out: Spot[] = [];
  const edge = ROAD_HALF_WIDTH;
  for (const sample of route.samples) {
    if (sample.x < OPEN_ROAD_FROM_X) continue;
    // Patchy, not uniform: some stretches are bare, some thick.
    const patch = 0.35 + 0.9 * valueNoise2(sample.distance * 0.045, 0.5, seed);
    const count = perMetre * patch;
    let n = Math.floor(count);
    if (random() < count - n) n += 1;
    for (let k = 0; k < n; k += 1) {
      const side = random() < 0.5 ? -1 : 1;
      const reach = Math.min(maxReach, from - spread * Math.log(1 - random() * 0.999));
      const lateral = side * (edge + reach);
      const along = (random() - 0.5) * 1.6;
      const x = sample.x - sample.tz * lateral + sample.tx * along;
      const z = sample.z + sample.tx * lateral + sample.tz * along;
      // Keep off the carriageway where the road bends back near itself, off
      // the pads and off the service roads.
      if (Math.sqrt(route.distanceToRouteSq(x, z).distSq) < edge + from * 0.8) continue;
      if (onPad(x, z, 2) || nearServiceRoad(x, z, 1.2)) continue;
      const onShoulder = reach < 1.6;
      out.push({
        x,
        z,
        y: terrain.height(x, z) + (onShoulder ? ROAD_SURFACE_OFFSET - 0.03 : 0),
        yaw: random() * Math.PI * 2,
        scale: lerp(scaleRange[0], scaleRange[1], random()),
        tone: random(),
      });
    }
  }
  return out;
}

/**
 * One tuft: blades fanning out from a tight base, bent, tapering to a point -
 * and, given a colour, three flower stems standing out of it.
 */
function buildTuftGeometry(blossom?: Color): BufferGeometry {
  const random = makeRandom(blossom ? 91 : 77);
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const base = new Color('#3E6B2B');
  const tip = new Color('#A3CB5E');
  const blades = 11;
  const normal = new Vector3();
  const vertex = (point: readonly number[], colour: Color) => {
    positions.push(point[0]!, point[1]!, point[2]!);
    normals.push(normal.x, normal.y, normal.z);
    colours.push(colour.r, colour.g, colour.b);
  };
  const shade = (v: number) => base.clone().lerp(tip, v);

  for (let i = 0; i < blades; i += 1) {
    const angle = (i / blades) * Math.PI * 2 + random() * 0.5;
    const lean = 0.25 + random() * 0.55;
    const height = 0.32 + random() * 0.26;
    const width = 0.022 + random() * 0.012;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    // Blade frame: outward direction, sideways across the blade.
    const sideX = -dirZ * width;
    const sideZ = dirX * width;
    const root = [dirX * 0.03, 0, dirZ * 0.03] as const;
    const mid = [root[0] + dirX * lean * height * 0.35, height * 0.55, root[2] + dirZ * lean * height * 0.35] as const;
    const end = [root[0] + dirX * lean * height, height * (0.92 - lean * 0.25), root[2] + dirZ * lean * height] as const;
    const quad = [
      [root[0] - sideX, root[1], root[2] - sideZ],
      [root[0] + sideX, root[1], root[2] + sideZ],
      [mid[0] - sideX * 0.7, mid[1], mid[2] - sideZ * 0.7],
      [mid[0] + sideX * 0.7, mid[1], mid[2] + sideZ * 0.7],
    ];
    // Normals lean up and out, the same on both faces: a tuft is lit like the
    // ground it grows from, with a little form, not like a fan of mirrors.
    normal.set(dirX * 0.4, 1, dirZ * 0.4).normalize();
    // Lower section (two triangles), upper section (one triangle to the tip).
    for (const index of [0, 1, 2, 2, 1, 3]) vertex(quad[index]!, shade(index < 2 ? 0 : 0.55));
    vertex(quad[2]!, shade(0.55));
    vertex(quad[3]!, shade(0.55));
    vertex(end, shade(1));
  }

  if (blossom) {
    const stem = new Color('#5C8A3A');
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2 + random() * 1.2;
      const reach = 0.04 + random() * 0.08;
      const height = 0.36 + random() * 0.2;
      const top = [Math.cos(angle) * reach, height, Math.sin(angle) * reach] as const;
      const w = 0.006;
      normal.set(0, 1, 0);
      // A thin stem...
      const a = [-w, 0, 0];
      const b = [w, 0, 0];
      const c = [top[0] - w, top[1], top[2]];
      const d = [top[0] + w, top[1], top[2]];
      for (const point of [a, b, c, c, b, d]) vertex(point, stem);
      // ...and a bloom on it: a flattened octahedron, lit from above.
      const r = 0.036 + random() * 0.014;
      const flat = 0.55;
      const ring = [0, 1, 2, 3].map((k) => {
        const phi = (k / 4) * Math.PI * 2 + angle;
        return [top[0] + Math.cos(phi) * r, top[1], top[2] + Math.sin(phi) * r];
      });
      const up = [top[0], top[1] + r * flat, top[2]];
      const down = [top[0], top[1] - r * flat, top[2]];
      for (let k = 0; k < 4; k += 1) {
        const p0 = ring[k]!;
        const p1 = ring[(k + 1) % 4]!;
        for (const point of [p0, p1, up, p1, p0, down]) vertex(point, blossom);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  return geometry;
}

/** Grass that bends in the wind, as a function of the scene clock alone. */
function grassMaterial(): MeshStandardMaterial & { userData: { time: { value: number } } } {
  const time = { value: 0 };
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: DoubleSide,
  }) as MeshStandardMaterial & { userData: { time: { value: number } } };
  material.userData.time = time;
  material.customProgramCacheKey = () => 'continua-grass-v2';
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = time;
    // Both faces use the authored, upward normal.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
    );
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vec2 ctRoot = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
         #else
           vec2 ctRoot = vec2(0.0);
         #endif
         float ctBend = transformed.y * transformed.y * 2.2;
         float ctGust = sin(uTime * 1.3 + ctRoot.x * 0.11 + ctRoot.y * 0.07) * 0.6
                      + sin(uTime * 2.9 + ctRoot.x * 0.37 - ctRoot.y * 0.21) * 0.4;
         transformed.x += ctGust * ctBend * 0.11;
         transformed.z += ctGust * ctBend * 0.05;`,
      );
  };
  return material;
}

/** Multipliers on the blades' own colour: fresh, sunlit, a little bleached. */
const GRASS_TONES = ['#FFFFFF', '#F2F7E6', '#E6F0D8', '#FFFBEA', '#EDEBD2'].map((hex) => new Color(hex));
/** Wildflowers: buttercup, daisy, clover, campion. */
const BLOOM_COLOURS = ['#F5C531', '#F8F6F0', '#B276E6', '#F27C98'].map((hex) => new Color(hex));
const GRAVEL_TONES = ['#A9A59C', '#918F88', '#7C7B76', '#B9B2A2', '#8F8678'].map((hex) => new Color(hex));

function fillInstances(
  mesh: InstancedMesh,
  spots: readonly Spot[],
  tones: readonly Color[],
  squash: number,
  sink: number,
): void {
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const position = new Vector3();
  const scale = new Vector3();
  const colour = new Color();
  spots.forEach((spot, index) => {
    rotation.setFromAxisAngle(up, spot.yaw);
    position.set(spot.x, spot.y - spot.scale * squash * sink, spot.z);
    scale.set(spot.scale, spot.scale * squash, spot.scale * (0.8 + spot.tone * 0.4));
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
    const toneIndex = Math.floor(spot.tone * tones.length) % tones.length;
    colour.copy(tones[toneIndex]!).multiplyScalar(0.94 + 0.12 * ((spot.tone * 7.3) % 1));
    mesh.setColorAt(index, colour);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

export function RoadsideScatter({ quality }: { quality: 'high' | 'balanced' | 'low' }) {
  const { clock } = useSceneRuntime();
  const density = quality === 'high' ? 1 : 0.6;

  const grass = useMemo(() => {
    const spots = [
      ...scatter(311, 3.4 * density, 0.4, 5.5, 45, [0.75, 1.35]),
      ...scatter(312, 0.8 * density, 6, 28, 140, [0.8, 1.5]),
    ];
    // A third of the tufts flower, in four colours.
    const plain = spots.filter((spot) => spot.tone >= 0.34);
    const flowering = BLOOM_COLOURS.map((_, index) =>
      spots.filter((spot) => spot.tone < 0.34 && Math.floor((spot.tone / 0.34) * BLOOM_COLOURS.length) === index),
    );
    const material = grassMaterial();
    const make = (geometry: BufferGeometry, list: Spot[], name: string) => {
      const mesh = new InstancedMesh(geometry, material, Math.max(1, list.length));
      mesh.name = name;
      mesh.receiveShadow = true;
      mesh.count = list.length;
      fillInstances(mesh, list, GRASS_TONES, 1, 0);
      return mesh;
    };
    const meshes = [
      make(buildTuftGeometry(), plain, 'CONTINUA_RoadsideGrass'),
      ...BLOOM_COLOURS.map((colour, index) =>
        make(buildTuftGeometry(colour), flowering[index]!, `CONTINUA_Wildflowers_${index}`),
      ),
    ];
    return { meshes, material };
  }, [density]);

  const gravel = useMemo(() => {
    const spots = [
      ...scatter(421, 4.5 * density, 0, 2.2, 14, [0.05, 0.16]),
      ...scatter(422, 0.9 * density, 2, 12, 60, [0.08, 0.32]),
    ];
    const geometry = new IcosahedronGeometry(1, 0);
    const material = new MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true });
    const mesh = new InstancedMesh(geometry, material, spots.length);
    mesh.name = 'CONTINUA_RoadsideGravel';
    mesh.receiveShadow = true;
    fillInstances(mesh, spots, GRAVEL_TONES, 0.55, 0.35);
    return { mesh, material };
  }, [density]);

  useEffect(
    () => () => {
      for (const mesh of [...grass.meshes, gravel.mesh]) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
      grass.material.dispose();
      gravel.material.dispose();
    },
    [grass, gravel],
  );

  useFrame(() => {
    grass.material.userData.time.value = clock.time;
  });

  return (
    <group name="CONTINUA_Roadside">
      {grass.meshes.map((mesh) => (
        <primitive key={mesh.name} object={mesh} />
      ))}
      <primitive object={gravel.mesh} />
    </group>
  );
}
