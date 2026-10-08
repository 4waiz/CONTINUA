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
  Group,
  HalfFloatType,
  IcosahedronGeometry,
  InstancedMesh,
  LinearFilter,
  MeshLambertMaterial,
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
import { inlandDistance, SEA_LEVEL, TERRAIN, terrain } from '../world/terrain';
import { onForecourt } from '../world/terminus';
import { onTunnelWorks } from '../world/tunnel';
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
  /** Period of the erosion flutes along the foot, metres (two ribs to a period). */
  flute: number;
  /** Spur ridges running down from the crest, per radian of arc. */
  spurs: number;
  /** How far the great spurs reach out from the foot toward the island, metres. */
  spurReach: number;
  /** Forest, forest in shade, sunlit crests, bare rock. */
  lush: string;
  shade: string;
  crest: string;
  rock: string;
}

/** Across the strait to the north and the water east of the headland. */
const NEAR_RANGE: RangeSpec = {
  cx: 470,
  cz: 20,
  a: 860,
  b: 600,
  depth: 560,
  peakEast: 215,
  peakElse: 150,
  from: -0.55,
  to: 2.45,
  seed: 4242,
  segments: 1500,
  rows: 64,
  flute: 60,
  spurs: 3.2,
  spurReach: 130,
  lush: SCENE_COLOR.mountainLush,
  shade: SCENE_COLOR.mountainShade,
  crest: SCENE_COLOR.mountainCrest,
  rock: SCENE_COLOR.mountainRock,
};

/** The mainland beyond: everywhere but the open sea to the south. */
const FAR_RANGE: RangeSpec = {
  cx: 420,
  cz: 0,
  a: 1330,
  b: 1020,
  depth: 560,
  peakEast: 360,
  peakElse: 280,
  from: -0.75,
  to: 4.05,
  seed: 9191,
  segments: 1000,
  rows: 30,
  flute: 90,
  spurs: 2.4,
  spurReach: 190,
  lush: SCENE_COLOR.mountainFar,
  shade: SCENE_COLOR.mountainFarShade,
  crest: SCENE_COLOR.mountainFarCrest,
  rock: SCENE_COLOR.mountainFarRock,
};

/** Ridged value noise: 1 along the crest lines of the noise, 0 in its folds. */
function ridged(x: number, y: number, seed: number): number {
  return 1 - Math.abs(2 * valueNoise2(x, y, seed) - 1);
}

/** Open water kept between a range's foot and the island's shore, metres. */
const STRAIT_CLEARANCE = 110;

/**
 * How far the spur at this point of the arc may reach out toward the island:
 * up to `wanted`, and no further than the open water at its foot allows (a
 * metre of reach closes about a metre of it). A smooth minimum, so the reach
 * never steps from one column of the mesh to the next - stepped back in 5 m
 * notches it creased the faces from foot to crest at every notch.
 */
function spurClearance(spec: RangeSpec, cos: number, sin: number, wanted: number): number {
  const room = Math.max(0, -inlandDistance(spec.cx + spec.a * cos, spec.cz + spec.b * sin) - STRAIT_CLEARANCE);
  const k = 12;
  return Math.max(0, -k * Math.log(Math.exp(-wanted / k) + Math.exp(-room / k)));
}

/**
 * A range as a band of ground around the island: lush, steep island
 * mountains - broad massifs with sharp summits, great spurs reaching out
 * toward the island with valleys cut back between them, and the faces fluted
 * by erosion into gullies down the fall line that wander, branch and fade.
 * Forest everywhere it can hold, darker in the gullies, catching the light on
 * the ribs between them, bare rock where the faces are too steep.
 */
