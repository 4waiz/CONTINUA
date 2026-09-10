/**
 * The Phase 1 scene-state source.
 *
 * Everything here is derived from route geometry and coverage distance. It is
 * an *illustration* of how a predictive handoff sequence looks, not a
 * measurement of one - `kind` is `'preview'` and the HUD is required to say so.
 * Phase 2 swaps this implementation for the real engine behind the same
 * `SceneStateSource` interface.
 *
 * `sampleAt(t)` is a pure function. Handoffs are resolved once, up front, over
 * the whole route, so scrubbing backwards yields exactly the same states as
 * playing forwards - which is what makes offline capture reproducible.
 */

import {
  ACCESS_NETWORKS,
  type AccessNetworkId,
  type Decision,
  type LinkState,
  type LinkStatus,
  type SceneState,
  type SceneStateSource,
  type Seconds,
} from '@continua/contracts';
import { clamp, lerp } from '../math/noise';
import { route } from '../world/route';
import { terrain } from '../world/terrain';
import { coverageAt, NETWORK_PRIORITY, USABLE_COVERAGE, zoneAtDistance } from '../world/sites';

export const VEHICLE = {
  wheelbase: 2.85,
  wheelRadius: 0.405,
  /** Cruise speed on straight road, m/s (~43 km/h). */
  cruiseSpeed: 12.0,
  /** How hard curvature slows the vehicle down. */
  curveSlowing: 26,
  minSpeed: 3.4,
  /** Seconds held stationary at the dock before undocking. */
  dockDwell: 5.0,
  /** Seconds of deceleration at the end of the route. */
  arrivalRamp: 6.0,
} as const;

/** Distance ahead of a handoff at which the target link is pre-warmed. */
const WARM_DISTANCE = 55;
/** Coverage needed to adopt a better link, and to abandon the current one. */
const ENTER_COVERAGE = 0.42;
const EXIT_COVERAGE = 0.2;
const DEGRADED_COVERAGE = 0.34;

interface Handoff {
  readonly distance: number;
  readonly from: AccessNetworkId | null;
  readonly to: AccessNetworkId;
  readonly reason: string;
  readonly confidence: number;
}

function speedAtDistance(distance: number): number {
  const sample = route.at(distance);
  const curveFactor = 1 / (1 + Math.abs(sample.curvature) * VEHICLE.curveSlowing);
  const launch = clamp(distance / 30, 0.25, 1);
  const arrival = clamp((route.length - distance) / 45, 0.22, 1);
  return Math.max(
    VEHICLE.minSpeed,
    VEHICLE.cruiseSpeed * curveFactor * Math.min(launch, arrival),
  );
}

export class PreviewSceneStateSource implements SceneStateSource {
  readonly kind = 'preview' as const;
  readonly runId: string;
  readonly duration: Seconds;

  /** distanceTable[i] = distance travelled at time i * TIME_STEP. */
  private readonly distanceTable: Float32Array;
  private static readonly TIME_STEP = 0.05;
  private readonly handoffs: readonly Handoff[];
  private readonly decisions: readonly Decision[];

  constructor(runId = 'CONTINUA-PREVIEW-01') {
    this.runId = runId;

    // --- integrate the speed profile into a time -> distance table ----------
    const step = PreviewSceneStateSource.TIME_STEP;
    const table: number[] = [];
    let distance = 0;
    let time = 0;
    while (distance < route.length && time < 900) {
      table.push(distance);
      const speed = time < VEHICLE.dockDwell ? 0 : speedAtDistance(distance);
      distance += speed * step;
      time += step;
    }
    table.push(route.length);
    this.distanceTable = Float32Array.from(table);
    this.duration = (this.distanceTable.length - 1) * step;

    this.handoffs = PreviewSceneStateSource.planHandoffs();
    this.decisions = this.handoffs.map((handoff, index) => ({
      id: `decision-${index + 1}`,
      at: this.timeAtDistance(handoff.distance),
      kind: 'steer' as const,
      from: handoff.from ?? undefined,
      to: handoff.to,
      reason: handoff.reason,
      confidence: handoff.confidence,
    }));
  }

  // -------------------------------------------------------------------------
  // Handoff planning - one forward pass, done once
  // -------------------------------------------------------------------------

  private static planHandoffs(): Handoff[] {
    const plan: Handoff[] = [];
    let active: AccessNetworkId | null = null;

    for (let distance = 0; distance <= route.length; distance += 1) {
      const sample = route.at(distance);
      const coverage = Object.fromEntries(
        ACCESS_NETWORKS.map((id) => [id, coverageAt(id, sample.x, sample.z)]),
      ) as Record<AccessNetworkId, number>;

      const usable = ACCESS_NETWORKS.filter((id) => coverage[id] >= USABLE_COVERAGE);
      if (usable.length === 0) continue;

      const best = usable.reduce((a, b) => (NETWORK_PRIORITY[a] <= NETWORK_PRIORITY[b] ? a : b));

      if (active === null) {
        plan.push({
          distance,
          from: null,
          to: best,
          reason: `Session established on ${best} at mission start.`,
          confidence: 0.99,
        });
        active = best;
        continue;
      }

      // `current` is annotated so TypeScript does not chase `active` through
      // its own re-assignment below when inferring these locals.
      const current: AccessNetworkId = active;
      const activeCoverage: number = coverage[current];
      const wantsBetter: boolean =
        NETWORK_PRIORITY[best] < NETWORK_PRIORITY[current] && coverage[best] >= ENTER_COVERAGE;
      const mustLeave: boolean = activeCoverage < EXIT_COVERAGE;

      if (!wantsBetter && !mustLeave) continue;

      // When forced off, fall to the best *remaining* option.
      const candidates: AccessNetworkId[] = usable.filter((id) => id !== current);
      if (candidates.length === 0) continue;
      const target: AccessNetworkId = wantsBetter
        ? best
        : candidates.reduce((a, b) => (NETWORK_PRIORITY[a] <= NETWORK_PRIORITY[b] ? a : b));
      if (target === current) continue;

      plan.push({
        distance,
        from: current,
        to: target,
        reason: mustLeave
          ? `${current} coverage fading; pre-warmed ${target} took the session with no drop.`
          : `${target} became available and is preferred over ${current}.`,
        confidence: mustLeave ? 0.9 : 0.96,
      });
      active = target;
    }
    return plan;
  }

