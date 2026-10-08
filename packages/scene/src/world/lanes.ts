/**
 * Two rovers on one road.
 *
 * When a run is shown with the normal rover beside it, both are drawn:
 * CONTINUA starts in the dock's bay (DOCK 01) and pulls into the lane on the
 * dock's equipment side; the normal rover starts in the second bay (DOCK 02,
 * across the route from the equipment) and pulls into the other lane. On the
 * road the two drive abreast, a lane each, so they never overlap.
 *
 * Shapes only: a rover's lane is a sideways offset from the route's centre
 * line, a function of where it is along the route. Where along the route it
 * is stays the engine's (or, while its link is down, the hold's - see
 * `EngineSceneStateSource`).
 */

import { clamp } from '../math/noise';

/** Which of the two rovers: the run on screen, or the normal rover beside it. */
export type RoverLane = 'main' | 'companion';

export const LANES = {
  /** Sideways offset of each lane's centre from the route's centre line, metres. */
  offset: 1.75,
  /**
   * The second bay's centre, metres from the route's centre line, on the side
   * away from the dock's equipment. Far enough that the two bays' gantries
   * stand clear of each other (each leg is 3.05 m out, on a 0.9 m plinth).
   */
  bayTwo: -7.4,
  /**
   * Route metres over which a rover pulls out of its bay into its lane. Done
   * by the yard's mouth: the kerb curves in to the road's edge 19 m along, and
   * the normal rover, coming from the far bay, has to be inside it by then.
   */
  from: 2,
  to: 16,
} as const;

/** Smoother at both ends than smoothstep: a rover that eases into its lane. */
function smoother(x: number): number {
  const c = clamp(x, 0, 1);
  return c * c * c * (c * (c * 6 - 15) + 10);
}

function smootherSlope(x: number): number {
  if (x <= 0 || x >= 1) return 0;
  return 30 * x * x * (x - 1) * (x - 1);
}

function smootherCurve(x: number): number {
  if (x <= 0 || x >= 1) return 0;
  return 60 * x * (x - 1) * (2 * x - 1);
}

/**
 * The lane's sideways offset at a place on the route, metres - positive toward
 * the route's left normal (-tz, tx), the dock's equipment side - with how fast
 * it changes per metre along the route (for the rover's heading) and how fast
 * that changes (for its steering).
 */
export function laneOffset(lane: RoverLane, along: number): { offset: number; slope: number; curve: number } {
  const span = LANES.to - LANES.from;
  const x = (along - LANES.from) / span;
  const start = lane === 'main' ? 0 : LANES.bayTwo;
  const end = lane === 'main' ? LANES.offset : -LANES.offset;
  return {
    offset: start + (end - start) * smoother(x),
    slope: ((end - start) * smootherSlope(x)) / span,
    curve: ((end - start) * smootherCurve(x)) / (span * span),
  };
}
