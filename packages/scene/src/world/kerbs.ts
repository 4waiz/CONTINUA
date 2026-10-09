/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-964E1D67F576 */
/**
 * Kerbs: where paving meets grass.
 *
 * Every paved surface - the building pads, the dock yard, the forecourt where
 * the road ends - used to stop flush against the lawn: a grey shape laid on
 * green. A precast kerb now runs along each edge that meets grass, and
 * nowhere else - not where one surface runs into another, nor across a road
 * or a service road that enters it.
 *
 * Runs are found by walking each surface's outline and asking, just outside
 * every half-metre of it, whether the ground there is paved. The kerb stands
 * on the grass side of the edge, so a surface keeps its full size. Pure data
 * in world X/Z; `Ground.tsx` builds the geometry.
 */

import { clamp } from '../math/noise';
import { DOCK_YARD, ROAD_START, ROVER_GARAGE, dockYardOutline, insideLoop } from './dock';
import { PADS, SERVICE_ROADS } from './layout';
import { ROAD_HALF_WIDTH, ROAD_SURFACE_OFFSET, SHOULDER_HALF_WIDTH } from './carriageway';
import { route } from './route';
import { FORECOURT, TURNING_CIRCLE, forecourtDistance } from './terminus';

export const KERB = {
  /** Across the top, metres. */
  width: 0.3,
  /** Above the paving beside it. */
  height: 0.12,
  /** How far outside an edge the ground is tested. */
  probe: 0.45,
  /** Outline sampling, metres. */
  step: 0.5,
} as const;

type Point = [number, number];

export interface KerbPoint {
  readonly x: number;
  readonly z: number;
  /** Unit outward normal, toward the grass. */
  readonly nx: number;
  readonly nz: number;
  /** Mitre: how far to push the kerb's far side out along the normal per metre of width. */
  readonly mitre: number;
}

export interface KerbRun {
  readonly points: readonly KerbPoint[];
  /** The paving's height above the terrain. */
  readonly level: number;
  /** A whole outline: the last point joins the first. */
  readonly closed: boolean;
}

/** Paving: the surfaces that carry a finish, at the heights `Ground.tsx` lays them. */
const PAD_LEVEL = 0.035;
const SURFACED_PADS = PADS.filter((pad) => pad.surface);
const YARD = dockYardOutline();

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

/** Whether the ground at a point is paved, or road, rather than grass. */
export function paved(x: number, z: number): boolean {
  if (insideLoop(YARD, x, z)) return true;
  // The garage's floor runs on from the yard: no kerb across its door.
  if (Math.abs(x - ROVER_GARAGE.x) < ROVER_GARAGE.hx && Math.abs(z - ROVER_GARAGE.z) < ROVER_GARAGE.hz) return true;
  if (SURFACED_PADS.some((pad) => Math.abs(x - pad.x) < pad.hx && Math.abs(z - pad.z) < pad.hz)) return true;
  if (forecourtDistance(x, z) < 0) return true;
  if (Math.hypot(x - TURNING_CIRCLE.x, z - TURNING_CIRCLE.z) < TURNING_CIRCLE.radius) return true;
  const { distSq, along } = route.projectOnRoute(x, z);
  const off = Math.sqrt(distSq);
  // The carriageway from the yard's mouth; its gravel verges from where the
  // kerb's curve into the road ends.
  if (along >= ROAD_START && off < ROAD_HALF_WIDTH + 0.05) return true;
  if (along >= ROAD_START + DOCK_YARD.flare && off < SHOULDER_HALF_WIDTH + 0.05) return true;
  return nearServiceRoad(x, z, 0.05);
}

function signedArea(loop: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const [x0, z0] = loop[i]!;
    const [x1, z1] = loop[(i + 1) % loop.length]!;
    sum += x0 * z1 - x1 * z0;
  }
  return sum / 2;
}

function rectangle(cx: number, cz: number, hx: number, hz: number): Point[] {
  return [
    [cx - hx, cz - hz],
    [cx + hx, cz - hz],
    [cx + hx, cz + hz],
    [cx - hx, cz + hz],
  ];
}

function capsule(a: { x: number; z: number }, b: { x: number; z: number }, radius: number): Point[] {
  const heading = Math.atan2(b.z - a.z, b.x - a.x);
  const out: Point[] = [];
  const steps = 28;
  for (const [centre, from] of [[b, heading - Math.PI / 2], [a, heading + Math.PI / 2]] as const) {
    for (let i = 0; i <= steps; i += 1) {
      const angle = from + (Math.PI * i) / steps;
      out.push([centre.x + radius * Math.cos(angle), centre.z + radius * Math.sin(angle)]);
    }
  }
  return out;
}

