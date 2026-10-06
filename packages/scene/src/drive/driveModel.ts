/**
 * The rover under the viewer's own keys.
 *
 * A kinematic bicycle on the island's one road: W drives, S brakes and then
 * reverses, A and D steer, Space holds it; with no steering key held it
 * follows the road's bends by itself, so W alone drives the road. It cannot
 * leave the drivable surface - the dock bay, the carriageway, and the turning
 * circle where the road ends. Every corner of the rover's footprint is kept
 * inside it: a corner that would cross the edge is pushed back, and the rover
 * scrubs speed and turns along the edge, the way a kerb turns a wheel. With
 * room enough - the bay is narrow, the road is not - it can turn round on the
 * road in three moves, or in one on the turning circle.
 *
 * Nothing here belongs to the engine. This decides where the rover is; what
 * the network did at that point of the road is read from the recorded run
 * (`drivenSource.ts`), never made up here.
 */

import { angleDelta, clamp, lerp } from '../math/noise';
import { VEHICLE } from '../preview/previewSource';
import { DOCK_BAY_HALF_LENGTH, ROAD_HALF_WIDTH } from '../world/carriageway';
import { route } from '../world/route';
import { terrain } from '../world/terrain';
import { TURNING_CIRCLE } from '../world/terminus';

export interface DriveInput {
  /** +1 drive (W), -1 brake, then reverse (S), 0 coast. */
  throttle: number;
  /** +1 steer left (A), -1 steer right (D). */
  steer: number;
  /** Space: hold the rover where it is. */
  brake: boolean;
}

export const NO_INPUT: DriveInput = Object.freeze({ throttle: 0, steer: 0, brake: false });

export interface DrivePose {
  /** World position of the rover's root, at the ground contact plane. */
  x: number;
  z: number;
  y: number;
  /** Which way it faces: radians about +Y, 0 facing +X (the route's convention). */
  heading: number;
  /** Nose up, from the road's grade along the way it faces. */
  pitch: number;
  /** Metres a second along the way it faces; negative while reversing. */
  speed: number;
  /** Front-wheel angle, positive to the left. */
  steer: number;
  /** Signed metres travelled, for the wheels' spin. */
  odometer: number;
  /** Route metres of the nearest point of the road: where on the road the rover is. */
  along: number;
  /** Metres left (+) or right (-) of the road's centre line. */
  lateral: number;
}

/** Top speed forward and in reverse, m/s: 58 and 18 km/h. */
const MAX_FORWARD = 16;
const MAX_REVERSE = 5;
/** Acceleration, braking and rolling losses, m/s². */
const ACCEL = 4.2;
const REVERSE_ACCEL = 2.6;
const BRAKE = 11;
const HOLD = 16;
const COAST = 0.7;
const DRAG = 0.012;
/** Steering lock at walking pace and at top speed, and how fast the wheel turns, rad and rad/s. */
const LOCK_SLOW = 0.62;
const LOCK_FAST = 0.15;
const STEER_RATE = 2.6;
const RETURN_RATE = 4.2;
/** How hard the rover lines itself up with the road while no steering key is held. */
const ASSIST_GAIN = 2.4;
/** The rover's footprint, metres from its centre: half length and half width. */
const HALF_LENGTH = 2.6;
const HALF_WIDTH = 1.2;
/** The bay's half width (`dock.ts`), and where the road widens out of the yard to its own. */
const BAY_HALF_WIDTH = 2.7;
const YARD_FROM = DOCK_BAY_HALF_LENGTH + 1.5;
const YARD_TO = 15;
/** Kept off the turning circle's very edge, metres. */
const CIRCLE_MARGIN = 0.35;
/** The longest step integrated at once, seconds. */
const MAX_STEP = 1 / 120;

/** Points of the footprint tested against the edge: the four corners and mid-sides. */
const PROBES: readonly (readonly [number, number])[] = [
  [HALF_LENGTH, HALF_WIDTH],
  [HALF_LENGTH, -HALF_WIDTH],
  [-HALF_LENGTH, HALF_WIDTH],
  [-HALF_LENGTH, -HALF_WIDTH],
  [0, HALF_WIDTH],
  [0, -HALF_WIDTH],
];

