/**
 * A recorded run, driven by hand.
 *
 * The viewer steers the rover (`driveModel.ts`); where it is on the road picks
 * the moment of the recorded run at which the recorded rover was there - the
 * same point of the same road - and every network fact on screen is that
 * moment's, verbatim: which link carries, which is warming, what the receiver
 * reported. Driving forward plays the recording on, backing up plays it back;
 * stopping holds it. Nothing about the network is computed here. The only
 * things made up are the rover's own place, speed and angle, which are the
 * viewer's.
 *
 * The scene's clock still runs, for the animation alone: a beam reaching out,
 * a packet on its way, the camera's flight to a new link. So a change of link
 * is marked in that clock - when the rover crosses the point where the
 * recording changed - not at the recording's own time. The first time the
 * rover crosses a change going forward, the cameras fly to show it; backing
 * over it again changes the beams and leaves the camera be.
 *
 * Unlike a recording this source is not a pure function of time - a driven
 * rover is where it was driven - so it is never used for capture.
 */

import type { AccessNetworkId, HandoffMark, SceneState, SceneStateSource, Seconds } from '@continua/contracts';
import type { EngineEvent } from '@continua/contracts/engine';
import { EngineSceneStateSource } from '../engine/engineSource';
import { VEHICLE } from '../preview/previewSource';
import { route } from '../world/route';
import { zoneAtDistance } from '../world/sites';
import { DriveModel, NO_INPUT, type DriveInput, type DrivePose } from './driveModel';

/**
 * Where the recorded rover was, and when: route metres travelled against run
 * time, from the run's own events. The recorded motion never goes backwards,
 * so for any point of the road there is one moment it was there - the moment
 * it set off from it, for the dock, where it waited first.
 */
export class RoadClock {
  private readonly times: Float64Array;
  private readonly travelled: Float64Array;
  readonly reverse: boolean;

  constructor(events: readonly EngineEvent[], reverse: boolean) {
    const rows = events.filter((event) => event.vehicle);
    this.times = Float64Array.from(rows.map((event) => event.t));
    this.travelled = Float64Array.from(rows.map((event) => event.vehicle!.distance_m));
    this.reverse = reverse;
  }

  get empty(): boolean {
    return this.times.length === 0;
  }

  /** The run time at which the recorded rover was at route metre `along`. */
  timeAt(along: number): number {
    const n = this.times.length;
    if (n === 0) return 0;
    const target = this.reverse ? route.length - along : along;
    // The last sample at or short of the target; the one after it is past it.
    let low = 0;
    let high = n - 1;
    if (target < this.travelled[0]!) return this.times[0]!;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.travelled[mid]! <= target) low = mid;
      else high = mid - 1;
    }
    if (low >= n - 1) return this.times[n - 1]!;
    const d0 = this.travelled[low]!;
    const d1 = this.travelled[low + 1]!;
    const t0 = this.times[low]!;
    const t1 = this.times[low + 1]!;
    return d1 > d0 ? t0 + ((target - d0) / (d1 - d0)) * (t1 - t0) : t0;
  }

  /** Route metres where the recorded rover was at run time `t`. */
  alongAt(t: number): number {
    const n = this.times.length;
    if (n === 0) return this.reverse ? route.length : 0;
    let low = 0;
    let high = n - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.times[mid]! <= t) low = mid;
      else high = mid - 1;
    }
    const travelled = this.travelled[low]!;
    return this.reverse ? route.length - travelled : travelled;
  }
}

interface Sample {
  /** Scene time of the frame. */
  t: number;
  pose: DrivePose;
  /** The recorded run's time at the rover's point of the road. */
  recorded: number;
}

/** How much of the drive is kept for the look-backs the rover's rig makes (suspension, satellite panel). */
const HISTORY_S = 3;
/** Changes of link kept for the beams and the cameras. */
const MARKS_KEPT = 8;

export class DrivenSceneStateSource implements SceneStateSource {
  readonly kind = 'engine' as const;
  readonly runId: string;
  /** The scene clock only animates while driving; it runs as long as the drive does. */
  readonly duration: Seconds = 1e6;
  /** The keys held now; the page writes this, the frame reads it. */
  input: DriveInput = { ...NO_INPUT };

  private readonly tape: EngineSceneStateSource;
  private readonly road: RoadClock;
  private readonly model: DriveModel;
  private history: Sample[] = [];
  private marks: HandoffMark[] = [];
  private carrying: AccessNetworkId | null;
  /** The furthest the drive has played the recording: a change crossed beyond it is new. */
  private frontier: number;