function buildRange(spec: RangeSpec, detail: number): BufferGeometry {
  const segments = Math.round(spec.segments * detail);
  const rows = Math.max(8, Math.round(spec.rows * detail));
  const span = spec.to - spec.from;
  const stride = rows + 1;
  const count = (segments + 1) * stride;
  const positions = new Float32Array(count * 3);
  const fluting = new Float32Array(count);
  const valleys = new Float32Array(count);
  const faces = new Float32Array(count);
  // The foot's length, for flutes a fixed distance apart along it.
  const footLength = span * 0.5 * (spec.a + spec.b);
  const fluteCount = footLength / spec.flute;

  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const theta = spec.from + u * span;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    // The crest along the arc - noise on a circle, so the range has no seam:
    // broad massifs and the summits on them, taller to the east, tapering
    // into the plain at both ends.
    const massif = 0.5 + 0.5 * fbm2(cos * 1.7 + 10, sin * 1.7 + 10, 4, spec.seed);
    // Summits are broad shoulders above the massif, never needles.
    const summit = ridged(cos * 3.2 + 3, sin * 3.2 + 7, spec.seed + 5);
    const east = smoothstep(-0.25, 0.85, cos);
    const taper = smoothstep(0, 0.07, u) * smoothstep(0, 0.07, 1 - u);
    const peak = lerp(spec.peakElse, spec.peakEast, east);
    const crest = peak * taper * clamp(0.24 + 0.7 * massif + 0.22 * summit * summit, 0.05, 1.2);
    // Some faces are fluted cliffs, others smooth forested slopes.
    const fluteAmount = smoothstep(-0.15, 0.55, fbm2(u * 11 + 4, 2.3, 3, spec.seed + 27));
    // Where the crest stands across the band wanders, so the front is never a wall.
    const crestAt = 0.27 + 0.13 * (0.5 + 0.5 * fbm2(u * 8 + 2, 1.7, 2, spec.seed + 21));
    // The great spurs, every second or third of them: their feet reach out toward
    // the island, so from the shore they stand in front of one another and of
    // the valleys cut back between them - the range is never one face.
    const spurLine = ridged(
      u * span * spec.spurs * 0.42 + 0.35 * fbm2(u * 7, 4.4, 2, spec.seed + 33),
      1.5,
      spec.seed + 43,
    );
    const reachOut = spurClearance(spec, cos, sin, spec.spurReach * smoothstep(0.3, 0.95, spurLine) * taper);
    // The flutes' spacing drifts along the range, never a regular pleat.
    const fluteDrift = 2.6 * fbm2(u * span * 3.1, 7.7, 2, spec.seed + 57);

    for (let j = 0; j <= rows; j += 1) {
      // Rows crowd toward the front, where the faces are.
      const t = Math.pow(j / rows, 1.45);
      // The spur's foot is pulled out toward the island and its ridge eases
      // back up to the crest; behind the crest the band is as it was.
      const reach = t * spec.depth - reachOut * (1 - smoothstep(0, crestAt * 1.1, t));
      const x = spec.cx + (spec.a + reach) * cos;
      const z = spec.cz + (spec.b + reach) * sin;

      // A steep front up to the crest, a longer fall behind it.
      const front = smoothstep(0, crestAt, t);
      const back = 1 - 0.5 * smoothstep(crestAt + 0.12, 1, t);
      let h = crest * Math.pow(front, 0.85) * back;
      // Foothills: forested shoulders at the foot of the cliffs, so the faces
      // stand on ground rather than rising straight off the water - long under
      // the spurs, low in the valleys, never one level terrace along the range.
      const shoulder = valueNoise2(u * span * 9, 0.5, spec.seed + 23);
      const spurAt = ridged(u * span * spec.spurs + 0.45 * fbm2(u * 26, 0.2, 2, spec.seed + 31), 0.5, spec.seed + 41);
      const footHeight = crest * (0.05 + 0.32 * spurAt * spurAt * (0.4 + 0.6 * shoulder));
      h = Math.max(h, footHeight * smoothstep(0, 0.7, t / crestAt) * (1 - smoothstep(0.75, 1.25, t / crestAt)));

      // Spurs from the crest down to the shore; valleys between them, cut
      // deepest low on the face where they open out.
      const meander = 0.45 * fbm2(u * 26, t * 2.6, 2, spec.seed + 31);
      const spur = ridged(u * span * spec.spurs + meander, 0.5, spec.seed + 41);
      const valley = Math.pow(1 - spur, 1.5);
      const low = 1 - 0.55 * front;
      h *= 1 - 0.4 * valley * low * smoothstep(0, 0.12, t);

      // Erosion flutes on the faces: ribs and gullies down the fall line,
      // which wander, branch and end on the way down rather than hanging from
      // the crest like the folds of a curtain. Each reaches its own way down:
      // some only notch the crest, some run nearly to the foot.
      const reachDown = 0.3 + 0.65 * valueNoise2(u * fluteCount * 0.5 + fluteDrift, 3.3, spec.seed + 63);
      const face =
        smoothstep(0.88 - reachDown, 1.12 - reachDown, front) * (1 - smoothstep(crestAt * 0.85, crestAt * 1.5, t));
      const wander = 0.9 * fbm2(u * 70, t * 5, 2, spec.seed + 51);
      const rib = Math.pow(ridged(u * fluteCount + fluteDrift + wander, t * 2.2, spec.seed + 61), 1.4);
      const fine = ridged(u * fluteCount * 1.9 + 5 + fluteDrift + wander, t * 3.4, spec.seed + 71);
      const fluted = 0.8 * rib + 0.2 * fine;
      // Cut to a depth set by their spacing, not the mountain's height: cut
      // in proportion to a 200 m face they were slots, each a dark stripe.
      h = Math.max(0, h - spec.flute * 0.2 * (1 - fluted) * face * fluteAmount);
      // Knolls and hollows across the faces, tens of metres apart: forested
      // slopes are lumpy, and a smooth cone read as a green blanket.
      if (h > 0) {
        const knoll = valueNoise2(x * 0.022, z * 0.022, spec.seed + 101) - 0.5;
        const hummock = valueNoise2(x * 0.061, z * 0.061, spec.seed + 103) - 0.5;
        h += (knoll * 2 * Math.min(16, crest * 0.07) + hummock * 2 * Math.min(5, crest * 0.022)) * smoothstep(0.02, 0.25, t);
        h = Math.max(0, h);
      }

      const index = i * stride + j;
      positions[index * 3] = x;
      positions[index * 3 + 1] = -8 + h;
      positions[index * 3 + 2] = z;
      fluting[index] = lerp(0.6, fluted, fluteAmount);
      valleys[index] = valley;
      faces[index] = face;
    }
  }

  // Wound so the side facing the island is the front, with normals pointing
  // up out of the ground. Wound the other way the ranges still drew - the
  // material is double-sided - but the ambient-occlusion pass draws front
  // faces only, so it saw through the faces to the undersides of the slopes
  // behind them and hung a pale veil over the lower half of every range.
  const indices: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const a = i * stride + j;
      const b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // Colour from the shape: forest, shaded deep in the gullies and valleys, lit
  // on the ribs and crests, giving way to rock where the ground is too steep to
  // hold it. Rock is also kept as its own channel, so the surface shader can
  // draw strata on it and keep the forest's crowns off it.
  const normals = geometry.getAttribute('normal');
  const colours = new Float32Array(count * 3);
  const rockiness = new Float32Array(count);
  const lush = new Color(spec.lush);
  const shade = new Color(spec.shade);
  const crestTone = new Color(spec.crest);
  const rock = new Color(spec.rock);
  const colour = new Color();
  let top = 1;
  for (let index = 0; index < count; index += 1) top = Math.max(top, positions[index * 3 + 1]!);
  for (let index = 0; index < count; index += 1) {
    const x = positions[index * 3]!;
    const y = positions[index * 3 + 1]!;
    const z = positions[index * 3 + 2]!;
    const slope = 1 - Math.abs(normals.getY(index));
    const patch = valueNoise2(x * 0.018, z * 0.018, spec.seed + 81);
    colour.copy(lush).multiplyScalar(0.86 + 0.28 * patch);
    // Gullies and valley floors hold shade the sun never reaches.
    colour.lerp(shade, clamp((1 - fluting[index]!) * 0.62 * faces[index]! + valleys[index]! * 0.58, 0, 0.9));
    // Ribs and the high ground catch it.
    const high = smoothstep(0.35, 0.95, y / top);
    colour.lerp(crestTone, clamp(fluting[index]! * fluting[index]! * 0.34 * faces[index]! + high * 0.22, 0, 0.6));
    const scar = valueNoise2(x * 0.03, z * 0.03, spec.seed + 91);
    const bare = smoothstep(0.46, 0.7, slope + 0.24 * (scar - 0.5) + 0.08 * high);
    colour.lerp(rock, bare);
    rockiness[index] = bare;
    colours[index * 3] = colour.r;
    colours[index * 3 + 1] = colour.g;
    colours[index * 3 + 2] = colour.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.setAttribute('aRock', new Float32BufferAttribute(rockiness, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The ranges' surface up close: forest canopy. Cellular noise gives each tree
 * a rounded crown, lit on top, with dark gaps between crowns and a little
 * variety of green from tree to tree; on steep faces the crowns are laid out
 * across the slope instead of being stretched down it. It fades into the
 * vertex colours with distance, where the haze takes over. (The low tier
 * draws the vertex colours alone, with Lambert shading - see `Mountains`.)
 */
function mountainMaterial(time: { value: number }): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: DoubleSide });
  return patchStandard(material, {
    key: 'continua-mountains-v6',
    uniforms: { uTime: time },
    vertexHeader: /* glsl */ `
      attribute float aRock;
      varying float vCtRock;
    `,
    vertex: /* glsl */ `
      vCtRock = aRock;
    `,
    header: /* glsl */ `
      varying float vCtRock;
      // Stands of forest: patches a few hundred metres across of a yellower or
      // a bluer green, and clumps within them - what forest looks like from
      // across water, where single crowns are far below a pixel.
      vec3 ctStands(vec3 world) {
        float stand = ctFbm2(world.xz * 0.0065 + vec2(world.y * 0.004, 7.0));
        float clump = ctFbm2(world.xz * 0.034 + vec2(3.0, world.y * 0.02));
        vec3 tint = mix(vec3(0.84, 0.95, 0.9), vec3(1.14, 1.09, 0.84), smoothstep(0.32, 0.72, stand));
        return tint * (0.84 + 0.3 * clump);
      }
      // Bedded rock: bands that wander along the face.
      float ctStrata(vec3 world) {
        return 0.5 + 0.5 * sin(world.y * 0.62 + ctNoise(world.xz * 0.018) * 7.0);
      }
      // Crowns about nine metres across.
      #define CT_CROWN 0.11
      // How many pixels one crown spans here: the texture fades out before
      // crowns shrink to a few pixels, where they would only shimmer.
      float ctCrownPixels() {
        return 1.0 / max(length(fwidth(vCtWorld)) * CT_CROWN, 1e-4);
      }
      // Worley noise: x = 1 at a crown's centre falling to 0 at its edge,
      // y = a per-crown random value.
      vec2 ctCrowns(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float best = 8.0;
        float id = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 cell = i + g;
            vec2 r = g + vec2(ctHash(cell), ctHash(cell + 17.3)) * 0.98 - f;
            float d = dot(r, r);
            if (d < best) {
              best = d;
              id = ctHash(cell + 41.7);
            }
          }
        }
        return vec2(clamp(1.0 - sqrt(best) * 1.15, 0.0, 1.0), id);
      }
      // Crowns on the ground plane where it is gentle, across the slope where
      // steep - two sizes of tree, the larger standing over the smaller, so the
      // canopy never settles into a lattice.
      vec2 ctLayer(vec2 p) {
        vec2 big = ctCrowns(p);
        vec2 small = ctCrowns(p * 1.63 + 7.9);
        return small.x * 0.92 > big.x ? vec2(small.x * 0.92, small.y) : big;
      }
      vec2 ctCanopy(vec3 world, vec3 n) {
        vec2 level = ctLayer(world.xz * CT_CROWN);
        vec2 across = normalize(vec2(-n.z, n.x) + 1e-4);
        vec2 steep = ctLayer(vec2(dot(world.xz, across), world.y * 1.15) * CT_CROWN);
        return mix(steep, level, smoothstep(0.55, 0.85, n.y));
      }
    `,
    colour: /* glsl */ `
      #ifndef CT_LITE
        vec3 ctN = normalize(inverseTransformDirection(vNormal, viewMatrix));
        float ctNear = smoothstep(4.0, 10.0, ctCrownPixels());
        float ctForested = 1.0 - smoothstep(0.25, 0.75, vCtRock);
        vec2 ctTree = ctCanopy(vCtWorld, ctN);
        float ctClumps = ctNoise(vCtWorld.xz * 0.035 + 3.0);
        // Stands of forest at every distance; single crowns where they resolve.
        diffuseColor.rgb *= mix(vec3(1.0), ctStands(vCtWorld), ctForested);
        // Lit crowns, dark gaps, and tree-to-tree variety: yellower, bluer.
        vec3 ctTint = mix(vec3(1.06, 1.04, 0.86), vec3(0.88, 0.98, 1.02), ctTree.y);
        vec3 ctForest = ctTint * (0.62 + 0.46 * pow(ctTree.x, 0.55)) * (0.82 + 0.3 * ctTree.y) * (0.9 + 0.2 * ctClumps);
        diffuseColor.rgb *= mix(vec3(1.0), ctForest, ctNear * ctForested);
        // Bare rock in beds, lighter and darker, flecked close up.
        float ctBed = ctStrata(vCtWorld);
        diffuseColor.rgb *= mix(1.0, 0.8 + 0.34 * ctBed + 0.08 * ctNoise(vCtWorld.xz * 0.4 + vCtWorld.y), vCtRock);
        // The same cloud shadows that drift over the island, a function of
        // the scene clock alone.
        float ctCloud = smoothstep(0.5, 0.74, ctFbm2(vCtWorld.xz * 0.0055 + vec2(uTime * 0.03, uTime * 0.011)));
        diffuseColor.rgb *= 1.0 - 0.22 * ctCloud;
      #endif
    `,
    normal: /* glsl */ `
      #ifndef CT_LITE
        {
          vec3 ctN = normalize(inverseTransformDirection(vNormal, viewMatrix));
          float ctNear = smoothstep(7.0, 18.0, ctCrownPixels());
          float ctForested = 1.0 - smoothstep(0.25, 0.75, vCtRock);
          vec2 ctTree = ctCanopy(vCtWorld, ctN);
          // Crowns close up; the stands' clumps modelled by the sun further out;
          // ledges on the rock.
          float ctFar = 1.0 - smoothstep(900.0, 1700.0, vCtDist);
          float ctRelief = ctTree.x * ctNear * ctForested * 1.4
            + ctFbm2(vCtWorld.xz * 0.034 + vec2(3.0, vCtWorld.y * 0.02)) * 9.0 * ctFar * ctForested
            + ctStrata(vCtWorld) * 2.2 * vCtRock * ctFar;
          normal = ctBump(-vViewPosition, normal, ctRelief, 1.0);
        }
      #endif
    `,
  });
}

