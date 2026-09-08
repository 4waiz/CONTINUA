/**
 * Road ribbon geometry.
 *
 * Generated from the same route samples and the same terrain elevation the
 * vehicle uses, which is the only reliable way to guarantee the road is neither
 * floating above the ground nor buried in it.
 */

import { BufferAttribute, BufferGeometry } from 'three';
import { terrain } from './terrain';
import { route, type Route } from './route';

/** The road deck sits this far above the flattened terrain. Shared with the rover. */
export const ROAD_SURFACE_OFFSET = 0.06;
export const ROAD_HALF_WIDTH = 3.9;
/** Metres between ribbon cross-sections. */
const RIBBON_STEP = 2;

export interface RibbonOptions {
  halfWidth?: number;
  yOffset?: number;
  from?: number;
  to?: number;
}

/**
 * Build a flat ribbon following the route.
 *
 * `halfWidth` may be a function of normalised progress so shoulders and centre
 * lines can reuse the same generator.
 */
export function buildRouteRibbon(
  options: RibbonOptions = {},
  routeRef: Route = route,
): BufferGeometry {
  const halfWidth = options.halfWidth ?? ROAD_HALF_WIDTH;
  const yOffset = options.yOffset ?? ROAD_SURFACE_OFFSET;
  const from = options.from ?? 0;
  const to = options.to ?? routeRef.length;

  const steps = Math.max(2, Math.floor((to - from) / RIBBON_STEP) + 1);
  const positions = new Float32Array(steps * 2 * 3);
  const uvs = new Float32Array(steps * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < steps; i += 1) {
    const distance = from + ((to - from) * i) / (steps - 1);
    const sample = routeRef.at(distance);
    const y = terrain.elevationAtDistance(distance) + yOffset;
    // Left normal of a tangent (tx, tz) in the XZ plane.
    const nx = -sample.tz;
    const nz = sample.tx;

    const base = i * 6;
    positions[base + 0] = sample.x + nx * halfWidth;
    positions[base + 1] = y;
    positions[base + 2] = sample.z + nz * halfWidth;
    positions[base + 3] = sample.x - nx * halfWidth;
    positions[base + 4] = y;
    positions[base + 5] = sample.z - nz * halfWidth;

    const uvBase = i * 4;
    const v = distance / 12;
    uvs[uvBase + 0] = 0;
    uvs[uvBase + 1] = v;
    uvs[uvBase + 2] = 1;
    uvs[uvBase + 3] = v;

    if (i < steps - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** World-space Y of the drivable surface at a route distance. */
export function roadSurfaceY(distance: number): number {
  return terrain.elevationAtDistance(distance) + ROAD_SURFACE_OFFSET;
}