/**
 * Walk one outline: sample it every `KERB.step`, test the ground just outside
 * each sample, and return the stretches that face grass.
 */
function kerbsAlong(outline: readonly Point[], level: number): KerbRun[] {
  // Counter-clockwise in (x, z), so the outward normal of an edge (dx, dz) is (dz, -dx).
  const loop = signedArea(outline) < 0 ? [...outline].reverse() : [...outline];
  const samples: { x: number; z: number; nx: number; nz: number; corner: boolean }[] = [];
  for (let i = 0; i < loop.length; i += 1) {
    const [x0, z0] = loop[i]!;
    const [x1, z1] = loop[(i + 1) % loop.length]!;
    const length = Math.hypot(x1 - x0, z1 - z0);
    if (length < 1e-6) continue;
    const nx = (z1 - z0) / length;
    const nz = -(x1 - x0) / length;
    const count = Math.max(1, Math.ceil(length / KERB.step));
    for (let k = 0; k < count; k += 1) {
      const t = k / count;
      samples.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, nx, nz, corner: k === 0 });
    }
  }
  const n = samples.length;
  // Segment i runs from sample i to sample i + 1; it is kerbed if the ground
  // just outside its middle is grass.
  const kerbed = samples.map((sample, i) => {
    const next = samples[(i + 1) % n]!;
    const mx = (sample.x + next.x) / 2 + sample.nx * KERB.probe;
    const mz = (sample.z + next.z) / 2 + sample.nz * KERB.probe;
    return !paved(mx, mz);
  });

  const point = (i: number): KerbPoint => {
    // The normal at a sample is the mean of the segments either side; the
    // mitre keeps the kerb's width where the outline turns a corner.
    const here = samples[i % n]!;
    const before = samples[(i - 1 + n) % n]!;
    let nx = here.nx + before.nx;
    let nz = here.nz + before.nz;
    const length = Math.hypot(nx, nz) || 1;
    nx /= length;
    nz /= length;
    const cos = Math.max(0.35, nx * here.nx + nz * here.nz);
    return { x: here.x, z: here.z, nx, nz, mitre: 1 / cos };
  };
  const endPoint = (i: number, useNext: boolean): KerbPoint => {
    // A run's ends take their own segment's normal: no mitre into a neighbour
    // that has no kerb.
    const segment = samples[(useNext ? i - 1 + n : i) % n]!;
    const at = samples[i % n]!;
    return { x: at.x, z: at.z, nx: segment.nx, nz: segment.nz, mitre: 1 };
  };

  if (kerbed.every(Boolean)) {
    return [{ points: samples.map((_, i) => point(i)), level, closed: true }];
  }
  const runs: KerbRun[] = [];
  // Start just after a gap so no run is split across the loop's seam.
  const first = kerbed.findIndex((value, i) => value && !kerbed[(i - 1 + n) % n]);
  if (first < 0) return runs;
  for (let offset = 0; offset < n; ) {
    const i = (first + offset) % n;
    if (!kerbed[i]) {
      offset += 1;
      continue;
    }
    const points: KerbPoint[] = [endPoint(i, false)];
    let j = offset;
    while (j < n && kerbed[(first + j) % n]) j += 1;
    const last = first + j; // the sample at the end of the last kerbed segment
    for (let k = first + offset + 1; k < last; k += 1) {
      const sample = samples[k % n]!;
      // Interior points: every corner of the outline, and every fourth sample
      // along a straight edge, which is all the ground's flatness needs.
      if (sample.corner || (k - first) % 4 === 0) points.push(point(k));
    }
    points.push(endPoint(last, true));
    runs.push({ points, level, closed: false });
    offset = j;
  }
  return runs;
}

/** Every kerb in the world. */
export function buildKerbRuns(): KerbRun[] {
  const runs: KerbRun[] = [];
  for (const pad of SURFACED_PADS) runs.push(...kerbsAlong(rectangle(pad.x, pad.z, pad.hx, pad.hz), PAD_LEVEL));
  runs.push(...kerbsAlong(YARD, ROAD_SURFACE_OFFSET));
  runs.push(...kerbsAlong(capsule(FORECOURT.a, FORECOURT.b, FORECOURT.radius), PAD_LEVEL));
  return runs;
}
