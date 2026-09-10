/**
 * Drives the Phase 1 scene from real engine events.
 *
 * This is the Phase 2 seam the handoff described, implemented exactly as
 * specified: a `SceneStateSource` whose `sampleAt(t)` is **pure**. Engine events
 * arrive over a websocket and are buffered; `sampleAt` interpolates the
 * buffered timeline. It never returns "whatever arrived last", so scrubbing and
 * replay reproduce the same frames - which is what Phase 3 capture needs.
 *
 * The scene renders vehicle motion by interpolating between recorded distances.
 * It does **not** invent metrics: every link statistic, health figure and
 * decision comes straight from the event.
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
import type {
  EngineEvent,
  EngineLinkId,
  LinkPhase,
} from '@continua/contracts/engine';
import { clamp, lerp } from '../math/noise';
import { route } from '../world/route';
import { terrain } from '../world/terrain';
import { VEHICLE } from '../preview/previewSource';

const PHASE_TO_STATE: Record<LinkPhase, LinkState> = {
  unavailable: 'unavailable',
  available: 'available',
  activating: 'warming',
  validating: 'warming',
  active: 'available',
  carrying: 'active',
};

function emptyStatus(id: AccessNetworkId): LinkStatus {
  return { network: id, state: 'unavailable', coverage: 0 };
}

/**
 * A `SceneStateSource` backed by a growing buffer of engine events.
 *
 * Events may arrive out of order or be duplicated by a reconnect; `ingest`
 * handles both by keying on the monotonic sequence number and keeping the
 * buffer sorted by simulation time.
 */
export class EngineSceneStateSource implements SceneStateSource {
  readonly kind = 'engine' as const;
  runId: string;
  duration: Seconds;

  private events: EngineEvent[] = [];
  private seen = new Set<number>();
  private listeners = new Set<(state: SceneState) => void>();
  private cachedIndex = 0;

  constructor(runId = 'engine', duration: Seconds = 100) {
    this.runId = runId;
    this.duration = Math.max(duration, 1);
  }

  get eventCount(): number {
    return this.events.length;
  }

  get latest(): EngineEvent | null {
    return this.events.length ? this.events[this.events.length - 1]! : null;
  }

  /** Highest sequence number seen, so a reconnect can detect a gap. */
  get highestSeq(): number {
    return this.events.length ? this.events[this.events.length - 1]!.seq : 0;
  }

  reset(runId: string, duration: Seconds): void {
    this.events = [];
    this.seen.clear();
    this.cachedIndex = 0;
    this.runId = runId;
    this.duration = Math.max(duration, 1);
  }

  ingest(event: EngineEvent): void {
    if (this.seen.has(event.seq)) return; // duplicate from a reconnect
    this.seen.add(event.seq);
    const last = this.events[this.events.length - 1];
    if (last && event.t < last.t) {
      // Out of order: insert at the right place rather than corrupting the
      // timeline. Rare, but a dropped-and-resent frame must not rewind the car.
      let index = this.events.length - 1;
      while (index >= 0 && this.events[index]!.t > event.t) index -= 1;
      this.events.splice(index + 1, 0, event);
    } else {
      this.events.push(event);
    }
    if (event.t > this.duration) this.duration = event.t;
    for (const listener of this.listeners) listener(this.sampleAt(event.t));
  }