  // -------------------------------------------------------------------------
  // Time <-> distance
  // -------------------------------------------------------------------------

  distanceAtTime(time: Seconds): number {
    const step = PreviewSceneStateSource.TIME_STEP;
    const clamped = clamp(time, 0, this.duration);
    const index = clamp(Math.floor(clamped / step), 0, this.distanceTable.length - 2);
    const t = clamped / step - index;
    return lerp(this.distanceTable[index]!, this.distanceTable[index + 1]!, t);
  }

  timeAtDistance(distance: number): Seconds {
    const table = this.distanceTable;
    let low = 0;
    let high = table.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (table[mid]! < distance) low = mid + 1;
      else high = mid;
    }
    return low * PreviewSceneStateSource.TIME_STEP;
  }

  private activeAtDistance(distance: number): AccessNetworkId | null {
    let active: AccessNetworkId | null = null;
    for (const handoff of this.handoffs) {
      if (handoff.distance > distance) break;
      active = handoff.to;
    }
    return active;
  }

  private warmingAtDistance(distance: number): AccessNetworkId[] {
    const warming: AccessNetworkId[] = [];
    for (const handoff of this.handoffs) {
      if (handoff.distance <= distance) continue;
      if (handoff.distance - distance <= WARM_DISTANCE) warming.push(handoff.to);
      if (handoff.distance - distance > WARM_DISTANCE) break;
    }
    return warming;
  }

  // -------------------------------------------------------------------------
  // Sampling
  // -------------------------------------------------------------------------

  sampleAt(simTime: Seconds): SceneState {
    const time = clamp(simTime, 0, this.duration);
    const distance = this.distanceAtTime(time);
    const sample = route.at(distance);

    const roadY = terrain.elevationAtDistance(distance);
    const normal = terrain.normalAt(sample.x, sample.z);
    // Project the surface normal into the vehicle's frame to get pitch / roll.
    const cos = Math.cos(sample.heading);
    const sin = Math.sin(sample.heading);
    const forwardSlope = normal[0] * cos - normal[2] * sin;
    const lateralSlope = normal[0] * sin + normal[2] * cos;
    const pitch = Math.asin(clamp(-forwardSlope, -0.6, 0.6));
    const roll = Math.asin(clamp(lateralSlope, -0.6, 0.6));

    const speed = time < VEHICLE.dockDwell ? 0 : speedAtDistance(distance);
    const steerAngle = Math.atan(VEHICLE.wheelbase * sample.curvature);

    const active = this.activeAtDistance(distance);
    const warming = this.warmingAtDistance(distance);
    const degraded: AccessNetworkId[] = [];

    const links = Object.fromEntries(
      ACCESS_NETWORKS.map((id): [AccessNetworkId, LinkStatus] => {
        const coverage = coverageAt(id, sample.x, sample.z);
        let state: LinkState = 'unavailable';
        if (id === active) {
          state = coverage < DEGRADED_COVERAGE ? 'degraded' : 'active';
          if (state === 'degraded') degraded.push(id);
        } else if (warming.includes(id) && coverage >= USABLE_COVERAGE) {
          state = 'warming';
        } else if (coverage >= USABLE_COVERAGE) {
          state = 'available';
        }
        return [
          id,
          {
            network: id,
            state,
            coverage,
            ...(id === 'wired' ? { tethered: coverage > 0.5 } : {}),
          },
        ];
      }),
    ) as Record<AccessNetworkId, LinkStatus>;

    const handoffCount = this.handoffs.filter(
      (handoff) => handoff.distance <= distance && handoff.from !== null,
    ).length;
    const latestDecision =
      [...this.decisions].reverse().find((decision) => decision.at <= time) ?? null;

    return {
      runId: this.runId,
      source: 'preview',
      simTime: time,
      duration: this.duration,
      zone: zoneAtDistance(distance),
      vehicle: {
        position: { x: sample.x, y: roadY, z: sample.z },
        heading: sample.heading,
        pitch,
        roll,
        distance,
        speedMps: speed,
        steerAngle,
        wheelAngle: distance / VEHICLE.wheelRadius,
      },
      links,
      active,
      warming,
      degraded,
      traffic: {
        profile: 'video',
        offeredMbps: 12,
        deliveredMbps: 12,
        sessionId: `${this.runId}-S1`,
        sessionUptimeS: time,
        handoffCount,
      },
      latestDecision,
    };
  }

  /** All planned handoffs, for the timeline markers. */
  get plannedHandoffs(): readonly { at: Seconds; from: AccessNetworkId | null; to: AccessNetworkId }[] {
    return this.handoffs.map((handoff) => ({
      at: this.timeAtDistance(handoff.distance),
      from: handoff.from,
      to: handoff.to,
    }));
  }
}

/** The shared preview source. One run, one truth. */
export const previewSource = new PreviewSceneStateSource();