/**
 * Sea mist at the mountains' foot: a thin layer on the water, so the ranges
 * rise out of it instead of meeting the sea at a hard line. Thin, because a
 * deep one hung a pale veil over the lower faces and the ranges read as a
 * curtain. Applied after lighting, on top of the scene's own fog.
 */
function withMist(material: MeshStandardMaterial): MeshStandardMaterial {
  const patch = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    patch.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#if defined( USE_FOG ) && !defined( CT_LITE )
         float ctMist = pow(1.0 - smoothstep(-8.0, 55.0, vCtWorld.y), 1.5) * smoothstep(300.0, 900.0, vCtDist);
         gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ctMist * 0.42);
       #endif
       #include <fog_fragment>`,
    );
  };
  return material;
}

/**
 * Trees standing on the near range, so its ridgelines and spurs carry a
 * canopy against the sky instead of a smooth edge, and its faces have crowns
 * the sun can light from one side. Rounded canopies, a few thousand of them,
 * placed from the range's own vertices: on forested ground (not the bare rock
 * channel), on the island-facing front of the range where they are seen, more
 * on the ridges than in the gullies. Seeded, so the same build is the same
 * forest. They ride on the vertex they stand on, half sunk into it, so none
 * floats where the mesh between vertices dips.
 */
const CANOPY_COLOURS = ['#2F5E33', '#3A6B39', '#2A5232', '#46713F', '#284C32', '#3B6440', '#4F7A42'].map((hex) => new Color(hex));

