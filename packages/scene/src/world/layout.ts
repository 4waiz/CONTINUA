/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-947C6AEA2E7C */
/**
 * Where every decorative structure in the world stands.
 *
 * The access-network sites (dock, Wi-Fi, cellular, satellite) live in
 * `sites.ts` because the engine's coverage model reads the same positions from
 * `world.json`. Everything here is set dressing - buildings, planting, fences,
 * industry - and moving any of it cannot change a single measured number.
 *
 * All placements are deterministic: fixed coordinates, or positions derived
 * from the route, or a seeded scatter. The same build always produces the same
 * world, which is what keeps a captured frame reproducible.
 *
 * Yaw convention matches the props: 0 faces +X, and a positive yaw turns +X
 * toward -Z (a left turn about +Y), so a prop authored along +X placed with
 * `yaw = route.at(d).heading` points down the road.
 */

import { makeRandom } from '../math/noise';
import { onDockYard, PARKING, ROVER_GARAGE } from './dock';
import { route } from './route';
import { onForecourt } from './terminus';

export interface Placement {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale?: number;
}

/** A flattened building pad: terrain is levelled to `y` inside it. */
export interface Pad {
  readonly x: number;
  readonly z: number;
  /** Half extents along world X and Z. */
  readonly hx: number;
  readonly hz: number;
  /** Width of the slope back to natural ground. */
  readonly margin: number;
  /** What the pad is finished with, if anything beyond the prop's own slab. */
  readonly surface?: 'concrete' | 'asphalt';
}

/** A two-lane service road, drawn as a ribbon from the route to a building. */
export interface ServiceRoad {
  readonly points: readonly (readonly [number, number])[];
  readonly halfWidth: number;
}

const HALF_PI = Math.PI / 2;

/** A point beside the route: `lateral` > 0 is the +Z side when heading +X. */
export function besideRoute(distance: number, lateral: number, yawOffset = 0): Placement {
  const sample = route.at(distance);
  return {
    x: sample.x - sample.tz * lateral,
    z: sample.z + sample.tx * lateral,
    yaw: sample.heading + yawOffset,
  };
}

/** Route distance whose sample is closest to world X. */
export function distanceAtX(x: number): number {
  let best = 0;
  let bestError = Infinity;
  for (const sample of route.samples) {
    const error = Math.abs(sample.x - x);
    if (error < bestError) {
      bestError = error;
      best = sample.distance;
    }
  }
  return best;
}

function distanceToRoute(x: number, z: number): number {
  return Math.sqrt(route.distanceToRouteSq(x, z).distSq);
}

function insidePad(x: number, z: number, pads: readonly Pad[], grow = 0): boolean {
  return pads.some((pad) => Math.abs(x - pad.x) < pad.hx + grow && Math.abs(z - pad.z) < pad.hz + grow);
}

