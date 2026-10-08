/**
 * The ridge tunnel.
 *
 * Where the industrial corridor gives way to the remote hills, the road goes
 * through a ridge: a two-lane road tunnel, 56.4 m between its portals, each
 * portal at the back of a cut held by splayed wing walls (the models are
 * `scripts/blender/world_tunnel.py`; the dimensions in `TUNNEL_PROFILE` are a
 * contract with that file). This module is where it all stands - the portals,
 * the lining laid segment by segment, the hill over it - and the rules that
 * keep everything else out of it: the ground under a prop, the cameras, the
 * roadside scatter.
 *
 * Set dressing. The route, its length and the road's elevation are unchanged
 * (`world.json` is a contract with the engine), and nothing the engine
 * measures depends on the tunnel. Its coverage model is geometric and does not
 * know the tunnel is there: the links it reports inside are the ones it would
 * report on the open road. The lining carries the radiating cable a real
 * tunnel uses to keep the mobile network inside; it is drawn, not modelled.
 *
 * Everything here is a pure function of position, so a captured frame is
 * unchanged by when it is drawn.
 */

import { clamp, fbm2, makeRandom, smoothstep } from '../math/noise';
import { ROAD_SURFACE_OFFSET } from './carriageway';
import { WORLD_LAYOUT, type Placement } from './layout';
import { route } from './route';
import { SEA_LEVEL, terrain } from './terrain';

/** The lining, the portals and their cut (scripts/blender/world_tunnel.py). */
export const TUNNEL_PROFILE = {
  /** The arch's inner radius, and half the width between the walls. */
  radius: 5.35,
  /** The walls are vertical up to this height above the road, the arch above. */
  spring: 1.6,
  lining: 0.45,
  /** The walkways' kerb line from the centre line, and their top above the road. */
  walkwayIn: 4.05,
  walkwayTop: 0.22,
  /** One lining segment's length. */
  segment: 6,
  /** The headwall's thickness behind its face, and its half-width. */
  headDepth: 1.2,
  headHalf: 8.2,
  /** The coping over the headwall: its top, its half-width, how far back it reaches. */
  copingTop: 9.4,
  copingHalf: 8.35,
  copingBack: 1.35,
  /** The wing walls: how far out they run, their road face, splay, thickness and coping heights. */
  wingLength: 14,
  wingIn0: 7.6,
  wingSplay: 3.4 / 14,
  wingThick: 0.6,
  wingTop0: 9.4,
  wingTop1: 1.2,
} as const;

const P = TUNNEL_PROFILE;
const SEGMENTS = 9;

/**
 * Where the tunnel is, in route metres: the faces of the entry and the exit
 * portal, 56.4 m apart. Chosen where the run on screen - CONTINUA with its
 * road map, on the shadowed road - is on the cellular network for the whole
 * of the tunnel, and clear of the corridor's industry: the stack's yard and
 * its service road (x = 470) stay off the ridge's foot.
 */
const ENTRY = 560;

export const TUNNEL = {
  from: ENTRY,
  to: ENTRY + 2 * P.headDepth + SEGMENTS * P.segment,
  segments: SEGMENTS,
} as const;

/** The crown's height over the road at a lateral offset inside the lining. */
export function ceilingAt(lateral: number): number {
  const v = Math.min(Math.abs(lateral), P.radius);
  return P.spring + Math.sqrt(P.radius * P.radius - v * v);
}

/** The road's surface at a route distance: the road ribbon's, the rover's. */
function roadY(distance: number): number {
  return terrain.elevationAtDistance(distance) + ROAD_SURFACE_OFFSET;
}

// ---------------------------------------------------------------------------
// Portals
// ---------------------------------------------------------------------------

export interface PortalFrame {
  /** Route metres of the portal's face. */
  readonly at: number;
  /** The face's centre on the road. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Outward from the tunnel, flat and unit length. */
  readonly fx: number;
  readonly fz: number;
  /** The road's rise per metre, going outward. */
  readonly slope: number;
}

