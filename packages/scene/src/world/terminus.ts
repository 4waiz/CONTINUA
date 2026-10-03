/**
 * Where the road ends.
 *
 * The carriageway used to stop in a straight cut across a strip of concrete,
 * with meadow beyond it - a road that simply ran out. It now ends the way a
 * road to a remote station does: it opens into a turning circle, set in a
 * concrete forecourt that reaches back to the ground-station compound. The
 * route itself is unchanged (world.json is a contract with the engine); the
 * rover stops where it always did, a few metres short of the circle's centre.
 *
 * Shapes only, in world X/Z. `Ground.tsx` draws them; the layout and the
 * roadside scatter keep their planting off them.
 */

import { route } from './route';

const end = route.at(route.length);
/** The road's direction where it ends, and its left (the station's side). */
const ahead = { x: end.tx, z: end.tz };
const left = { x: -end.tz, z: end.tx };

/** The turning circle: asphalt, centred a little past the end of the route. */
export const TURNING_CIRCLE = {
  x: end.x + ahead.x * 3.5,
  z: end.z + ahead.z * 3.5,
  radius: 11.5,
  /** Unit vector from the centre back along the road: the way in. */
  back: { x: -ahead.x, z: -ahead.z },
} as const;

/**
 * The road's painted edge lines, as the road shader draws them (u 0.035-0.058
 * across a 7.8 m carriageway): their centre and half-width off the middle of
 * the road, and the asphalt left outside them.
 */
export const ROAD_LINE = { offset: 3.537, half: 0.09, margin: 0.273 } as const;

/** The turning circle's edge line: the road's line carried round the circle,
 *  the same width and the same margin of asphalt outside it. */
export const RING = TURNING_CIRCLE.radius - ROAD_LINE.margin - ROAD_LINE.half;

/**
 * Where the carriageway stops, metres along the route: where its edge lines
 * meet the ring, so one line runs on into the other. The circle carries on
 * from there.
 */
export const EDGE_LINES_END =
  route.length + 3.5 - Math.sqrt(RING * RING - ROAD_LINE.offset * ROAD_LINE.offset);

/**
 * The forecourt: concrete round the circle, reaching back toward the
 * compound (sites.ts 'sat-terminal' stands 21 m back along the road and 12 m
 * to its left). A capsule: every point within `radius` of the segment a-b.
 */
export const FORECOURT = {
  a: { x: TURNING_CIRCLE.x, z: TURNING_CIRCLE.z },
  b: {
    x: TURNING_CIRCLE.x - ahead.x * 15 + left.x * 7,
    z: TURNING_CIRCLE.z - ahead.z * 15 + left.z * 7,
  },
  radius: 14.5,
} as const;

/** Distance from a point to the forecourt's edge: negative inside it. */
export function forecourtDistance(x: number, z: number): number {
  const { a, b, radius } = FORECOURT;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) - radius;
}

/** Whether a point is on the forecourt, or within `grow` metres of it. */
export function onForecourt(x: number, z: number, grow = 0): boolean {
  return forecourtDistance(x, z) < grow;
}