function forestOn(range: BufferGeometry, count: number, seed: number): { matrices: Float32Array; colours: Float32Array; placed: number } {
  const positions = range.getAttribute('position');
  const normals = range.getAttribute('normal');
  const rock = range.getAttribute('aRock');
  const random = makeRandom(seed);
  const matrices = new Float32Array(count * 16);
  const colours = new Float32Array(count * 3);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);
  const tilt = new Vector3();
  let placed = 0;
  const vertices = positions.count;
  // Trees grow in stands: a centre drawn from the range's vertices, then a
  // handful of crowns around it on neighbouring vertices of the same row band.
  // A bounded number of tries: some draws land on rock, water or cliff.
  for (let attempt = 0; attempt < count * 6 && placed < count; attempt += 1) {
    const centre = Math.floor(random() * vertices);
    const cy = positions.getY(centre);
    if (cy < 6) continue;
    if (rock && rock.getX(centre) > 0.35) continue;
    const cny = normals.getY(centre);
    if (cny < 0.6) continue;
    // Thinner where it is steep, thicker on the ridges and shoulders.
    if (random() > 0.3 + 0.7 * cny * cny) continue;
    const stand = 3 + Math.floor(random() * 5);
    for (let k = 0; k < stand && placed < count; k += 1) {
      // A neighbour up or down the same face (vertices run down the slope in rows).
      const index = Math.min(vertices - 1, Math.max(0, centre + Math.floor((random() - 0.5) * 6)));
      const y = positions.getY(index);
      if (y < 6) continue;
      const ny = normals.getY(index);
      if (ny < 0.55 || (rock && rock.getX(index) > 0.45)) continue;
      const size = 4.4 + random() * 4.4;
      position.set(
        positions.getX(index) + (random() - 0.5) * 7,
        y + size * 0.12,
        positions.getZ(index) + (random() - 0.5) * 7,
      );
      // A crown leans a little with the slope it grows on.
      tilt.set(normals.getX(index) * 0.25, 1, normals.getZ(index) * 0.25).normalize();
      quaternion.setFromUnitVectors(up, tilt);
      // Broad, flattish crowns that touch their neighbours: a canopy, not a field of balls.
      scale.set(size * (0.95 + random() * 0.3), size * (0.58 + random() * 0.3), size * (0.95 + random() * 0.3));
      matrix.compose(position, quaternion, scale);
      matrix.toArray(matrices, placed * 16);
      const colour = CANOPY_COLOURS[Math.floor(random() * CANOPY_COLOURS.length)]!;
      const shade = 0.88 + random() * 0.24;
      colours[placed * 3] = colour.r * shade;
      colours[placed * 3 + 1] = colour.g * shade;
      colours[placed * 3 + 2] = colour.b * shade;
      placed += 1;
    }
  }
  return { matrices, colours, placed };
}