function portalAt(at: number, outward: 1 | -1): PortalFrame {
  const sample = route.at(at);
  const length = Math.hypot(sample.tx, sample.tz) || 1;
  return {
    at,
    x: sample.x,
    y: roadY(at),
    z: sample.z,
    fx: (sample.tx / length) * outward,
    fz: (sample.tz / length) * outward,
    slope: terrain.gradeAtDistance(at, 4) * outward,
  };
}

/** The entry portal (outward is back down the road) and the exit portal. */
export const PORTALS: readonly [PortalFrame, PortalFrame] = [portalAt(TUNNEL.from, -1), portalAt(TUNNEL.to, 1)];

/** A point in a portal's frame: `out` metres out from its face, `side` metres off its centre line. */
function portalLocal(portal: PortalFrame, x: number, z: number): { out: number; side: number } {
  const dx = x - portal.x;
  const dz = z - portal.z;
  return { out: dx * portal.fx + dz * portal.fz, side: Math.abs(-dx * portal.fz + dz * portal.fx) };
}

/** The back of a wing wall's coping - where the hill begins - `out` metres in front of the face. */
export function cutEdge(out: number): number {
  return P.wingIn0 + P.wingThick + 0.06 + P.wingSplay * Math.max(0, out);
}

/** Whether a point is in front of a portal, between its wing walls or in the open cut beyond them. */
function inCut(x: number, z: number): boolean {
  for (const portal of PORTALS) {
    const { out, side } = portalLocal(portal, x, z);
    // The face itself belongs to the tunnel: the hill's edge over the coping.
    if (out > 0.01 && side < cutEdge(out)) return true;
  }
  return false;
}

/**
 * The slopes the hill rises at from the portal's concrete. Gentle enough to
 * stay grassed - the ground's shader turns ground steeper than about 33
 * degrees to rock, and a steep band over the headwall read as two grey
 * streaks running up the hill from its corners.
 */
const BEHIND = Math.tan((27 * Math.PI) / 180);
const BESIDE = Math.tan((31 * Math.PI) / 180);

/** max(0, x), rounded over its first `width` metres: a slope that starts without a crease. */
function ramp(x: number, width = 2.5): number {
  if (x <= 0) return 0;
  return x < width ? (x * x) / (2 * width) : x - width / 2;
}

/**
 * How high the hill may stand at a point near a portal: hugging the coping
 * over the headwall and rising behind it, hugging each wing wall's coping and
 * rising behind it as the cut's slope, and beyond the walls a cut slope up
 * from the floor. Absolute world Y; very large well away from the portal.
 */
function portalCap(portal: PortalFrame, x: number, z: number): number {
  const { out, side } = portalLocal(portal, x, z);
  const ground = portal.y + out * portal.slope;
  if (out < 0) {
    // Over the headwall and behind it: just under the coping's top, then up.
    return ground + P.copingTop - 0.05 + BESIDE * ramp(side - P.copingHalf) + BEHIND * ramp(-out - P.copingBack, 4);
  }
  const edge = cutEdge(out);
  if (out <= P.wingLength) {
    const top = P.wingTop0 + ((P.wingTop1 - P.wingTop0) * out) / P.wingLength - 0.05;
    return ground + top + BESIDE * ramp(side - edge);
  }
  // Past the walls the cut's sides are open slopes, from a metre down to the floor.
  const top = Math.max(0, P.wingTop1 - 0.05 - (out - P.wingLength) * 0.6);
  return ground + top + BESIDE * ramp(side - edge);
}

/** The smaller of two heights, rounded where they meet, so the hill has no crease along it. */
function softMin(a: number, b: number, k = 2.4): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

// ---------------------------------------------------------------------------
// The ridge
// ---------------------------------------------------------------------------

/** The ridge's frame: centred on the tunnel, across the road there. */
const RIDGE = (() => {
  const centre = route.at((TUNNEL.from + TUNNEL.to) / 2);
  const length = Math.hypot(centre.tx, centre.tz) || 1;
  const tx = centre.tx / length;
  const tz = centre.tz / length;
  return { x: centre.x, z: centre.z, tx, tz, nx: -tz, nz: tx };
})();

/** The crest over the road, metres above the road. */
const RIDGE_HEIGHT = 27;