const START = route.at(0);

/**
 * Signed distance to the edge of the drivable surface, metres: negative on
 * it. The carriageway (as wide as the bay where it leaves the yard), the bay
 * itself - a rectangle on the route's start, longer than the road's rounded
 * end - and the turning circle.
 */
export function surfaceDistance(x: number, z: number): number {
  const { distSq, along } = route.projectOnRoute(x, z);
  const half =
    along <= YARD_FROM
      ? BAY_HALF_WIDTH
      : along >= YARD_TO
        ? ROAD_HALF_WIDTH
        : lerp(BAY_HALF_WIDTH, ROAD_HALF_WIDTH, (along - YARD_FROM) / (YARD_TO - YARD_FROM));
  const road = Math.sqrt(distSq) - half;
  // The bay, in the route's own frame at its start.
  const dx = x - START.x;
  const dz = z - START.z;
  const ahead = dx * START.tx + dz * START.tz;
  const across = dx * START.tz - dz * START.tx;
  const bay = Math.max(Math.abs(ahead) - DOCK_BAY_HALF_LENGTH, Math.abs(across) - BAY_HALF_WIDTH);
  const circle = Math.hypot(x - TURNING_CIRCLE.x, z - TURNING_CIRCLE.z) - (TURNING_CIRCLE.radius - CIRCLE_MARGIN);
  return Math.min(road, bay, circle);
}

/** Which way the edge is, at a point just over it: the distance's gradient, normalised. */
function outward(x: number, z: number, out: { x: number; z: number }): void {
  const e = 0.05;
  const gx = surfaceDistance(x + e, z) - surfaceDistance(x - e, z);
  const gz = surfaceDistance(x, z + e) - surfaceDistance(x, z - e);
  const length = Math.hypot(gx, gz) || 1;
  out.x = gx / length;
  out.z = gz / length;
}

export class DriveModel {
  private x: number;
  private z: number;
  private heading: number;
  private speed = 0;
  private steer = 0;
  private odometer: number;
  private readonly normal = { x: 0, z: 0 };
  /** Set when the rover last touched the edge: the page can say so. */
  bumped = false;

  constructor(start: { along: number; facing: 1 | -1; odometer?: number }) {
    const sample = route.at(start.along);
    this.x = sample.x;
    this.z = sample.z;
    this.heading = start.facing > 0 ? sample.heading : sample.heading + Math.PI;
    this.odometer = start.odometer ?? 0;
  }

  /** Put the rover on the road's centre line at `along`, facing `facing`, at rest. */
  place(along: number, facing: 1 | -1): void {
    const sample = route.at(along);
    this.x = sample.x;
    this.z = sample.z;
    this.heading = facing > 0 ? sample.heading : sample.heading + Math.PI;
    this.speed = 0;
    this.steer = 0;
  }

  step(input: DriveInput, dt: number): void {
    let remaining = Math.min(dt, 0.25);
    while (remaining > 1e-6) {
      const h = Math.min(MAX_STEP, remaining);
      this.integrate(input, h);
      remaining -= h;
    }
  }

