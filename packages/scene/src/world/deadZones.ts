/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-9F2B7F5EC1C4 */
/**
 * Dead zones: where a scenario shadows the radio links, and the walls that
 * show why.
 *
 * A `shadow` fault in a scenario (engine `sim/exogenous.py`) scales a link's
 * coverage down over a stretch of *route* - `from_m` to `to_m` from the
 * route's forward start, eased in and out over `ramp_m` - so it is at the same
 * place on every run, at any speed and in either direction. The engine models
 * it as terrain; nothing in the world showed it, so the rover lost Wi-Fi and
 * the cell together on an open road for no reason anyone could see.
 *
 * The world now shows the obstruction the model stands for: a walled lane -
 * precast blast-wall panels on both sides of the road, open to the sky. Walls
 * at the roadside block the masts and towers beside the route; the satellite,
 * 45 degrees up, still sees the rover. They stand only where a scenario says
 * the shadow is, and only in that scenario: the eight original scenarios have
 * none, and their world is unchanged.
 */

import type { AccessNetworkId } from '@continua/contracts';
import { GATE_DISTANCE } from './layout';
import { route } from './route';

export interface DeadZone {
  /** Route metres from the forward start where the shadow is at full depth. */
  readonly from: number;
  readonly to: number;
  /** Metres over which it eases in before `from` and out after `to`. */
  readonly ramp: number;
  /** The links it shadows. */
  readonly links: readonly AccessNetworkId[];
}

/** A scenario fault as the engine's catalogue states it. */
export interface ShadowFaultLike {
  readonly kind: string;
  readonly link: string;
  readonly from_m?: number;
  readonly to_m?: number;
  readonly ramp_m?: number;
}

export const NO_DEAD_ZONES: readonly DeadZone[] = Object.freeze([]);

/**
 * A scenario's dead zones, one per stretch: faults on the same stretch (Wi-Fi
 * and the cell shadowed together) are one obstruction, not two.
 */
export function deadZonesFromFaults(faults: readonly ShadowFaultLike[] | undefined): readonly DeadZone[] {
  if (!faults) return NO_DEAD_ZONES;
  const byStretch = new Map<string, { from: number; to: number; ramp: number; links: AccessNetworkId[] }>();
  for (const fault of faults) {
    if (fault.kind !== 'shadow' || fault.from_m === undefined || fault.to_m === undefined) continue;
    const key = `${fault.from_m}:${fault.to_m}`;
    const entry = byStretch.get(key) ?? { from: fault.from_m, to: fault.to_m, ramp: fault.ramp_m ?? 0, links: [] };
    entry.ramp = Math.max(entry.ramp, fault.ramp_m ?? 0);
    if (!entry.links.includes(fault.link as AccessNetworkId)) entry.links.push(fault.link as AccessNetworkId);
    byStretch.set(key, entry);
  }
  if (byStretch.size === 0) return NO_DEAD_ZONES;
  return [...byStretch.values()].sort((a, b) => a.from - b.from);
}

/** Wall panels: precast T-walls, 1.52 m wide, set 3 cm apart. */
export const WALL = {
  /** Panel width along the road and the pitch it is laid at, metres. */
  width: 1.52,
  pitch: 1.55,
  /** Height of the stem above the footing's underside. */
  height: 6.0,
  /** Lateral offset of the stem's road face from the centreline. Clear of the
   *  road (half-width 3.9) and its gravel verge (5.5), and of the close-up and
   *  alongside cameras (~5.2 m and 6.4 m out); inside the campus bedding. */
  lateral: 7.2,
  /** How far the panels are sunk, so uneven ground never shows a gap. */
  sink: 0.2,
} as const;

/** The gatehouse canopy spans the road here; the lane stops at its columns. */
const GATE_GAP: readonly [number, number] = [GATE_DISTANCE - 5.3, GATE_DISTANCE + 5.3];

export interface WallRun {
  /** Route metres where this run of wall begins and ends. */
  readonly from: number;
  readonly to: number;
}

/**
 * The stretches of wall the zones need: each zone's full depth and half of
 * each ramp - the signal fades as the rover drives in, as it would behind a
 * real wall - split where the gatehouse canopy spans the road.
 */
export function wallRuns(zones: readonly DeadZone[]): WallRun[] {
  const runs: WallRun[] = [];
  for (const zone of zones) {
    const start = Math.max(0, zone.from - zone.ramp / 2);
    const end = Math.min(route.length, zone.to + zone.ramp / 2);
    const pieces: [number, number][] =
      end <= GATE_GAP[0] || start >= GATE_GAP[1]
        ? [[start, end]]
        : [
            [start, Math.min(end, GATE_GAP[0])],
            [Math.max(start, GATE_GAP[1]), end],
          ];
    for (const [from, to] of pieces) if (to - from >= WALL.pitch * 2) runs.push({ from, to });
  }
  return runs;
}

/**
 * How tall the wall stands at a point of its run, as a share of its full
 * height: full along the run, stepping down over the last few metres at each
 * end, the way a retaining wall's wings come down to meet the ground.
 */
export function wallTaper(run: WallRun, distance: number): number {
  const wing = Math.min(6, (run.to - run.from) / 3);
  const into = Math.min(distance - run.from, run.to - distance);
  const x = Math.max(0, Math.min(1, into / wing));
  return 0.38 + 0.62 * x * x * (3 - 2 * x);
}

export interface WallPanel {
  /** Route metres of the panel's centre. */
  readonly distance: number;
  /** +1 on the +Z side of the road (the driver's right heading +X), -1 on the other. */
  readonly side: 1 | -1;
  /** The first or last panel of a run of wall. */
  readonly end: boolean;
  /** Its height as a share of `WALL.height`: the wings step down. */
  readonly height: number;
}

/** Every panel the zones need, both sides, laid along the route. */
export function wallPanels(zones: readonly DeadZone[]): WallPanel[] {
  const panels: WallPanel[] = [];
  for (const run of wallRuns(zones)) {
    const count = Math.max(0, Math.floor((run.to - run.from) / WALL.pitch));
    const offset = run.from + (run.to - run.from - count * WALL.pitch) / 2;
    for (const side of [1, -1] as const) {
      for (let i = 0; i < count; i += 1) {
        const distance = offset + WALL.pitch * (i + 0.5);
        // Stepped, not sloped: each panel stands at the taper of its centre,
        // rounded to a 0.6 m course.
        const height = Math.round((wallTaper(run, distance) * WALL.height) / 0.6) * 0.6 / WALL.height;
        panels.push({ distance, side, end: i === 0 || i === count - 1, height });
      }
    }
  }
  return panels;
}

/** Whether a route position lies within any zone's walls, with a margin. */
export function withinDeadZone(distance: number, zones: readonly DeadZone[], margin = 0): boolean {
  return zones.some((zone) => distance >= zone.from - zone.ramp / 2 - margin && distance <= zone.to + zone.ramp / 2 + margin);
}
