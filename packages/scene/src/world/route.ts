/**
 * The mission route.
 *
 * A Catmull-Rom spline through hand-placed control points, resampled at a fixed
 * arc-length step so that "distance travelled" is a real distance. The vehicle,
 * the road ribbon, the cameras and the terrain flattening all read from the
 * same sample table, which is why the road never floats and the wheels never
 * sink.
 */

import { angleDelta, clamp, lerp } from '../math/noise';

export interface RouteSample {
  /** Arc length from the start, metres. */
  readonly distance: number;
  readonly x: number;
  readonly z: number;
  /** Unit tangent in the XZ plane. */
  readonly tx: number;
  readonly tz: number;
  /** Heading about +Y. 0 faces +X, matching the model's authored forward. */
  readonly heading: number;
  /** Signed curvature, 1/m. Positive turns left. */
  readonly curvature: number;
}

/** Hand-placed control points, world XZ metres. The story reads left to right. */
export const ROUTE_CONTROL_POINTS: readonly (readonly [number, number])[] = [
  [-26, 0],
  [0, 0], // dock
  [26, -1],
  [54, -7],
  [86, -17],
  [118, -23],
  [152, -19],
  [186, -5],
  [214, 10],
  [250, 18],
  [292, 16],
  [334, 4],
  [372, -14],
  [408, -30],
  [448, -38],
  [492, -34],
  [538, -14],
  [578, 16],
  [614, 48],
  [652, 74],
  [694, 88],
  [740, 88],
  [788, 74],
  [824, 52],
];

