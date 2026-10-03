/**
 * Terrain.
 *
 * `height(x, z)` is the single authority for ground elevation. The road ribbon,
 * the vehicle's contact point, prop placement and the camera clamp all call it,
 * so nothing can float or sink relative to anything else.
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

/** The natural landscape, before building pads and the route are cut in. */
function naturalHeight(x: number, z: number): number {
  // The campus is graded flat; the land opens up past the gate (x ~ 228).
  const openness = smoothstep(220, 300, x);
  const remote = smoothstep(400, 580, x);

  let height = 0;
  height += openness * fbm2(x * 0.0075, z * 0.0075, 3, 11) * 2.1;
  height += remote * (fbm2(x * 0.0032, z * 0.0032, 4, 23) * 15.5 + 3.0);
  height += remote * fbm2(x * 0.011, z * 0.011, 3, 47) * 2.4;
  // Ground rises away from the corridor in the remote zone: a shallow valley.
  height += remote * Math.min(Math.abs(z), 260) * 0.022;
  return height;
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