function MountainForest({ range, count }: { range: BufferGeometry; count: number }) {
  const crown = useMemo(() => new IcosahedronGeometry(1, 1), []);
  // Leafy, not smooth: clumps of foliage on each crown, darker underneath,
  // and a bump the sun can catch - all from world position, so it is fixed.
  const material = useMemo(
    () =>
      patchStandard(new MeshStandardMaterial({ roughness: 0.92, metalness: 0 }), {
        key: 'continua-mountain-forest-v2',
        colour: /* glsl */ `
          {
            vec3 ctN = normalize(inverseTransformDirection(vNormal, viewMatrix));
            float ctLeaf = ctNoise(vCtWorld.xz * 0.35 + vCtWorld.y * 0.3) * 0.55 + ctNoise(vCtWorld.xz * 1.1 - vCtWorld.y * 0.9) * 0.45;
            diffuseColor.rgb *= (0.78 + 0.36 * ctLeaf) * mix(0.55, 1.05, smoothstep(-0.35, 0.7, ctN.y));
          }
        `,
        normal: /* glsl */ `
          {
            float ctNearLeaf = 1.0 - smoothstep(120.0, 420.0, vCtDist);
            float ctLeafH = ctNoise(vCtWorld.xz * 1.3 + vCtWorld.y * 1.1) * 0.5 + ctNoise(vCtWorld.xz * 3.2 - vCtWorld.y * 2.4) * 0.25;
            normal = ctBump(-vViewPosition, normal, ctLeafH * ctNearLeaf, 0.9);
          }
        `,
      }),
    [],
  );
  const forest = useMemo(() => forestOn(range, count, 7123), [range, count]);
  // In sectors round the range, so the ones behind the camera are culled: a
  // single mesh's bounds spanned the whole arc and every crown was drawn always.
  const group = useMemo(() => {
    const sectors = 16;
    const buckets: number[][] = Array.from({ length: sectors }, () => []);
    for (let i = 0; i < forest.placed; i += 1) {
      const x = forest.matrices[i * 16 + 12]! - NEAR_RANGE.cx;
      const z = forest.matrices[i * 16 + 14]! - NEAR_RANGE.cz;
      const angle = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
      buckets[Math.min(sectors - 1, Math.floor((angle / (Math.PI * 2)) * sectors))]!.push(i);
    }
    const holder = new Group();
    holder.name = 'CONTINUA_MountainForest';
    const colour = new Color();
    for (const bucket of buckets) {
      if (bucket.length === 0) continue;
      const instanced = new InstancedMesh(crown, material, bucket.length);
      bucket.forEach((source, index) => {
        instanced.instanceMatrix.array.set(forest.matrices.subarray(source * 16, source * 16 + 16), index * 16);
        colour.setRGB(forest.colours[source * 3]!, forest.colours[source * 3 + 1]!, forest.colours[source * 3 + 2]!);
        instanced.setColorAt(index, colour);
      });
      instanced.instanceMatrix.needsUpdate = true;
      if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      instanced.computeBoundingSphere();
      holder.add(instanced);
    }
    return holder;
  }, [crown, material, forest]);
  useEffect(
    () => () => {
      crown.dispose();
      material.dispose();
    },
    [crown, material],
  );
  useEffect(
    () => () => {
      for (const child of group.children) (child as InstancedMesh).dispose();
    },
    [group],
  );
  return <primitive object={group} />;
}

