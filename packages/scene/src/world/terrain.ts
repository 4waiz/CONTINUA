/**
 * Terrain.
 *
 * `height(x, z)` is the single authority for ground elevation. The road ribbon,
 * the vehicle's contact point, prop placement and the camera clamp all call it,
 * so nothing can float or sink relative to anything else.
 *
 * The land is a broad coastal island: open sea along the south shore, a
 * headland past the ground station with water to the east, a strait to the
 * north, and the town on the west coast. Every shore is at least a hundred
 * metres from the route, so the road and everything the engine shares are
 * unchanged by it; below `SEA_LEVEL` is water (`Sea` in Landscape.tsx).
 *
 * The route corridor is flattened toward the route's own smoothed elevation.
 * That is what makes the road sit *on* the terrain instead of being a decal
 * hovering over it.
 */

import { clamp, fbm2, lerp, smoothstep } from '../math/noise';
import { PADS, type Pad } from './layout';
import { route, type Route } from './route';

export const TERRAIN = {
  /** World bounds of the ground plane, metres. West reaches the city skyline. */
  minX: -640,
  maxX: 1340,
  minZ: -470,
  maxZ: 490,
  /** Grid resolution of the generated mesh (about 6 m per cell). */
  segmentsX: 330,
  segmentsZ: 158,
  /** Corridor half-widths for flattening the route. */
  flatInner: 7.5,
  flatOuter: 20,
} as const;

/** The water's surface, metres. */
export const SEA_LEVEL = -0.6;

/** Soft minimum: rounds the island's corners instead of mitring them. */
function softMin(values: readonly number[], k: number): number {
  let sum = 0;
  for (const value of values) sum += Math.exp(-value / k);
  return -k * Math.log(sum);
}

/** Where the land stands above the water before hills: high enough that no
 *  hollow inland reaches the sea, low enough that the shore is a beach. */
const LAND_BASE = 2.6;

/**
 * How far inland a point is, metres: positive on the island, negative at sea.
 * The waterline lies 8 m inland of zero; the beach runs up from it to about
 * 40 m, where the land proper begins.
 */
export function inlandDistance(x: number, z: number): number {
  const south =
    -205 +
    45 * smoothstep(480, 640, x) -
    25 * smoothstep(900, 1100, x) +
    20 * Math.sin(x * 0.0058 + 0.8) +
    12 * Math.sin(x * 0.0165 + 2.1) +
    16 * fbm2(x * 0.0045, 3.3, 3, 91);
  const north = 400 + 25 * Math.sin(x * 0.007 + 1.3) + 18 * fbm2(x * 0.004, 8.1, 3, 92);
  const west = -650 + 15 * Math.sin(z * 0.01);
  const east = 1080 + 30 * Math.sin(z * 0.008 + 0.4) + 20 * fbm2(z * 0.005, 5.7, 3, 93);
  return softMin([z - south, north - z, x - west, east - x], 35);
}

/** The landscape before the sea: hills, the valley, the graded campus. */
function dryHeight(x: number, z: number): number {
  // The campus is graded flat; the land opens up past the gate (x ~ 228).
  const openness = smoothstep(220, 300, x);
  const remote = smoothstep(400, 580, x);

  let height = LAND_BASE;
  height += openness * fbm2(x * 0.0075, z * 0.0075, 3, 11) * 2.1;
  // Rolling hills; the hollows between them are shallow, so none floods.
  const hills = fbm2(x * 0.0032, z * 0.0032, 4, 23);
  height += remote * ((hills < -0.1 ? -0.1 + (hills + 0.1) * 0.25 : hills) * 15.5 + 4.0);
  height += remote * fbm2(x * 0.011, z * 0.011, 3, 47) * 2.4;
  // Ground rises away from the corridor in the remote zone: a shallow valley.
  height += remote * Math.min(Math.abs(z), 260) * 0.022;
  return height;
}

/**
 * The shore, by distance inland: a 6 % beach from the land down through the
 * waterline to a turquoise shelf, then a steeper drop to open water.
 */
function shoreHeight(inland: number): number {
  if (inland >= -20) return SEA_LEVEL + 0.06 * (inland - 8);
  const shelf = SEA_LEVEL + 0.06 * -28;
  return Math.max(-9, shelf + 0.09 * (inland + 20)) - 0.012 * Math.max(0, -inland - 80);
}