  private integrate(input: DriveInput, dt: number): void {
    // --- speed -------------------------------------------------------------
    let v = this.speed;
    const throttle = clamp(input.throttle, -1, 1);
    if (input.brake) {
      v = Math.sign(v) * Math.max(0, Math.abs(v) - HOLD * dt);
    } else if (throttle > 0) {
      // Rolling back: brake to a stop first.
      if (v < -0.05) v = Math.min(0, v + BRAKE * dt);
      else v += ACCEL * throttle * (1 - (v / MAX_FORWARD) ** 2) * dt;
    } else if (throttle < 0) {
      if (v > 0.05) v = Math.max(0, v - BRAKE * dt);
      else v -= REVERSE_ACCEL * -throttle * (1 - (v / MAX_REVERSE) ** 2) * dt;
    } else {
      const loss = (COAST + DRAG * v * v) * dt;
      v = Math.abs(v) <= loss ? 0 : v - Math.sign(v) * loss;
    }
    v = clamp(v, -MAX_REVERSE, MAX_FORWARD);

    // --- steering: lighter as it goes faster -------------------------------
    // Let go of A and D and the rover follows the road's bends by itself -
    // which way along it, whichever it faces more - so holding W drives the
    // road. Steering overrides it at once.
    const lock = lerp(LOCK_SLOW, LOCK_FAST, clamp(Math.abs(v) / 14, 0, 1));
    let target = clamp(input.steer, -1, 1) * lock;
    if (Math.abs(input.steer) < 0.01 && Math.abs(v) > 0.6) {
      const { along } = route.projectOnRoute(this.x, this.z);
      const road = route.at(along).heading;
      const ahead = Math.abs(angleDelta(this.heading, road)) <= Math.PI / 2 ? road : road + Math.PI;
      // Reversing, the rear leads: steer the other way to line up.
      target = clamp(ASSIST_GAIN * angleDelta(this.heading, ahead) * Math.sign(v), -lock, lock);
    }
    const rate = Math.abs(target) < Math.abs(this.steer) ? RETURN_RATE : STEER_RATE;
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);

    // --- move: a bicycle about the rover's middle ---------------------------
    this.heading += (v / VEHICLE.wheelbase) * Math.tan(this.steer) * dt;
    const fx = Math.cos(this.heading);
    const fz = -Math.sin(this.heading);
    this.x += fx * v * dt;
    this.z += fz * v * dt;
    this.odometer += v * dt;

    // --- the edge: push the footprint back on ------------------------------
    // Into the edge the rover sheds speed and turns along it, the way a wheel
    // scrubs along a kerb: head-on it soon stops, at a glance it slides on.
    this.bumped = false;
    for (let pass = 0; pass < 3; pass += 1) {
      const lx = -Math.sin(this.heading);
      const lz = -Math.cos(this.heading);
      let worst = 0;
      let wx = 0;
      let wz = 0;
      for (const [a, b] of PROBES) {
        const px = this.x + fx * a + lx * b;
        const pz = this.z + fz * a + lz * b;
        const over = surfaceDistance(px, pz);
        if (over > worst) {
          worst = over;
          wx = px;
          wz = pz;
        }
      }
      if (worst <= 0) break;
      outward(wx, wz, this.normal);
      this.x -= this.normal.x * (worst + 0.002);
      this.z -= this.normal.z * (worst + 0.002);
      this.bumped = true;
      if (pass > 0 || Math.abs(v) < 1e-3) continue;
      // The way it is moving - backwards while reversing - and how much of it is into the edge.
      const mx = fx * Math.sign(v);
      const mz = fz * Math.sign(v);
      const into = mx * this.normal.x + mz * this.normal.z;
      if (into <= 0) continue;
      v -= v * clamp(into * 5 * dt, 0, 1);
      // Turn the way of travel toward the edge's own direction.
      const tx = mx - this.normal.x * into;
      const tz = mz - this.normal.z * into;
      if (Math.hypot(tx, tz) > 1e-4) {
        const along = Math.atan2(-tz, tx) + (v < 0 ? Math.PI : 0);
        this.heading += angleDelta(this.heading, along) * clamp(into * 7 * dt, 0, 1);
      }
    }
    this.speed = v;
  }

  /** Where the rover is now, with the road beneath it. */
  pose(): DrivePose {
    const { along } = route.projectOnRoute(this.x, this.z);
    const sample = route.at(along);
    const lateral = (this.x - sample.x) * sample.tz - (this.z - sample.z) * sample.tx;
    // The road is level across; along the way the rover faces it has the
    // road's grade, turned with it.
    const grade = terrain.gradeAtDistance(along, VEHICLE.wheelbase) * Math.cos(angleDelta(sample.heading, this.heading));
    return {
      x: this.x,
      z: this.z,
      y: terrain.elevationAtDistance(along),
      heading: this.heading,
      pitch: Math.atan(grade),
      speed: this.speed,
      steer: this.steer,
      odometer: this.odometer,
      along,
      lateral,
    };
  }
}