/**
 * The ridge's natural height above the ground at a point: a spur across the
 * road, crowned by a knoll just inland of it (the road's left), ending short
 * of the stack's yard and its service road on that side and falling away
 * toward the coast on the other, on a slight diagonal. Weathered with a
 * little noise. Zero off its foot.
 */
export function ridgeRise(x: number, z: number): number {
  const dx = x - RIDGE.x;
  const dz = z - RIDGE.z;
  const along = dx * RIDGE.nx + dz * RIDGE.nz;
  if (along > 80 || along < -125) return 0;
  const crest =
    RIDGE_HEIGHT *
    (1 + 0.14 * Math.exp(-(((along - 22) / 20) ** 2))) *
    (1 - smoothstep(40, 76, along)) *
    (1 - smoothstep(60, 120, -along));
  if (crest <= 0) return 0;
  const across = dx * RIDGE.tx + dz * RIDGE.tz;
  const s = (across - 0.15 * along) / (45 + 0.15 * Math.abs(along));
  if (Math.abs(s) >= 1) return 0;
  const g = (1 - s * s) ** 2;
  const rough = fbm2(x * 0.035, z * 0.035, 3, 311) * 1.4 * Math.pow(g, 0.7);
  return Math.max(0, crest * g + rough);
}

/** How far the hill's foot sinks under the ground, so the two surfaces cross cleanly. */
const TOE_SINK = 0.9;

/**
 * The hill's surface - the mesh `Tunnel.tsx` draws - at a point: absolute Y,
 * dipping under the ground where the hill does not rise above it; null where
 * a portal's cut is.
 */
export function hillSurface(x: number, z: number): number | null {
  if (inCut(x, z)) return null;
  const base = terrain.height(x, z);
  let y = base + ridgeRise(x, z);
  for (const portal of PORTALS) y = softMin(y, portalCap(portal, x, z));
  return y - TOE_SINK * (1 - smoothstep(0, 1, y - base));
}

/**
 * The ground a thing stands on: the terrain, or the hill over the tunnel
 * where it stands above it. What `terrain.height` is everywhere else.
 */
export function groundHeight(x: number, z: number): number {
  const base = terrain.height(x, z);
  if (ridgeRise(x, z) <= 0) return base;
  const hill = hillSurface(x, z);
  return hill === null ? base : Math.max(base, hill);
}

// ---------------------------------------------------------------------------
// What stands where
// ---------------------------------------------------------------------------

/** A placement in the world, with its own up: portals and segments follow the road's grade. */
export interface TunnelPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Unit forward (the prop's +X), and its rise per metre. */
  readonly fx: number;
  readonly fz: number;
  readonly slope: number;
}

function alongRoad(distance: number, direction: 1 | -1): TunnelPlacement {
  const sample = route.at(distance);
  const length = Math.hypot(sample.tx, sample.tz) || 1;
  return {
    x: sample.x,
    y: roadY(distance),
    z: sample.z,
    fx: (sample.tx / length) * direction,
    fz: (sample.tz / length) * direction,
    slope: terrain.gradeAtDistance(distance, P.segment) * direction,
  };
}

/** Route metres of each lining segment's centre, entry to exit. */
export const SEGMENT_CENTRES: readonly number[] = Array.from(
  { length: SEGMENTS },
  (_, index) => TUNNEL.from + P.headDepth + P.segment * (index + 0.5),
);

/**
 * The tunnel's pieces, by node name in continua_tunnel.glb: the two portals
 * facing out, the lining, the jet fans in the middle, and two emergency
 * stations - one on each wall, near either end.
 */
export const TUNNEL_PIECES: Readonly<Record<string, readonly TunnelPlacement[]>> = {
  PROP_TunnelPortal: PORTALS.map((portal) => ({
    x: portal.x,
    y: portal.y,
    z: portal.z,
    fx: portal.fx,
    fz: portal.fz,
    slope: portal.slope,
  })),
  PROP_TunnelSegment: SEGMENT_CENTRES.map((distance) => alongRoad(distance, 1)),
  PROP_TunnelFans: [alongRoad(SEGMENT_CENTRES[4]!, 1)],
  PROP_TunnelSOS: [alongRoad(SEGMENT_CENTRES[1]!, 1), alongRoad(SEGMENT_CENTRES[7]!, -1)],
};

