/**
 * The dock yard: where every run begins.
 *
 * The rover's bay used to lie in a six-metre strip of lawn between two
 * concrete pads, and the carriageway started at the bay's front edge: a
 * parking space dropped in a field, and a road that appeared out of the grass.
 * The bay now stands in a concrete yard that joins the operations centre's
 * forecourt to the gateway yard, and the campus road leaves the yard through
 * a bell-mouth - the yard's kerbed front edge curving into the road's edges -
 * where the road's painted edge lines begin, carried across the yard from the
 * bay's front corners.
 *
 * Shapes only, in world X/Z. `Ground.tsx` paves and kerbs them and paints the
 * lines; the dock prop (scripts/blender/world_industry.py, prop_dock_station)
 * stands on them. The route is unchanged, and the rover parks where it always
 * did: world.json is a contract with the engine.
 */

import { DOCK_BAY_HALF_LENGTH, ROAD_HALF_WIDTH } from './carriageway';
import { route } from './route';

const start = route.at(0);

/** The bay's floor, a slab in the dock prop centred on the start of the route. */
export const DOCK_BAY = {
  x: start.x,
  z: start.z,
  halfLength: DOCK_BAY_HALF_LENGTH,
  halfWidth: 2.7,
  /** The bay's painted long lines, off its centre line. */
  laneOffset: 2.2,
} as const;

/**
 * The rover's garage (world_industry.py, prop_rover_garage), on the line of
 * the route behind the bay with its door toward it: world X/Z footprint,
 * floor slab included. The follow camera starts 11 m in front of its door.
 */
export const ROVER_GARAGE = { x: -58, z: 0, hx: 6.1, hz: 8.1 } as const;

/**
 * The yard, in world X/Z: from the garage's door to where the road begins,
 * across the gap between the two pads either side.
 */
export const DOCK_YARD = {
  west: ROVER_GARAGE.x + ROVER_GARAGE.hx,
  /** The yard's front edge: the carriageway begins here. */
  front: -12,
  halfWidth: 13,
  /** Radius of the yard's two front corners. */
  corner: 3,
  /** Radius of the kerb's curve from the front edge into the road's edge. */
  flare: 5,
  /** The surface is at the road deck's height, as the bay is: the rover's
   *  tyres rest on all three at one height. */
} as const;

/** Route distance where the carriageway starts: the yard's front edge. */
export const ROAD_START = (() => {
  for (const sample of route.samples) {
    if (sample.x >= DOCK_YARD.front) return sample.distance - (sample.x - DOCK_YARD.front);
  }
  return 0;
})();

/**
 * Where the painted edge lines cross the yard: from the bay's front corners,
 * on its long lines, out to the road's own edge lines at the yard's front.
 */
export const LEAD_LINES = {
  fromX: DOCK_BAY.x + DOCK_BAY.halfLength,
  fromOffset: DOCK_BAY.laneOffset,
  toX: DOCK_YARD.front,
  /** The road's edge line centre (terminus.ts, ROAD_LINE.offset). */
  toOffset: 3.537,
  half: 0.075,
} as const;

/**
 * The equipment beside the bay - the data pillar and the utility cabinet -
 * in a painted keep-clear box: world X/Z bounds.
 */
export const KEEP_CLEAR = { minX: -25.4, maxX: -22.35, minZ: 3.0, maxZ: 8.1 } as const;

/**
 * Staff parking beside the garage, on the yard: four painted bays, nose in to
 * a back line, behind where the follow camera starts. World X/Z bounds.
 */
export const PARKING = { minX: -50.6, maxX: -40.2, minZ: -12.4, maxZ: -7.4, bay: 2.6 } as const;

type Point = [number, number];

function arc(out: Point[], cx: number, cz: number, radius: number, from: number, to: number, steps: number): void {
  for (let i = 0; i <= steps; i += 1) {
    const angle = from + ((to - from) * i) / steps;
    out.push([cx + radius * Math.cos(angle), cz + radius * Math.sin(angle)]);
  }
}

/**
 * The yard's outline, a closed loop (the last point is not repeated). Its
 * mouth spans the carriageway: the kerb curves in to the road's edge on
 * either side, and the road's verges start where the curves end.
 */
export function dockYardOutline(): Point[] {
  const { west, front, halfWidth: h, corner: c, flare: f } = DOCK_YARD;
  const w = ROAD_HALF_WIDTH;
  const out: Point[] = [];
  out.push([west, -h]);
  // South-east corner, then up the front edge to the curve into the road.
  arc(out, front - c, -h + c, c, -Math.PI / 2, 0, 8);
  // Concave: centred out in front of the yard, sweeping from the front edge
  // to the road's edge line.
  arc(out, front + f, -w - f, f, Math.PI, Math.PI / 2, 12);
  // Across the mouth, then the same on the north side.
  out.push([front, -w]);
  out.push([front, w]);
  arc(out, front + f, w + f, f, -Math.PI / 2, -Math.PI, 12);
  arc(out, front - c, h - c, c, 0, Math.PI / 2, 8);
  out.push([west, h]);
  return dedupe(out);
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 1e-4) continue;
    out.push(point);
  }
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-4) out.pop();
  return out;
}

const OUTLINE = dockYardOutline();

/** Even-odd point-in-polygon test. */
export function insideLoop(loop: readonly Point[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i, i += 1) {
    const [xi, zi] = loop[i]!;
    const [xj, zj] = loop[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a point is on the yard (the bay included). */
export function onDockYard(x: number, z: number): boolean {
  return insideLoop(OUTLINE, x, z);
}

/** The bay's outline, grown by `grow` metres: the hole the yard leaves for it. */
export function dockBayOutline(grow = 0): Point[] {
  const { x, z, halfLength, halfWidth } = DOCK_BAY;
  const hx = halfLength + grow;
  const hz = halfWidth + grow;
  return [
    [x - hx, z - hz],
    [x + hx, z - hz],
    [x + hx, z + hz],
    [x - hx, z + hz],
  ];
}