const SAMPLE_STEP = 1.0; // metres between resampled points

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export class Route {
  readonly samples: readonly RouteSample[];
  readonly length: number;
  /** Sample indices bucketed by X so nearest-point queries stay cheap. */
  private readonly buckets: readonly (readonly number[])[];
  private readonly bucketSize = 20;
  private readonly minX: number;

  constructor(points: readonly (readonly [number, number])[] = ROUTE_CONTROL_POINTS) {
    const dense = Route.tessellate(points);
    this.samples = Route.resampleByArcLength(dense, SAMPLE_STEP);
    this.length = this.samples.length > 0 ? this.samples[this.samples.length - 1]!.distance : 0;

    let minX = Infinity;
    let maxX = -Infinity;
    for (const sample of this.samples) {
      if (sample.x < minX) minX = sample.x;
      if (sample.x > maxX) maxX = sample.x;
    }
    this.minX = minX;
    const bucketCount = Math.max(1, Math.ceil((maxX - minX) / this.bucketSize) + 1);
    const buckets: number[][] = Array.from({ length: bucketCount }, () => []);
    this.samples.forEach((sample, index) => {
      const bucket = clamp(Math.floor((sample.x - minX) / this.bucketSize), 0, bucketCount - 1);
      buckets[bucket]!.push(index);
    });
    this.buckets = buckets;
  }

  /** Dense spline evaluation before arc-length resampling. */
  private static tessellate(points: readonly (readonly [number, number])[]): [number, number][] {
    const out: [number, number][] = [];
    const n = points.length;
    const stepsPerSegment = 24;
    for (let i = 0; i < n - 1; i += 1) {
      const p0 = points[Math.max(0, i - 1)]!;
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p3 = points[Math.min(n - 1, i + 2)]!;
      const last = i === n - 2 ? stepsPerSegment : stepsPerSegment - 1;
      for (let s = 0; s <= last; s += 1) {
        const t = s / stepsPerSegment;
        out.push([
          catmullRom(p0[0], p1[0], p2[0], p3[0], t),
          catmullRom(p0[1], p1[1], p2[1], p3[1], t),
        ]);
      }
    }
    return out;
  }

  private static resampleByArcLength(dense: [number, number][], step: number): RouteSample[] {
    const cumulative: number[] = [0];
    for (let i = 1; i < dense.length; i += 1) {
      const dx = dense[i]![0] - dense[i - 1]![0];
      const dz = dense[i]![1] - dense[i - 1]![1];
      cumulative.push(cumulative[i - 1]! + Math.hypot(dx, dz));
    }
    const total = cumulative[cumulative.length - 1]!;
    const count = Math.max(2, Math.floor(total / step) + 1);

    const positions: [number, number][] = [];
    let cursor = 0;
    for (let i = 0; i < count; i += 1) {
      const target = (i / (count - 1)) * total;
      while (cursor < cumulative.length - 2 && cumulative[cursor + 1]! < target) cursor += 1;
      const segmentLength = cumulative[cursor + 1]! - cumulative[cursor]!;
      const t = segmentLength > 1e-6 ? (target - cumulative[cursor]!) / segmentLength : 0;
      positions.push([
        lerp(dense[cursor]![0], dense[cursor + 1]![0], t),
        lerp(dense[cursor]![1], dense[cursor + 1]![1], t),
      ]);
    }

    // Tangents and curvature from central differences on the even sampling.
    const samples: RouteSample[] = [];
    let distance = 0;
    for (let i = 0; i < positions.length; i += 1) {
      const previous = positions[Math.max(0, i - 1)]!;
      const next = positions[Math.min(positions.length - 1, i + 1)]!;
      const dx = next[0] - previous[0];
      const dz = next[1] - previous[1];
      const norm = Math.hypot(dx, dz) || 1;
      const tx = dx / norm;
      const tz = dz / norm;
      // Heading 0 faces +X; +Y is up, so a left turn is a positive rotation
      // about +Y in a right-handed frame, i.e. atan2(-z, x).
      const heading = Math.atan2(-tz, tx);
      if (i > 0) {
        const p = positions[i - 1]!;
        distance += Math.hypot(positions[i]![0] - p[0], positions[i]![1] - p[1]);
      }
      samples.push({ distance, x: positions[i]![0], z: positions[i]![1], tx, tz, heading, curvature: 0 });
    }

    // Curvature = d(heading)/d(distance), smoothed over a short window so that
    // steering does not twitch on resampling noise.
    const window = 4;
    const withCurvature: RouteSample[] = samples.map((sample, i) => {
      const a = samples[Math.max(0, i - window)]!;
      const b = samples[Math.min(samples.length - 1, i + window)]!;
      const ds = b.distance - a.distance;
      const curvature = ds > 1e-6 ? angleDelta(a.heading, b.heading) / ds : 0;
      return { ...sample, curvature };
    });
    return withCurvature;
  }

  /** Sample the route at an arc-length distance, clamped to the ends. */
  at(distance: number): RouteSample {
    const clamped = clamp(distance, 0, this.length);
    const index = clamp(Math.floor(clamped / SAMPLE_STEP), 0, this.samples.length - 2);
    const a = this.samples[index]!;
    const b = this.samples[index + 1]!;
    const span = b.distance - a.distance;
    const t = span > 1e-6 ? (clamped - a.distance) / span : 0;
    const heading = a.heading + angleDelta(a.heading, b.heading) * t;
    return {
      distance: clamped,
      x: lerp(a.x, b.x, t),
      z: lerp(a.z, b.z, t),
      tx: lerp(a.tx, b.tx, t),
      tz: lerp(a.tz, b.tz, t),
      heading,
      curvature: lerp(a.curvature, b.curvature, t),
    };
  }

  /**
   * Heading averaged over +/- `radius` metres. Used by the follow camera so it
   * tracks the road's general direction rather than every kink — deterministic,
   * unlike a spring, and therefore safe for frame-accurate capture.
   */
  smoothHeadingAt(distance: number, radius = 26): number {
    const samplesToUse = 7;
    let sinSum = 0;
    let cosSum = 0;
    for (let i = 0; i < samplesToUse; i += 1) {
      const offset = -radius + (2 * radius * i) / (samplesToUse - 1);
      const heading = this.at(distance + offset).heading;
      sinSum += Math.sin(heading);
      cosSum += Math.cos(heading);
    }
    return Math.atan2(sinSum, cosSum);
  }

  /** Squared distance from a world XZ point to the route polyline. */
  distanceToRouteSq(x: number, z: number): { distSq: number; sample: RouteSample } {
    const bucket = clamp(
      Math.floor((x - this.minX) / this.bucketSize),
      0,
      this.buckets.length - 1,
    );
    let best = Infinity;
    let bestSample = this.samples[0]!;
    // Neighbouring buckets cover routes that double back within one bucket width.
    for (let b = bucket - 2; b <= bucket + 2; b += 1) {
      const list = this.buckets[b];
      if (!list) continue;
      for (const index of list) {
        const sample = this.samples[index]!;
        const dx = sample.x - x;
        const dz = sample.z - z;
        const distSq = dx * dx + dz * dz;
        if (distSq < best) {
          best = distSq;
          bestSample = sample;
        }
      }
    }
    if (best === Infinity) {
      // Far outside every bucket — fall back to a coarse scan.
      for (let i = 0; i < this.samples.length; i += 8) {
        const sample = this.samples[i]!;
        const distSq = (sample.x - x) ** 2 + (sample.z - z) ** 2;
        if (distSq < best) {
          best = distSq;
          bestSample = sample;
        }
      }
    }
    return { distSq: best, sample: bestSample };
  }
}

/** The shared singleton route. One route, one truth. */
export const route = new Route();