// ---------------------------------------------------------------------------
// The pipeline over the ridge
// ---------------------------------------------------------------------------

/** How far a pipeline run's ends are from its middle (PROP_Pipeline is 12 m long). */
const PIPE_HALF = 6;

function pipeEnds(item: Placement): [number, number][] {
  const dx = Math.cos(item.yaw);
  const dz = -Math.sin(item.yaw);
  return [
    [item.x - dx * PIPE_HALF, item.z - dz * PIPE_HALF],
    [item.x, item.z],
    [item.x + dx * PIPE_HALF, item.z + dz * PIPE_HALF],
  ];
}

/** Whether the ridge rises where a run of the above-ground pipeline would stand: there, it is buried. */
export function pipeBuried(item: Placement): boolean {
  return pipeEnds(item).some(([x, z]) => groundHeight(x, z) - terrain.height(x, z) > 0.2);
}

/**
 * Where the pipeline goes under the ridge and comes out again: a bury piece
 * wherever a run above ground meets the buried stretch, +X toward the ridge,
 * and a marker post over every other buried run, 24 m apart - all on the
 * ground they stand on. (The pipeline starts at the ridge's foot, so it comes
 * out of the ground there and has one bury piece, on the far side.)
 */
function buildPipelinePieces(): { bury: TunnelPlacement[]; markers: TunnelPlacement[] } {
  const runs = [...(WORLD_LAYOUT.PROP_Pipeline ?? [])];
  const bury: TunnelPlacement[] = [];
  const markers: TunnelPlacement[] = [];
  const buried = runs.map(pipeBuried);
  for (let i = 0; i < runs.length; i += 1) {
    if (buried[i]) continue;
    const item = runs[i]!;
    const dx = Math.cos(item.yaw);
    const dz = -Math.sin(item.yaw);
    for (const direction of [1, -1] as const) {
      const neighbour = buried[i + direction];
      if (!neighbour) continue;
      const x = item.x + dx * PIPE_HALF * direction;
      const z = item.z + dz * PIPE_HALF * direction;
      bury.push({ x, y: terrain.height(x, z), z, fx: dx * direction, fz: dz * direction, slope: 0 });
    }
  }
  // Markers over the buried runs, one on every other run's middle.
  let count = 0;
  for (let i = 0; i < runs.length; i += 1) {
    if (!buried[i]) continue;
    count += 1;
    if (count % 2 === 0) continue;
    const item = runs[i]!;
    markers.push({ x: item.x, y: groundHeight(item.x, item.z), z: item.z, fx: 1, fz: 0, slope: 0 });
  }
  return { bury, markers };
}

const PIPELINE = buildPipelinePieces();

export const PIPELINE_PIECES: Readonly<Record<string, readonly TunnelPlacement[]>> = {
  PROP_PipelineBury: PIPELINE.bury,
  PROP_PipelineMarker: PIPELINE.markers,
};

// ---------------------------------------------------------------------------
// Planting on the ridge
// ---------------------------------------------------------------------------