  constructor(options: {
    /** The recorded run, whole - every event, not the part streamed so far. */
    events: readonly EngineEvent[];
    runId: string;
    /** Run time to take over at: the rover starts where the recording had it then. */
    at: number;
    reverse: boolean;
  }) {
    this.runId = options.runId;
    const last = options.events[options.events.length - 1];
    this.tape = new EngineSceneStateSource(options.runId, last ? last.t : 1);
    this.tape.setReverse(options.reverse);
    for (const event of options.events) this.tape.ingest(event);
    this.road = new RoadClock(options.events, options.reverse);

    const along = this.road.alongAt(options.at);
    const travelled = options.reverse ? route.length - along : along;
    this.model = new DriveModel({ along, facing: options.reverse ? -1 : 1, odometer: travelled });
    const recorded = this.road.timeAt(along);
    const first = this.tape.sampleAt(recorded);
    this.carrying = first.active;
    this.frontier = recorded;
    // The link already carrying, as a change long past: drawn, not animated.
    if (first.handoff) this.marks.push({ at: -1e4, from: first.handoff.from, to: first.handoff.to, reveal: false });
    this.history.push({ t: 0, pose: this.model.pose(), recorded });
  }

  // --- what the page reads --------------------------------------------------------

  /** The recording's time at the rover's point of the road: what the panels show. */
  get recordedTime(): number {
    return this.history[this.history.length - 1]!.recorded;
  }

  /** The rover now. */
  get pose(): DrivePose {
    return this.history[this.history.length - 1]!.pose;
  }

  /** Whether the rover is against the edge of the road this frame. */
  get bumped(): boolean {
    return this.model.bumped;
  }

  /** Put the rover where the recorded rover was at run time `t`, at rest, facing its way. */
  placeAt(t: number): void {
    const along = this.road.alongAt(t);
    this.model.place(along, this.road.reverse ? -1 : 1);
  }

  // --- the frame ---------------------------------------------------------------------

  step(simTime: Seconds, dt: Seconds): void {
    this.model.step(this.input, dt);
    const pose = this.model.pose();
    const recorded = this.road.timeAt(pose.along);
    const active = this.tape.sampleAt(recorded).active;
    if (active !== this.carrying) {
      if (active) {
        this.marks.push({
          at: simTime,
          from: this.carrying,
          to: active,
          // New ground: the first time the drive plays this change.
          reveal: recorded > this.frontier,
        });
        if (this.marks.length > MARKS_KEPT) this.marks.splice(0, this.marks.length - MARKS_KEPT);
      }
      this.carrying = active;
    }
    if (recorded > this.frontier) this.frontier = recorded;
    this.history.push({ t: simTime, pose, recorded });
    const keepFrom = simTime - HISTORY_S;
    let drop = 0;
    while (drop < this.history.length - 1 && this.history[drop]!.t < keepFrom) drop += 1;
    if (drop > 0) this.history.splice(0, drop);
  }

  /** The frame nearest `t` at or before it, for the rig's look-backs; the latest for anything later. */
  private sampleFor(t: Seconds): Sample {
    const history = this.history;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i]!.t <= t + 1e-9) return history[i]!;
    }
    return history[0]!;
  }

  private markIndexAt(t: Seconds): number {
    for (let i = this.marks.length - 1; i >= 0; i -= 1) if (this.marks[i]!.at <= t + 1e-9) return i;
    return -1;
  }

  sampleAt(simTime: Seconds): SceneState {
    const sample = this.sampleFor(simTime);
    const recorded = this.tape.sampleAt(sample.recorded);
    const pose = sample.pose;
    const index = this.markIndexAt(simTime);
    return {
      ...recorded,
      simTime,
      duration: this.duration,
      zone: zoneAtDistance(pose.along),
      vehicle: {
        position: { x: pose.x, y: pose.y, z: pose.z },
        heading: pose.heading,
        pitch: pose.pitch,
        roll: 0,
        distance: pose.along,
        // The cameras and the road strip read the way along the route it faces.
        direction: Math.cos(pose.heading - route.at(pose.along).heading) >= 0 ? 1 : -1,
        speedMps: pose.speed,
        steerAngle: pose.steer,
        wheelAngle: pose.odometer / VEHICLE.wheelRadius,
      },
      handoff: index >= 0 ? this.marks[index]! : null,
      handoffBefore: index >= 1 ? this.marks[index - 1]! : null,
    };
  }
}