export function Mountains({ quality }: { quality: 'high' | 'balanced' | 'low' }) {
  // At that distance the silhouette carries a coarser mesh on the lower tiers.
  const detail = quality === 'low' ? 0.4 : quality === 'balanced' ? 0.7 : 1;
  const lite = quality === 'low';
  const { clock } = useSceneRuntime();
  const near = useMemo(() => buildRange(NEAR_RANGE, detail), [detail]);
  const far = useMemo(() => buildRange(FAR_RANGE, detail), [detail]);
  const time = useMemo(() => ({ value: 0 }), []);
  // The low tier draws the ranges' vertex colours alone, so they need nothing
  // more than Lambert shading - they cover a third of the screen, and on a
  // software rasteriser the physically based model cost a sixth of a frame.
  const material = useMemo(
    () =>
      lite
        ? new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })
        : withMist(mountainMaterial(time)),
    [lite, time],
  );
  useFrame(() => {
    time.value = clock.time;
  });
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
      {!lite && <MountainForest range={near} count={quality === 'high' ? 12000 : 5000} />}
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
  // The low tier's sea is opaque: under the island it is hidden, and drawn
  // opaque - before the land, depth-tested - a software rasteriser rejects
  // those fragments instead of shading half a screen of water it then blends
  // away (about half of a SwiftShader frame). The shallows lose their
  // see-through sand there, nothing else.
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.07,
    metalness: 0,
    transparent: !lite,
    depthWrite: lite,
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
      #ifndef CT_LITE
      {
        vec2 p = vCtWorld.xz;
        float fade = 1.0 - smoothstep(60.0, 1100.0, vCtDist);
        normal = ctBump(-vViewPosition, normal, ctWaves(p, uTime) * fade, 0.55);
      }
      #endif
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
  // None on the forecourt where the road ends, nor in the ridge tunnel, its
  // walls or under its hill - filtered after the fact, so the seeded
  // sequence, and every other tuft, is unchanged.
  return out.filter((spot) => !onForecourt(spot.x, spot.z, 0.5) && !onTunnelWorks(spot.x, spot.z));
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