/** Panels along a straight run, each authored along +X and 3 m long. */
function fenceRun(x0: number, z0: number, x1: number, z1: number, gap?: (x: number, z: number) => boolean): Placement[] {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const length = Math.hypot(dx, dz);
  const count = Math.max(1, Math.round(length / 3));
  const yaw = Math.atan2(-dz, dx);
  const out: Placement[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    const x = x0 + dx * t;
    const z = z0 + dz * t;
    if (gap?.(x, z)) continue;
    out.push({ x, z, yaw, scale: 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The campus
// ---------------------------------------------------------------------------

/** Where the route leaves the campus through the gatehouse. */
export const GATE_DISTANCE = distanceAtX(228);
const GATE = besideRoute(GATE_DISTANCE, 0);

/** Campus perimeter (world X/Z); the route exits through the east side. */
export const CAMPUS = { minX: -132, maxX: 228, minZ: -104, maxZ: 112 } as const;

// ---------------------------------------------------------------------------
// Building pads
// ---------------------------------------------------------------------------

export const PADS: readonly Pad[] = [
  // Forecourt from the dock up to the operations centre's plaza.
  { x: -46, z: 31, hx: 25, hz: 27, margin: 10, surface: 'concrete' },
  // Gateway yard, open to the route.
  { x: -53, z: -24, hx: 24, hz: 22, margin: 10, surface: 'concrete' },
  { x: 43, z: 45, hx: 18, hz: 27, margin: 10, surface: 'concrete' }, // hangar + apron
  { x: 98, z: 56, hx: 19, hz: 14, margin: 10, surface: 'concrete' }, // response station
  { x: 140, z: 64, hx: 12, hz: 12, margin: 8 }, // helipad
  { x: 1, z: 34, hx: 14, hz: 12, margin: 8, surface: 'asphalt' }, // parking + carports
  { x: 294, z: 71, hx: 30, hz: 22, margin: 14, surface: 'concrete' }, // warehouse 1
  { x: 396, z: 78, hx: 30, hz: 22, margin: 14, surface: 'concrete' }, // warehouse 2
  { x: 292, z: -60, hx: 18, hz: 13, margin: 12 }, // substation
  { x: 438, z: -94, hx: 38, hz: 26, margin: 14, surface: 'concrete' }, // tank farm
  { x: 470, z: 70, hx: 7, hz: 7, margin: 8, surface: 'concrete' }, // stack
  { x: 810, z: 76, hx: 21, hz: 21, margin: 12 }, // ground station (compound sits rotated)
  { x: 744, z: 46, hx: 12, hz: 6, margin: 8 }, // solar field, south of the road
];

/** Access roads from the route to each building. Ends on the route overlap it. */
export const SERVICE_ROADS: readonly ServiceRoad[] = [
  { points: [[1, 1], [1, 22]], halfWidth: 3.2 }, // parking
  { points: [[40, -2], [40, 19]], halfWidth: 4.5 }, // hangar apron
  { points: [[100, -18], [100, 44]], halfWidth: 3.8 }, // response station
  { points: [[114, 47], [131, 58]], halfWidth: 2.6 }, // helipad
  { points: [[290, 20], [290, 50]], halfWidth: 4.2 }, // warehouse 1
  { points: [[392, -20], [392, 57]], halfWidth: 4.2 }, // warehouse 2
  { points: [[292, 13], [292, -47]], halfWidth: 3.2 }, // substation
  { points: [[432, -38], [432, -68]], halfWidth: 3.8 }, // tank farm
  { points: [[470, -35], [470, 63]], halfWidth: 3.0 }, // stack
];

// ---------------------------------------------------------------------------
// Placements, by prop node name
// ---------------------------------------------------------------------------

function buildLayout(): Record<string, Placement[]> {
  const random = makeRandom(20261003);
  const out: Record<string, Placement[]> = {};
  const add = (prop: string, ...items: Placement[]) => {
    (out[prop] ??= []).push(...items);
  };

  // --- campus buildings ------------------------------------------------------
  // Fronts face the route (-Z for buildings north of it, +Z for those south).
  add('PROP_Gateway', { x: -60, z: -38, yaw: -HALF_PI });
  add('PROP_ResponseStation', { x: 100, z: 60, yaw: HALF_PI });
  add('PROP_Helipad', { x: 140, z: 64, yaw: 0 });
  add('PROP_WaterTower', { x: 64, z: -66, yaw: 0.3 });
  add('PROP_Gatehouse', { x: GATE.x, z: GATE.z, yaw: GATE.yaw });

  // Flags before the operations centre's plaza.
  for (const x of [-52, -47, -42]) add('PROP_Flagpole', { x, z: 18.5, yaw: 0.35 });

  // Parking with two solar carports between the operations centre and the hangar.
  add('PROP_Carport', { x: 1, z: 28, yaw: 0 }, { x: 1, z: 40, yaw: 0 });
  const cars = ['PROP_Car_A', 'PROP_Car_B', 'PROP_Car_C', 'PROP_Van'];
  for (const [row, z] of [[0, 28], [1, 40]] as const) {
    for (let bay = 0; bay < 6; bay += 1) {
      if ((bay + row * 2) % 3 === 2) continue; // leave some bays empty
      const prop = cars[(bay * 3 + row) % cars.length]!;
      add(prop, { x: -6.5 + bay * 3, z: z + (row ? -0.3 : 0.3), yaw: HALF_PI + (random() - 0.5) * 0.06 });
    }
  }
  // A few cars outside the hangar and the response station.
  add('PROP_Van', { x: 30, z: 18, yaw: 0.1 }, { x: 118, z: 40, yaw: Math.PI - 0.05 });
  add('PROP_Car_B', { x: 76, z: 40, yaw: Math.PI / 2 + 0.04 });

  // The rover's garage, behind the dock on the line of the route (dock.ts),
  // and its staff parking: three of the four painted bays taken, nose in.
  add('PROP_RoverGarage', { x: ROVER_GARAGE.x, z: ROVER_GARAGE.z, yaw: 0 });
  const bayCentre = (bay: number) => PARKING.minX + PARKING.bay * (bay + 0.5);
  const parkedZ = (PARKING.minZ + PARKING.maxZ) / 2;
  add('PROP_Car_B', { x: bayCentre(0), z: parkedZ, yaw: HALF_PI + 0.03 });
  add('PROP_Van', { x: bayCentre(2), z: parkedZ + 0.2, yaw: HALF_PI - 0.02 });
  add('PROP_Car_A', { x: bayCentre(3), z: parkedZ - 0.1, yaw: HALF_PI + 0.05 });

  // Planters on the plaza. The dock's bollards are the dock's own
  // (world_industry.py), round its gantry and equipment, not out on a lawn.
  add('PROP_Planter', { x: -58, z: 22, yaw: 0 }, { x: -34, z: 22, yaw: 0 }, { x: -46, z: 13, yaw: 0 });
  // Raised flower beds along the dock yard's kerbs (dock.ts), where the yard
  // meets the lawn either side.
  add(
    'PROP_FlowerBed',
    { x: -25.0, z: -14.4, yaw: 0 },
    { x: -18.4, z: -14.4, yaw: 0 },
    { x: -17.6, z: 14.4, yaw: 0 },
  );

  // Container yards: some stacked two high (scale 1, lifted in the runtime by `stack`).
  for (const [cx, cz, count] of [
    [74, 72, 4],
    [130, -64, 5],
    [196, 58, 4],
    [336, 48, 3],
  ] as const) {
    for (let i = 0; i < count; i += 1) {
      add('PROP_Container', {
        x: cx + (i % 2) * 6.6 + random() * 0.6,
        z: cz + Math.floor(i / 2) * 2.9,
        yaw: (random() - 0.5) * 0.05,
      });
    }
  }

  // --- the fence around the campus, open where the route passes ---------------
  const nearRoute = (x: number, z: number) => distanceToRoute(x, z) < 11;
  const { minX, maxX, minZ, maxZ } = CAMPUS;
  add(
    'PROP_Fence',
    ...fenceRun(minX, minZ, maxX, minZ, nearRoute),
    ...fenceRun(maxX, minZ, maxX, maxZ, nearRoute),
    ...fenceRun(maxX, maxZ, minX, maxZ, nearRoute),
    ...fenceRun(minX, maxZ, minX, minZ, nearRoute),
  );

  // --- planting -----------------------------------------------------------------
  // A palm avenue down the campus road, and palms framing the plaza.
  for (let d = 26; d < GATE_DISTANCE - 14; d += 26) {
    add('PROP_Palm', { ...besideRoute(d, 12.5), scale: 0.9 + random() * 0.25 });
    add('PROP_Palm', { ...besideRoute(d + 13, -12.5), scale: 0.9 + random() * 0.25 });
  }
  for (const x of [-64, -60, -32, -28]) add('PROP_Palm', { x, z: 25, yaw: random() * 6.28, scale: 1.05 });

  // A screening belt of broadleaf trees inside the perimeter fence, the way a
  // real facility is planted: it frames the campus from the air and gives the
  // lawns an edge. Two staggered rows, gaps where the road and pads are.
  const belt = (x0: number, z0: number, x1: number, z1: number, inward: [number, number]) => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    for (let s = 6; s < length - 6; s += 8.5) {
      for (const row of [0, 1]) {
        const t = (s + row * 4.2) / length;
        const depth = 7 + row * 6 + (random() - 0.5) * 2.5;
        const x = x0 + (x1 - x0) * t + inward[0] * depth;
        const z = z0 + (z1 - z0) * t + inward[1] * depth;
        if (distanceToRoute(x, z) < 16 || insidePad(x, z, PADS, 8)) continue;
        if (random() < 0.12) continue;
        const kind = random();
        const prop = kind < 0.8 ? 'PROP_Ghaf' : kind < 0.92 ? 'PROP_FlameTree' : 'PROP_Jacaranda';
        add(prop, { x, z, yaw: random() * 6.28, scale: 0.8 + random() * 0.35 });
      }
    }
  };
  belt(minX, minZ, maxX, minZ, [0, 1]);
  belt(minX, maxZ, maxX, maxZ, [0, -1]);
  belt(minX, minZ, minX, maxZ, [1, 0]);

  // Ghaf trees: shade in the campus, scattered thinly outside it.
  const ghafSpots: [number, number][] = [
    [-100, 60], [-112, 18], [-96, -70], [-20, -60], [20, 84], [150, 20], [168, -40], [204, -86],
  ];
  for (const [x, z] of ghafSpots) add('PROP_Ghaf', { x, z, yaw: random() * 6.28, scale: 0.85 + random() * 0.4 });

  // Flame trees and jacarandas on the campus lawns: the island's colour.
  const flowering: [string, number, number][] = [
    ['PROP_FlameTree', -112, -62], ['PROP_Jacaranda', -98, -90], ['PROP_FlameTree', -14, -82],
    ['PROP_Jacaranda', 14, -52], ['PROP_FlameTree', 36, -90], ['PROP_Jacaranda', 104, -88],
    ['PROP_FlameTree', 152, -84], ['PROP_Jacaranda', 186, -34], ['PROP_FlameTree', 214, -72],
    ['PROP_Jacaranda', -112, 84], ['PROP_FlameTree', -84, 96], ['PROP_Jacaranda', -6, 92],
    ['PROP_FlameTree', 66, 100], ['PROP_FlameTree', 160, 96], ['PROP_Jacaranda', 212, 96],
  ];
  for (const [prop, x, z] of flowering) add(prop, { x, z, yaw: random() * 6.28, scale: 0.85 + random() * 0.3 });

  // Bedding along the campus road out of the dock, clear of the service-road
  // junctions; each bed lies along the road.
  const junctions = SERVICE_ROADS.map((road) => road.points[0]![0]);
  for (let d = 30; d < GATE_DISTANCE - 18; d += 12) {
    for (const side of [1, -1]) {
      const at = besideRoute(d, side * 8.6);
      if (junctions.some((x) => Math.abs(at.x - x) < 9)) continue;
      add('PROP_FlowerBed', at);
    }
  }

  // Bougainvillea inside the fence, at the gatehouse and round the plaza.
  const bushes = ['PROP_FlowerBush_Magenta', 'PROP_FlowerBush_Coral', 'PROP_FlowerBush_Yellow', 'PROP_FlowerBush_White'];
  let bush = 0;
  const addBush = (x: number, z: number) => {
    if (distanceToRoute(x, z) < 10 || insidePad(x, z, PADS, 1)) return;
    add(bushes[bush % bushes.length]!, { x, z, yaw: random() * 6.28, scale: 0.85 + random() * 0.4 });
    bush += 1;
  };
  for (let x = CAMPUS.minX + 10; x < CAMPUS.maxX - 8; x += 17) {
    addBush(x + random() * 4, CAMPUS.minZ + 3.5);
    addBush(x + random() * 4, CAMPUS.maxZ - 3.5);
  }
  for (const lateral of [-13, -17, 13, 17]) {
    const at = besideRoute(GATE_DISTANCE - 10, lateral);
    addBush(at.x, at.z);
  }
  for (const [x, z] of [[-70, 12], [-22, 12], [-66, 50], [-26, 50]] as const) addBush(x, z);

  // --- the corridor: halls, tank farm, rack, substation, stack, power line ----------
  add('PROP_Warehouse', { x: 290, z: 75, yaw: HALF_PI }, { x: 392, z: 82, yaw: HALF_PI });
  add('PROP_Substation', { x: 292, z: -60, yaw: 0 });
  add('PROP_Stack', { x: 470, z: 70, yaw: 0 });
  add(
    'PROP_Tank_Large',
    { x: 418, z: -86, yaw: 0.2 },
    { x: 446, z: -86, yaw: 1.1 },
  );
  add('PROP_Tank_Small', { x: 418, z: -112, yaw: 0.5 }, { x: 438, z: -112, yaw: 2.2 });
  // Containment bund around the four storage tanks; its step-over meets the
  // tank-farm service road at x = 432.
  add('PROP_Bund', { x: 431, z: -96, yaw: 0 });
  add('PROP_Tank_Sphere', { x: 466, z: -104, yaw: 0.4 });

  // Pipe rack along the south side of the corridor road.
  for (let d = distanceAtX(262); d < distanceAtX(470); d += 12) {
    add('PROP_PipeRack', besideRoute(d, -19));
  }

  // A transmission line south of the corridor - tall, so it reads at distance -
  // kept inland of the beach, and ending before the coast swings in toward the road.
  for (let i = 0; i < 6; i += 1) {
    const x = 120 + i * 78;
    add('PROP_Pylon', { x, z: -142 - 6 * Math.sin(i * 0.9), yaw: 0.06 });
  }

  // Jersey barriers: one continuous line between the carriageway and the pipe
  // rack, laid end to end the way they are actually used, and broken only where
  // a service road crosses it. Spaced out every few metres they read as debris.
  const crossings = SERVICE_ROADS.map((road) => ({ x: road.points[0]![0], clear: road.halfWidth + 2.5 }));
  for (let d = distanceAtX(258); d < distanceAtX(474); d += 3.04) {
    const at = besideRoute(d, -6.4);
    if (crossings.some((road) => Math.abs(at.x - road.x) < road.clear)) continue;
    add('PROP_Barrier', at);
  }

  // --- the waterfront: jetty below the campus, lifeguard towers, lighthouse --------------
  // The jetty starts at the waterline and runs out to sea (its +X turned south).
  add('PROP_Jetty', { x: 60, z: -176, yaw: HALF_PI });
  add('PROP_LifeguardTower', { x: 150, z: -174, yaw: HALF_PI }, { x: -40, z: -152, yaw: HALF_PI });
  // On the headland's high ground, looking out to the south-east.
  add('PROP_Lighthouse', { x: 985, z: -95, yaw: Math.PI / 4 });

  // --- the remote sector: pipeline, valve station, turbines, solar ----------------
  const valveDistance = distanceAtX(700);
  for (let d = distanceAtX(486); d < route.length - 24; d += 12) {
    if (Math.abs(d - valveDistance) < 14) continue;
    add('PROP_Pipeline', besideRoute(d, 27));
  }
  add('PROP_ValveStation', besideRoute(valveDistance, 27));
  add('PROP_SolarField', { x: 744, z: 46, yaw: 0 });
  for (const [x, z] of [
    [600, -230], [690, -262], [780, -238], [872, -270], [960, -228], [1010, 170], [1092, 118], [1150, 230],
  ] as const) {
    add('PROP_WindTurbine', { x, z, yaw: 0.35 });
  }

  // --- light poles and signs --------------------------------------------------------
  for (let d = 18; d < distanceAtX(450); d += 46) {
    const side = Math.round(d / 46) % 2 === 0 ? 1 : -1;
    // The arm is authored along +X; turn it to reach back over the road.
    add('PROP_LightPole', besideRoute(d, side * 9.2, side > 0 ? HALF_PI : -HALF_PI));
  }
  // Sign faces are authored on +X; turn them to face oncoming traffic.
  // The last stands past the ridge tunnel's exit cut (tunnel.ts).
  for (const [d, lateral] of [[96, 8.6], [238, -8.6], [452, 8.6], [656, -8.6]] as const) {
    add('PROP_RoadSign', besideRoute(d, lateral, Math.PI));
  }

  // --- distant city to the west: the journey starts in town -------------------------
  const towers = ['PROP_Skyline_A', 'PROP_Skyline_B', 'PROP_Skyline_C'];
  for (let i = 0; i < 16; i += 1) {
    const x = -470 - random() * 110;
    const z = -170 + i * 30 + (random() - 0.5) * 14;
    add(towers[i % towers.length]!, { x, z, yaw: (random() - 0.5) * 0.3, scale: 0.65 + random() * 0.6 });
  }

  // --- rocks and scrub, kept clear of roads and pads --------------------------------
  const pads = PADS;
  for (let i = 0; i < 520; i += 1) {
    const x = 150 + random() * 1050;
    const z = -440 + random() * 900;
    if (distanceToRoute(x, z) < 14 || insidePad(x, z, pads, 6)) continue;
    if (x < CAMPUS.maxX + 6 && z > CAMPUS.minZ - 6 && z < CAMPUS.maxZ + 6) continue;
    const remote = x > 430;
    const bucket = random();
    const placement = { x, z, yaw: random() * Math.PI * 2, scale: 0.6 + random() * 0.9 };
    if (remote && bucket < 0.12) add('PROP_Rock_A', placement);
    else if (remote && bucket < 0.2) add('PROP_Rock_B', placement);
    else if (remote && bucket < 0.23) add('PROP_Rock_C', placement);
    else if (bucket < 0.55) add('PROP_Shrub_A', placement);
    else if (bucket < 0.78) add('PROP_Shrub_B', placement);
    else add(bushes[Math.floor(random() * bushes.length)]!, placement);
  }
  // Copses: trees in a landscape stand together, not one per field. Broadleaf
  // woods with flowering trees at their edges and scrub around the margins,
  // north of the corridor, south of it past the power line, and on the headland.
  const WOODS: readonly (readonly [number, number, number])[] = [
    [300, 190, 50], [420, 262, 60], [540, 172, 45], [640, 282, 55], [760, 240, 50], [880, 192, 45],
    [980, 282, 40], [360, 330, 35], [600, -112, 40], [700, -150, 35], [820, -112, 42], [930, -62, 38],
    [1000, 58, 35],
  ];
  for (const [cx, cz, radius] of WOODS) {
    const count = Math.round((radius * radius) / 90);
    const lobes = random() * 6.28;
    for (let i = 0; i < count; i += 1) {
      const angle = random() * Math.PI * 2;
      // An irregular outline: three lobes, not a disc.
      const reach = radius * Math.sqrt(random()) * (0.78 + 0.22 * Math.sin(angle * 3 + lobes));
      const x = cx + Math.cos(angle) * reach;
      const z = cz + Math.sin(angle) * reach;
      if (distanceToRoute(x, z) < 24 || insidePad(x, z, pads, 10)) continue;
      const kind = random();
      const edge = reach / radius > 0.68;
      const prop = edge && kind < 0.14 ? 'PROP_FlameTree' : edge && kind < 0.24 ? 'PROP_Jacaranda' : 'PROP_Ghaf';
      add(prop, { x, z, yaw: random() * 6.28, scale: 0.85 + random() * 0.45 });
    }
    for (let i = 0; i < count * 0.45; i += 1) {
      const angle = random() * Math.PI * 2;
      const reach = radius * (1.0 + random() * 0.3);
      const x = cx + Math.cos(angle) * reach;
      const z = cz + Math.sin(angle) * reach;
      if (distanceToRoute(x, z) < 16 || insidePad(x, z, pads, 6)) continue;
      add(random() < 0.6 ? 'PROP_Shrub_B' : 'PROP_Shrub_A', { x, z, yaw: random() * 6.28, scale: 0.9 + random() * 0.6 });
    }
  }
  // Single trees across the meadows, with flowering trees among them.
  for (let i = 0; i < 100; i += 1) {
    const x = 240 + random() * 840;
    const z = -330 + random() * 680;
    if (distanceToRoute(x, z) < 22 || insidePad(x, z, pads, 10)) continue;
    const kind = random();
    const prop = kind < 0.72 ? 'PROP_Ghaf' : kind < 0.88 ? 'PROP_FlameTree' : 'PROP_Jacaranda';
    add(prop, { x, z, yaw: random() * 6.28, scale: 0.8 + random() * 0.5 });
  }

  // Nothing grows on the forecourt where the road ends (terminus.ts), nor on
  // the dock yard (dock.ts). Taken out after the fact, so every other
  // placement - and the seeded sequence that made them - is as it was.
  for (const [prop, list] of Object.entries(out)) {
    if (!/^PROP_(Rock|Shrub|Ghaf|FlameTree|Jacaranda|Palm|FlowerBush|FlowerBed)/.test(prop)) continue;
    out[prop] = list.filter((item) => !onForecourt(item.x, item.z, 2.5) && !onDockYard(item.x, item.z));
  }

  return out;
}

export const WORLD_LAYOUT: Readonly<Record<string, readonly Placement[]>> = buildLayout();

/** Props whose rotor turns: [tower node, rotor node, hub offset in the tower frame (x, y, z)]. */
export const TURBINE = {
  tower: 'PROP_WindTurbine',
  rotor: 'PROP_WindTurbine_Rotor',
  /** Hub centre relative to the tower base, in the prop's own frame (glTF: x, y up, z). */
  hub: [2.6, 62.0, 0.0] as const,
  /** Rotor speed, rad/s. Slow and constant: a deterministic function of time. */
  speed: 0.9,
} as const;

/**
 * Conductor attachment points on a pylon as (across, height). The arms are
 * authored along Blender Y, which the glTF exporter maps to local -Z, so a
 * point's local position is (0, height, -across).
 */
export const PYLON_CONDUCTORS: readonly (readonly [number, number])[] = [
  [-6.3, 20.6],
  [6.3, 20.6],
  [-4.8, 26.1],
  [4.8, 26.1],
  [-3.4, 30.1],
  [3.4, 30.1],
];