/** The ground's gradient at a point, rise per metre. */
function slopeAt(x: number, z: number): number {
  const e = 2;
  const gx = (groundHeight(x + e, z) - groundHeight(x - e, z)) / (2 * e);
  const gz = (groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
  return Math.hypot(gx, gz);
}

/**
 * The ridge's planting, by prop node name: copses of ghaf with flame trees and
 * jacarandas among them, scrub between, and boulders on the cut's slopes
 * beside each portal - kept off the road and the cuts, and off ground too
 * steep to hold a tree. Seeded, so every build plants the same hill. The
 * world's own scatter that lands on the ridge stands on it too
 * (`groundHeight`).
 */
function buildPlanting(): Record<string, Placement[]> {
  const random = makeRandom(20261008);
  const out: Record<string, Placement[]> = {};
  const add = (prop: string, item: Placement) => {
    (out[prop] ??= []).push(item);
  };
  const onRidge = (along: number, across: number) => ({
    x: RIDGE.x + RIDGE.nx * along + RIDGE.tx * across,
    z: RIDGE.z + RIDGE.nz * along + RIDGE.tz * across,
  });
  const clear = (x: number, z: number, road: number) =>
    hillSurface(x, z) !== null && Math.sqrt(route.distanceToRouteSq(x, z).distSq) >= road;

  const trees: [number, number][] = [];
  for (let attempt = 0; attempt < 2600 && trees.length < 72; attempt += 1) {
    const { x, z } = onRidge(-112 + random() * 186, (random() * 2 - 1) * 62);
    const kind = random();
    const yaw = random() * Math.PI * 2;
    const scale = 0.85 + random() * 0.4;
    const thin = random();
    if (ridgeRise(x, z) < 2 || !clear(x, z, 17) || slopeAt(x, z) > 0.6) continue;
    // Copses, not an orchard: the trees stand where the noise gathers them.
    if (thin > 0.12 + 0.88 * smoothstep(0.3, 0.6, fbm2(x * 0.02, z * 0.02, 2, 41) * 0.5 + 0.5)) continue;
    if (trees.some(([tx, tz]) => (tx - x) ** 2 + (tz - z) ** 2 < 6.5 * 6.5)) continue;
    trees.push([x, z]);
    add(kind < 0.68 ? 'PROP_Ghaf' : kind < 0.85 ? 'PROP_FlameTree' : 'PROP_Jacaranda', { x, z, yaw, scale });
  }
  for (let attempt = 0; attempt < 220; attempt += 1) {
    const { x, z } = onRidge(-110 + random() * 182, (random() * 2 - 1) * 60);
    const kind = random();
    const yaw = random() * Math.PI * 2;
    const scale = 0.8 + random() * 0.7;
    if (ridgeRise(x, z) < 1.2 || !clear(x, z, 12) || slopeAt(x, z) > 0.75) continue;
    add(kind < 0.5 ? 'PROP_Shrub_B' : 'PROP_Shrub_A', { x, z, yaw, scale });
  }
  // Boulders on the cut slopes beside each portal's approach.
  for (const portal of PORTALS) {
    for (let i = 0; i < 9; i += 1) {
      const along = 2 + random() * 22;
      const side = (random() < 0.5 ? -1 : 1) * (cutEdge(along) + 1.2 + random() * 6);
      const x = portal.x + portal.fx * along - portal.fz * side;
      const z = portal.z + portal.fz * along + portal.fx * side;
      const kind = random();
      const yaw = random() * Math.PI * 2;
      const scale = 0.55 + random() * 0.6;
      const hill = hillSurface(x, z);
      if (hill === null || hill < terrain.height(x, z) + 0.6) continue;
      add(kind < 0.45 ? 'PROP_Rock_A' : kind < 0.8 ? 'PROP_Rock_B' : 'PROP_Rock_C', { x, z, yaw, scale });
    }
  }
  return out;
}

export const TUNNEL_PLANTING: Readonly<Record<string, readonly Placement[]>> = buildPlanting();

// ---------------------------------------------------------------------------
// Keeping things out of it
// ---------------------------------------------------------------------------

/** A route position's lateral offset: + toward the route's left normal. */
function lateralOf(x: number, z: number, along: number): number {
  const sample = route.at(along);
  return (x - sample.x) * -sample.tz + (z - sample.z) * sample.tx;
}

/**
 * Whether a point is taken by the tunnel's works - inside the bore, in a
 * wing wall, or under the hill - so roadside scatter keeps off it. The cut's
 * floor near the road stays open: gravel and grass grow there as anywhere.
 */
export function onTunnelWorks(x: number, z: number): boolean {
  if (ridgeRise(x, z) <= 0) return false;
  const { distSq, along } = route.projectOnRoute(x, z);
  if (along > TUNNEL.from - 0.5 && along < TUNNEL.to + 0.5 && distSq < 9.5 * 9.5) return true;
  for (const portal of PORTALS) {
    const { out, side } = portalLocal(portal, x, z);
    if (out >= 0 && out <= P.wingLength + 1 && side > P.wingIn0 - 0.6 + P.wingSplay * out && side < cutEdge(out) + 0.4) return true;
  }
  const hill = hillSurface(x, z);
  return hill !== null && hill > terrain.height(x, z) + 0.15;
}

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------

/** How close a camera inside the tunnel comes to the walls, the crown and the road. */
const CAMERA_WALL = 0.95;
const CAMERA_CROWN = 0.45;
const CAMERA_FLOOR = 1.1;
/**
 * The highest a camera rides inside, over the road: under the jet fans, the
 * lane signals and the luminaires, which a camera at the follow shot's 5.6 m
 * passed close enough under to fill the frame.
 */
const CAMERA_INSIDE_TOP = 4.6;

/**
 * Keeps a camera out of the hill and the tunnel's structure. A camera that
 * would be inside the hill, between the portals, is inside the tunnel: kept
 * off the walls and under the crown. Approaching a portal from outside, the
 * space it may use narrows to the opening. Anywhere else it stays
 * `clearance` metres above the ground - the hill's surface included - or the
 * sea. Mutates `position`.
 */
export function clampCamera(position: { x: number; y: number; z: number }, clearance: number): void {
  const { x, z } = position;
  if (ridgeRise(x, z) > 0) {
    const { distSq, along } = route.projectOnRoute(x, z);
    if (distSq < 12 * 12 && along > TUNNEL.from - 9 && along < TUNNEL.to + 9) {
      const lateral = lateralOf(x, z, along);
      const road = roadY(along);
      const hill = hillSurface(x, z);
      const inside = along > TUNNEL.from && along < TUNNEL.to;
      if (inside && hill !== null && position.y < hill) {
        const v = clamp(lateral, -(P.radius - CAMERA_WALL), P.radius - CAMERA_WALL);
        const sample = route.at(along);
        position.x = sample.x - sample.tz * v;
        position.z = sample.z + sample.tx * v;
        position.y = clamp(position.y, road + CAMERA_FLOOR, road + Math.min(CAMERA_INSIDE_TOP, ceilingAt(v) - CAMERA_CROWN));
        return;
      }
      if (!inside && position.y < road + 8) {
        // In front of a face: the opening is the way in.
        const out = along < TUNNEL.from ? TUNNEL.from - along : along - TUNNEL.to;
        const allowed = P.radius - CAMERA_WALL + (P.wingIn0 - 0.8 - (P.radius - CAMERA_WALL)) * smoothstep(0, 8, out);
        if (Math.abs(lateral) > allowed) {
          const v = clamp(lateral, -allowed, allowed);
          const sample = route.at(along);
          position.x = sample.x - sample.tz * v;
          position.z = sample.z + sample.tx * v;
        }
        // Down to the height it rides inside over the last ten metres, then free.
        const cap = road + CAMERA_INSIDE_TOP + smoothstep(0, 10, out) + 12 * smoothstep(10, 20, out);
        position.y = Math.min(position.y, cap);
        position.y = Math.max(position.y, Math.max(terrain.height(position.x, position.z), SEA_LEVEL) + Math.min(clearance, CAMERA_FLOOR));
        return;
      }
    }
  }
  keepAboveGround(position, clearance);
}

/** Keeps a camera `clearance` metres above the ground - the hill over the tunnel included - or the sea. */
export function keepAboveGround(position: { x: number; y: number; z: number }, clearance: number): void {
  const ground = Math.max(groundHeight(position.x, position.z), SEA_LEVEL) + clearance;
  if (position.y < ground) position.y = ground;
}

/**
 * How far a camera flight may take the camera from the rover at this place:
 * not at all inside the tunnel, easing off as the rover nears a portal - a
 * camera out at a mast when the rover goes in would come back through the
 * hill - and back once it is out. `direction` is the way the rover drives.
 */
export function flightAllowance(distance: number, direction: number): number {
  const entry = direction >= 0 ? TUNNEL.from : TUNNEL.to;
  const exit = direction >= 0 ? TUNNEL.to : TUNNEL.from;
  const toEntry = (entry - distance) * (direction >= 0 ? 1 : -1);
  const pastExit = (distance - exit) * (direction >= 0 ? 1 : -1);
  if (toEntry > 0) return smoothstep(8, 30, toEntry);
  if (pastExit < 0) return 0;
  return smoothstep(1, 8, pastExit);
}