/** The natural landscape, before building pads and the route are cut in. */
function naturalHeight(x: number, z: number): number {
  const inland = inlandDistance(x, z);
  if (inland > 60) return dryHeight(x, z);
  return lerp(shoreHeight(inland), dryHeight(x, z), smoothstep(30, 60, inland));
}

/** Each pad is levelled to the natural height at its centre. */
const PAD_LEVELS: readonly (Pad & { y: number })[] = PADS.map((pad) => ({
  ...pad,
  y: naturalHeight(pad.x, pad.z),
}));

/** Raw landscape before the route is carved into it: natural ground with
 *  flat pads under every building, eased back to grade over each margin. */
export function baseHeight(x: number, z: number): number {
  let height = naturalHeight(x, z);
  for (const pad of PAD_LEVELS) {
    const dx = Math.max(Math.abs(x - pad.x) - pad.hx, 0);
    const dz = Math.max(Math.abs(z - pad.z) - pad.hz, 0);
    if (dx > pad.margin || dz > pad.margin) continue;
    const weight = 1 - smoothstep(0, pad.margin, Math.hypot(dx, dz));
    height = lerp(height, pad.y, weight);
  }
  return height;
}

/** Distant ridge line, drawn as its own silhouette geometry. */
export function ridgeHeight(x: number, z: number): number {
  const base = 16 + fbm2(x * 0.0016, z * 0.0016, 4, 71) * 26;
  return Math.max(3, base);
}

export class Terrain {
  private readonly routeRef: Route;
  /** Smoothed elevation of the route itself, indexed by sample. */
  private readonly routeElevation: Float32Array;

  constructor(routeRef: Route = route) {
    this.routeRef = routeRef;
    const raw = new Float32Array(routeRef.samples.length);
    routeRef.samples.forEach((sample, index) => {
      raw[index] = baseHeight(sample.x, sample.z);
    });
    // Moving average: the road follows the land without inheriting its noise.
    const window = 26;
    const smoothed = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -window; k <= window; k += 1) {
        const index = clamp(i + k, 0, raw.length - 1);
        sum += raw[index]!;
        count += 1;
      }
      smoothed[i] = sum / count;
    }
    this.routeElevation = smoothed;
  }

  /** Elevation of the route surface at an arc-length distance. */
  elevationAtDistance(distance: number): number {
    const samples = this.routeRef.samples;
    const clamped = clamp(distance, 0, this.routeRef.length);
    const index = clamp(Math.floor(clamped), 0, samples.length - 2);
    const a = this.routeElevation[index]!;
    const b = this.routeElevation[index + 1]!;
    const t = clamp(clamped - index, 0, 1);
    return lerp(a, b, t);
  }

  /** Ground height at any world XZ. This is the authority. */
  height(x: number, z: number): number {
    const base = baseHeight(x, z);
    const { distSq, sample } = this.routeRef.distanceToRouteSq(x, z);
    const distance = Math.sqrt(distSq);
    if (distance > TERRAIN.flatOuter) return base;
    const roadY = this.elevationAtDistance(sample.distance);
    // 1 on the road, easing out to the natural surface at flatOuter.
    const blend = 1 - smoothstep(TERRAIN.flatInner, TERRAIN.flatOuter, distance);
    return lerp(base, roadY, blend);
  }

  /** The surface a camera must stay above: the ground, or the sea over it. */
  surfaceHeight(x: number, z: number): number {
    return Math.max(this.height(x, z), SEA_LEVEL);
  }

  /** Surface normal by central differences - used for body pitch and roll. */
  normalAt(x: number, z: number, epsilon = 1.5): [number, number, number] {
    const hx = this.height(x + epsilon, z) - this.height(x - epsilon, z);
    const hz = this.height(x, z + epsilon) - this.height(x, z - epsilon);
    const nx = -hx / (2 * epsilon);
    const nz = -hz / (2 * epsilon);
    const length = Math.hypot(nx, 1, nz);
    return [nx / length, 1 / length, nz / length];
  }
}

export const terrain = new Terrain();
