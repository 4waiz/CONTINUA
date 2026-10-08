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
 *
 * Two presentation choices can be switched on by the page, neither of them a
 * measurement:
 *
 * * **The hold** (`setHold`). The engine moves every rover along the same
 *   pre-computed path whatever happens to its link - that is what keeps two
 *   runs paired - so in the recording a rover with no link keeps rolling. A
 *   remotely driven rover cannot: with no commands arriving it brakes and
 *   waits. With the hold on, the rover is drawn braking to a stand once the
 *   receiver has reported its session down (`app.in_outage`) for longer than a
 *   command watchdog rides out, and pulling away when it comes back, so it
 *   falls behind by the time it stood. Every link figure
 *   is still the event's own at the scene's time; only where the rover is
 *   drawn changes.
 * * **A lane** (`setLane`), when two rovers share the road: a sideways offset
 *   from the centre line, so they drive abreast instead of through each other
 *   (`world/lanes.ts`).
 */

import {
  ACCESS_NETWORKS,
  type AccessNetworkId,
  type Decision,
  type HandoffMark,
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
import { clamp, lerp, smoothstep } from '../math/noise';
import { laneOffset, type RoverLane } from '../world/lanes';
import { route } from '../world/route';
import { terrain } from '../world/terrain';
import { VEHICLE } from '../preview/previewSource';

/** How a rover with no link is drawn - see the hold, above. */
export const HOLD = {
  /**
   * Seconds it rolls on after its session drops before it starts to brake: a
   * teleoperated vehicle's command watchdog rides out a blip, so a link that
   * comes back within it barely slows the rover.
   */
  coast: 0.6,
  /** Seconds it takes to brake to a stand once the watchdog gives up. */
  brake: 1.0,
  /** Seconds it takes to pull away again once its session is back. */
  launch: 1.4,
  /** The lost-time table's step, seconds. */
  step: 0.02,
} as const;

/** A stretch of run time in which the receiver reported the session down. */
export interface DownSpan {
  readonly from: Seconds;
  /** `Infinity` while it is still down at the newest event. */
  readonly to: Seconds;
}

/** How far a rover is held at `t` by one span: rolling on, braking, standing, pulling away. */
function heldBy(span: DownSpan, t: Seconds): number {
  if (t <= span.from + HOLD.coast) return 0;
  if (t <= span.to) return smoothstep(HOLD.coast, HOLD.coast + HOLD.brake, t - span.from);
  const atEnd = smoothstep(HOLD.coast, HOLD.coast + HOLD.brake, span.to - span.from);
  return atEnd * (1 - smoothstep(0, HOLD.launch, t - span.to));
}

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
  private newestReceivedAt = 0;
  /** Every change of carrying link, in time order - what a handoff animates. */
  private switches: HandoffMark[] = [];
  /**
   * The run drives the route from its far end back to the dock. Events carry
   * the distance *travelled*; the engine places a reversed vehicle at
   * `length - travelled` (world.py), and so must the scene - drawn at
   * `travelled` it drove the forward route, in the wrong place for every link.
   * Set from the scenario, which is the only thing that says so.
   */
  reverse = false;

  /** See `reverse`: the scenario's direction, once it is known. */
  setReverse(reverse: boolean): void {
    this.reverse = reverse;
  }

  /** Draw the rover braking to a stand while its session is down - see the hold, above. */
  hold = false;
  /** Which lane the rover is drawn in when two share the road; null for the centre line. */
  lane: RoverLane | null = null;

  setHold(hold: boolean): void {
    this.hold = hold;
  }

  setLane(lane: RoverLane | null): void {
    this.lane = lane;
  }

  /** The down spans and lost-time table the hold reads, rebuilt only when the events change. */
  private holdCache: {
    events: number;
    lastSeq: number;
    spans: DownSpan[];
    key: string;
    lost: Float64Array;
    end: Seconds;
  } | null = null;

  /**
   * The stretches in which the receiver reported the session down, once the
   * rover had started to move: the session's first fifth of a second, before
   * the cable path is up, passes while every rover is still parked in its bay.
   */
  downSpans(): readonly DownSpan[] {
    return this.holdTable().spans;
  }

  private holdTable() {
    const events = this.events;
    const lastSeq = events.length ? events[events.length - 1]!.seq : 0;
    const cache = this.holdCache;
    if (cache && cache.events === events.length && cache.lastSeq === lastSeq) return cache;

    let departed: Seconds | null = null;
    const spans: DownSpan[] = [];
    let open: Seconds | null = null;
    for (const event of events) {
      if (departed === null && (event.vehicle?.distance_m ?? 0) > 0.05) departed = event.t;
      const down = event.app?.in_outage === true;
      if (down && open === null) open = event.t;
      if (!down && open !== null) {
        if (departed !== null) spans.push({ from: Math.max(open, departed), to: event.t });
        open = null;
      }
    }
    if (open !== null && departed !== null) spans.push({ from: Math.max(open, departed), to: Infinity });

    const key = spans.map((span) => `${span.from}:${span.to}`).join('|');
    if (cache && cache.key === key) {
      cache.events = events.length;
      cache.lastSeq = lastSeq;
      return cache;
    }
    // Lost time, the integral of how far the rover is held, tabulated: a pure
    // function of the spans, so the same events always draw the same frame.
    const end = Math.max(this.duration, events.length ? events[events.length - 1]!.t : 0) + HOLD.launch + 1;
    const steps = Math.ceil(end / HOLD.step) + 1;
    const lost = new Float64Array(steps);
    let previous = 0;
    for (let i = 1; i < steps; i += 1) {
      const t = i * HOLD.step;
      let held = 0;
      for (const span of spans) held = Math.max(held, heldBy(span, t));
      lost[i] = lost[i - 1]! + ((previous + held) / 2) * HOLD.step;
      previous = held;
    }
    this.holdCache = { events: events.length, lastSeq, spans, key, lost, end };
    return this.holdCache;
  }

  /** How far the rover is held at `t`, 0 driving to 1 standing. Zero with the hold off. */
  heldAt(t: Seconds): number {
    if (!this.hold) return 0;
    let held = 0;
    for (const span of this.holdTable().spans) held = Math.max(held, heldBy(span, t));
    return held;
  }

  /**
   * The moment of the recorded drive the rover is drawn at, at scene time `t`:
   * `t` less the time it has stood so far. Equal to `t` with the hold off.
   */
  driveTimeAt(t: Seconds): Seconds {
    if (!this.hold) return t;
    const table = this.holdTable();
    if (table.spans.length === 0) return t;
    const index = Math.min(Math.floor(Math.max(0, t) / HOLD.step), table.lost.length - 1);
    const lost = table.lost[index]! + Math.max(0, t - index * HOLD.step) * this.heldAt(t);
    return Math.max(0, t - lost);
  }

  /** Distance travelled and speed at `t`, interpolated between samples; a search of its own. */
  private motionAt(t: Seconds): { distance: number; speed: number } {
    const events = this.events;
    let low = 0;
    let high = events.length - 1;
    if (t >= events[high]!.t) low = high;
    else {
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (events[mid]!.t <= t) low = mid;
        else high = mid - 1;
      }
    }
    const event = events[low]!;
    const next = events[low + 1];
    let distance = event.vehicle?.distance_m ?? 0;
    let speed = event.vehicle?.speed_mps ?? 0;
    if (next && next.vehicle && event.vehicle && next.t > event.t) {
      const alpha = clamp((t - event.t) / (next.t - event.t), 0, 1);
      distance = lerp(event.vehicle.distance_m, next.vehicle.distance_m, alpha);
      speed = lerp(event.vehicle.speed_mps, next.vehicle.speed_mps, alpha);
    }
    return { distance, speed };
  }

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

  /** Sim time of the newest sample, and the wall clock (ms) it arrived at. */
  get newest(): { t: Seconds; receivedAt: number } | null {
    const last = this.events[this.events.length - 1];
    return last ? { t: last.t, receivedAt: this.newestReceivedAt } : null;
  }

  /** Highest sequence number seen, so a reconnect can detect a gap. */
  get highestSeq(): number {
    return this.events.length ? this.events[this.events.length - 1]!.seq : 0;
  }

  reset(runId: string, duration: Seconds): void {
    this.events = [];
    this.seen.clear();
    this.cachedIndex = 0;
    this.newestReceivedAt = 0;
    this.switches = [];
    this.holdCache = null;
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
      this.rebuildSwitches();
    } else {
      this.events.push(event);
      this.newestReceivedAt = typeof performance === 'undefined' ? 0 : performance.now();
      const previous = this.events[this.events.length - 2];
      this.noteSwitch(previous, event);
    }
    if (event.t > this.duration) this.duration = event.t;
    for (const listener of this.listeners) listener(this.sampleAt(event.t));
  }

  private noteSwitch(previous: EngineEvent | undefined, event: EngineEvent): void {
    const from = (previous?.carrying ?? null) as AccessNetworkId | null;
    const to = (event.carrying ?? null) as AccessNetworkId | null;
    if (to && to !== from) this.switches.push({ at: event.t, from, to });
  }

  private rebuildSwitches(): void {
    this.switches = [];
    for (let i = 0; i < this.events.length; i += 1) this.noteSwitch(this.events[i - 1], this.events[i]!);
  }

  /** The index of the latest change of carrying link at or before `t`, or -1. */
  private switchIndexAt(t: Seconds): number {
    const switches = this.switches;
    let low = 0;
    let high = switches.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (switches[mid]!.at <= t) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  }

  /** The latest change of carrying link at or before `t`. */
  private handoffAt(t: Seconds): HandoffMark | null {
    const index = this.switchIndexAt(t);
    return index >= 0 ? this.switches[index]! : null;
  }

  /** The change before that one. */
  private handoffBeforeAt(t: Seconds): HandoffMark | null {
    const index = this.switchIndexAt(t);
    return index >= 1 ? this.switches[index - 1]! : null;
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

  /**
   * The engine event in force at `t`: the last one at or before it, verbatim.
   * Pure, like `sampleAt` - a second run shown beside the first is read at
   * the scene's own time, never at "whatever arrived last".
   */
  eventAt(t: Seconds): EngineEvent | null {
    const index = this.indexAt(t);
    return index < 0 ? null : this.events[index]!;
  }

  /** Every buffered event, oldest first (a read-only view, not a copy). */
  get timeline(): readonly EngineEvent[] {
    return this.events;
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
    // With the hold, the rover is drawn where the recording had it when it
    // has driven as long as this rover has: the time it stood is taken out.
    const held = this.heldAt(t);
    const driveT = this.driveTimeAt(t);
    if (driveT !== t) {
      const motion = this.motionAt(driveT);
      distance = motion.distance;
      speed = motion.speed * (1 - held);
    } else if (next && next.vehicle && event.vehicle && next.t > event.t) {
      const alpha = clamp((t - event.t) / (next.t - event.t), 0, 1);
      distance = lerp(event.vehicle.distance_m, next.vehicle.distance_m, alpha);
      speed = lerp(event.vehicle.speed_mps, next.vehicle.speed_mps, alpha);
    }

    // Where on the route the rover is, and which way it faces along it.
    const along = this.reverse ? route.length - distance : distance;
    const direction = this.reverse ? -1 : 1;
    const sample = route.at(along);
    const roadY = terrain.elevationAtDistance(along);
    // The rover stands on the road, not on the land beside it: it pitches with
    // the road's grade between its axles, and the road is level across, so the
    // ground gives it no roll. (The terrain normal under its centre, read here
    // before, stepped every metre and shook the body on every hill.)
    const pitch = Math.atan(direction * terrain.gradeAtDistance(along, VEHICLE.wheelbase));
    const roll = 0;
    // Its lane, when two rovers share the road: across the centre line by the
    // lane's offset, turned by how fast the offset changes as it pulls out of
    // its bay, its front wheels steering through the turn.
    let x = sample.x;
    let z = sample.z;
    let laneTurn = 0;
    let laneCurve = 0;
    if (this.lane) {
      const lane = laneOffset(this.lane, along);
      x += -sample.tz * lane.offset;
      z += sample.tx * lane.offset;
      laneTurn = Math.atan(lane.slope);
      laneCurve = lane.curve / (1 + lane.slope * lane.slope);
    }

    // The session is down: nothing reaches the rover, whichever link it is
    // bringing up. That link is drawn starting up, not carrying.
    const down = event.app?.in_outage === true;
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
      if (carrying && down && (observation.phase === 'activating' || observation.phase === 'validating')) {
        warming.push(id);
      } else if (carrying) {
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
        position: { x, y: roadY, z },
        heading: (this.reverse ? sample.heading + Math.PI : sample.heading) - laneTurn,
        pitch,
        roll,
        // The scene's cameras and props read `distance` as a place on the
        // route, so it is the route coordinate, not the odometer.
        distance: along,
        direction,
        speedMps: speed,
        steerAngle: Math.atan(direction * VEHICLE.wheelbase * (sample.curvature - laneCurve)),
        wheelAngle: distance / VEHICLE.wheelRadius,
      },
      links,
      active: (event.carrying ?? null) as AccessNetworkId | null,
      handoff: this.handoffAt(t),
      handoffBefore: this.handoffBeforeAt(t),
      sessionDown: down,
      held,
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