  subscribe(listener: (state: SceneState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Binary search for the last event at or before `t`. */
  private indexAt(t: Seconds): number {
    const events = this.events;
    if (events.length === 0) return -1;
    if (t >= events[events.length - 1]!.t) return events.length - 1;
    // Most lookups walk forward one or two frames; try that before searching.
    const cached = this.cachedIndex;
    if (cached < events.length && events[cached]!.t <= t) {
      let index = cached;
      while (index + 1 < events.length && events[index + 1]!.t <= t) index += 1;
      this.cachedIndex = index;
      return index;
    }
    let low = 0;
    let high = events.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (events[mid]!.t <= t) low = mid;
      else high = mid - 1;
    }
    this.cachedIndex = low;
    return low;
  }

  sampleAt(simTime: Seconds): SceneState {
    const t = clamp(simTime, 0, this.duration);
    const index = this.indexAt(t);
    if (index < 0) return this.emptyState(t);

    const event = this.events[index]!;
    const next = this.events[index + 1];

    // Interpolate only vehicle motion. Everything else is taken verbatim from
    // the event: a smoothed metric would be a metric the engine never produced.
    let distance = event.vehicle?.distance_m ?? 0;
    let speed = event.vehicle?.speed_mps ?? 0;
    if (next && next.vehicle && event.vehicle && next.t > event.t) {
      const alpha = clamp((t - event.t) / (next.t - event.t), 0, 1);
      distance = lerp(event.vehicle.distance_m, next.vehicle.distance_m, alpha);
      speed = lerp(event.vehicle.speed_mps, next.vehicle.speed_mps, alpha);
    }

    const sample = route.at(distance);
    const roadY = terrain.elevationAtDistance(distance);
    const normal = terrain.normalAt(sample.x, sample.z);
    const cos = Math.cos(sample.heading);
    const sin = Math.sin(sample.heading);
    const pitch = Math.asin(clamp(-(normal[0] * cos - normal[2] * sin), -0.6, 0.6));
    const roll = Math.asin(clamp(normal[0] * sin + normal[2] * cos, -0.6, 0.6));

    const links = {} as Record<AccessNetworkId, LinkStatus>;
    const warming: AccessNetworkId[] = [];
    const degraded: AccessNetworkId[] = [];
    for (const id of ACCESS_NETWORKS) {
      const observation = event.links[id as EngineLinkId];
      if (!observation) {
        links[id] = emptyStatus(id);
        continue;
      }
      const carrying = event.carrying === id;
      let state: LinkState = PHASE_TO_STATE[observation.phase];
      if (carrying) {
        const bad =
          (observation.rtt_ms !== null && observation.rtt_ms > 150) ||
          (observation.loss_pct !== null && observation.loss_pct > 3);
        state = bad ? 'degraded' : 'active';
        if (bad) degraded.push(id);
      } else if (state === 'warming') {
        warming.push(id);
      }
      links[id] = {
        network: id,
        state,
        coverage: observation.modelled_coverage ?? 0,
        // Guard each optional measurement on *itself*. Guarding RSSI on RTT
        // published `rssiDbm: undefined` for links that have no RSSI at all,
        // which reads as "present but unknown" rather than "does not exist".
        ...(observation.rssi_dbm !== null ? { rssiDbm: observation.rssi_dbm } : {}),
        ...(observation.rtt_ms !== null ? { latencyMs: observation.rtt_ms } : {}),
        ...(observation.jitter_ms !== null ? { jitterMs: observation.jitter_ms } : {}),
        ...(observation.loss_pct !== null ? { lossPct: observation.loss_pct } : {}),
        ...(observation.throughput_mbps !== null
          ? { throughputMbps: observation.throughput_mbps }
          : {}),
        ...(id === 'wired' ? { tethered: observation.phase === 'carrying' || observation.phase === 'active' } : {}),
      };
    }

    const app = event.app;
    const control = app?.classes.control;
    const latestDecision: Decision | null = event.action && event.action.kind !== 'none'
      ? {
          id: `${event.run_id}-${event.seq}`,
          at: event.t,
          kind: 'steer',
          to: (event.action.link ?? event.carrying ?? undefined) as AccessNetworkId | undefined,
          reason: event.reason,
        }
      : null;

    return {
      runId: event.run_id,
      source: 'engine',
      simTime: t,
      duration: this.duration,
      zone: (event.vehicle?.zone ?? 'facility') as SceneState['zone'],
      vehicle: {
        position: { x: sample.x, y: roadY, z: sample.z },
        heading: sample.heading,
        pitch,
        roll,
        distance,
        speedMps: speed,
        steerAngle: Math.atan(VEHICLE.wheelbase * sample.curvature),
        wheelAngle: distance / VEHICLE.wheelRadius,
      },
      links,
      active: (event.carrying ?? null) as AccessNetworkId | null,
      warming,
      degraded,
      traffic: {
        profile: 'video',
        offeredMbps: control?.goodput_mbps ?? 0,
        deliveredMbps: control?.goodput_mbps ?? 0,
        sessionId: app?.session_id ?? event.run_id,
        sessionUptimeS: t,
        handoffCount: app?.session_reconnects ?? 0,
      },
      latestDecision,
    };
  }

  private emptyState(t: Seconds): SceneState {
    const sample = route.at(0);
    const links = {} as Record<AccessNetworkId, LinkStatus>;
    for (const id of ACCESS_NETWORKS) links[id] = emptyStatus(id);
    return {
      runId: this.runId,
      source: 'engine',
      simTime: t,
      duration: this.duration,
      zone: 'facility',
      vehicle: {
        position: { x: sample.x, y: terrain.elevationAtDistance(0), z: sample.z },
        heading: sample.heading,
        pitch: 0,
        roll: 0,
        distance: 0,
        speedMps: 0,
        steerAngle: 0,
        wheelAngle: 0,
      },
      links,
      active: null,
      warming: [],
      degraded: [],
      traffic: {
        profile: 'video',
        offeredMbps: 0,
        deliveredMbps: 0,
        sessionId: this.runId,
        sessionUptimeS: 0,
        handoffCount: 0,
      },
      latestDecision: null,
    };
  }
}
