import * as THREE from 'three';
import type { Activity, Mount } from '../../game/activities.ts';
import { worldSeconds } from '../../game/clock.ts';
import { game } from '../../game/link.ts';

/** A stop on a line: where along the loop it is, and where you wait and get off. */
export interface Stop {
  name: string;
  /** Distance along the loop (m). */
  at: number;
  /** Seconds the vehicle waits here. */
  dwell: number;
  /** Where you stand to board (feet). */
  board: THREE.Vector3;
  /** Where you're put when you get off here (feet). */
  exit: THREE.Vector3;
}

/** Where a vehicle is at a moment: its pose, and the stop it's waiting at (if any). */
export interface VehicleState {
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  /** Waiting at this stop, or null while moving. */
  stopped: Stop | null;
  /** The next stop ahead, and seconds until it gets there (or, if waiting, until it leaves). */
  next: Stop;
  wait: number;
  /** Which of the line's vehicles this is. */
  vehicle: number;
}

/** Share of each run spent speeding up (and again slowing down). */
const EASE = 0.18;

/** Distance (0..1) covered at time `u` (0..1) of a run: speed up, cruise, slow down. */
function ease(u: number): number {
  const top = 1 / (1 - EASE);
  if (u < EASE) return (top * u * u) / (2 * EASE);
  if (u > 1 - EASE) return 1 - (top * (1 - u) ** 2) / (2 * EASE);
  return top * (EASE / 2 + u - EASE);
}

/**
 * A loop that vehicles run round on a timetable: a train, a ferry, a dog sled. Where each
 * vehicle is depends only on the shared clock, so everyone sees it in the same place.
 */
export class TransitLine {
  readonly length: number;
  readonly period: number;
  private legs: { from: Stop; to: Stop; start: number; length: number; time: number }[] = [];
  private tmp = new THREE.Vector3();

  constructor(
    readonly path: THREE.Curve<THREE.Vector3>,
    readonly stops: Stop[],
    /** Cruising speed, m/s. */
    readonly speed: number,
    /** How many vehicles run on the line, evenly spaced in time. */
    readonly vehicles = 1,
  ) {
    this.length = path.getLength();
    let time = 0;
    stops.forEach((from, i) => {
      const to = stops[(i + 1) % stops.length];
      const length = ((to.at - from.at + this.length) % this.length) || this.length;
      const run = length / (speed * (1 - EASE));
      this.legs.push({ from, to, start: time, length, time: run });
      time += from.dwell + run;
    });
    this.period = time;
  }

  /** Where vehicle `v` is at shared time `t` (seconds), `back` meters behind its front. */
  state(t: number, v = 0, back = 0, out?: VehicleState): VehicleState {
    let tau = (((t + (v * this.period) / this.vehicles) % this.period) + this.period) % this.period;
    const s = out ?? { position: new THREE.Vector3(), yaw: 0, pitch: 0, stopped: null, next: this.stops[0], wait: 0, vehicle: v };
    s.vehicle = v;
    let along = 0;
    for (const leg of this.legs) {
      if (tau < leg.from.dwell) {
        along = leg.from.at;
        s.stopped = leg.from;
        s.next = leg.from;
        s.wait = leg.from.dwell - tau;
        break;
      }
      tau -= leg.from.dwell;
      if (tau < leg.time) {
        along = leg.from.at + leg.length * ease(tau / leg.time);
        s.stopped = null;
        s.next = leg.to;
        s.wait = leg.time - tau;
        break;
      }
      tau -= leg.time;
    }
    this.pose(along - back, s);
    return s;
  }

  /** Position and heading at distance `along` the loop. */
  pose(along: number, out: { position: THREE.Vector3; yaw: number; pitch: number }): void {
    const u = (((along % this.length) + this.length) % this.length) / this.length;
    this.path.getPointAt(u, out.position);
    const ahead = this.path.getPointAt((u + 1 / this.length) % 1, this.tmp);
    out.yaw = Math.atan2(ahead.x - out.position.x, ahead.z - out.position.z);
    out.pitch = -Math.atan2(ahead.y - out.position.y, Math.hypot(ahead.x - out.position.x, ahead.z - out.position.z));
  }

  /** The vehicle waiting at `stop` now, if any, and otherwise how long until the next arrives. */
  atStop(stop: Stop, t: number): { vehicle: number | null; eta: number } {
    let eta = Infinity;
    for (let v = 0; v < this.vehicles; v++) {
      const s = this.state(t, v);
      if (s.stopped === stop) return { vehicle: v, eta: 0 };
      // Time until this vehicle next reaches the stop.
      const leg = this.legs.find((l) => l.from === stop)!;
      const tau = (((t + (v * this.period) / this.vehicles) % this.period) + this.period) % this.period;
      eta = Math.min(eta, (((leg.start - tau) % this.period) + this.period) % this.period);
    }
    return { vehicle: null, eta };
  }
}

/** How a line's vehicles carry riders. */
export interface RideOptions {
  /** "monorail", "boat": shown in prompts. */
  name: string;
  /** "Board the monorail". */
  verb: string;
  /** Riders' seats in the vehicle's frame (hips when sitting, feet when standing; +Z forward). */
  seats: THREE.Vector3[];
  /** Which way each seat faces, relative to the vehicle (default: forward). */
  facing?: number[];
  pose: 'sit' | 'stand';
  /** Can you get off between stops (and where you land then, beside the vehicle)? */
  hopOff?: (vehicle: VehicleState) => THREE.Vector3 | null;
  /** How close to the boarding spot you must be. */
  reach?: number;
  /** A sound as you board. */
  sound?: (at: THREE.Vector3) => void;
}

/** A lift shaft: up from `bottom` to `top` and back down, as a two-stop loop. */
export class Shaft extends THREE.Curve<THREE.Vector3> {
  constructor(
    private x: number,
    private z: number,
    private bottom: number,
    private top: number,
  ) {
    super();
  }

  override getPoint(u: number, out = new THREE.Vector3()): THREE.Vector3 {
    const k = u < 0.5 ? u * 2 : 2 - u * 2;
    return out.set(this.x, this.bottom + (this.top - this.bottom) * k, this.z);
  }
}

/** A closed loop through `points` (x, y, z) at even speed. */
export function loopCurve(points: THREE.Vector3[]): THREE.CatmullRomCurve3 {
  const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
  curve.arcLengthDivisions = Math.max(200, Math.ceil(curve.getLength() / 2));
  curve.updateArcLengths();
  return curve;
}

/** Distance along `curve` of its point nearest (x, z). */
export function distanceAlong(curve: THREE.Curve<THREE.Vector3>, x: number, z: number): number {
  const p = new THREE.Vector3();
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < 2000; i++) {
    curve.getPointAt(i / 2000, p);
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestD) [best, bestD] = [i / 2000, d];
  }
  return best * curve.getLength();
}

/** Boarding spots at each stop of `line`: wait for a vehicle, then hop on. */
export function lineActivities(line: TransitLine, opts: RideOptions, vehicleTransform: (state: VehicleState) => THREE.Matrix4): Activity[] {
  return line.stops.map((stop) => ({
    position: stop.board,
    reach: opts.reach ?? 3,
    height: 3,
    prompt() {
      const { vehicle, eta } = line.atStop(stop, worldSeconds());
      if (vehicle !== null) return { action: opts.verb, detail: `Next stop: ${nextStop(line, stop).name}` };
      return { action: `The ${opts.name} arrives in ${Math.ceil(eta)} s`, detail: stop.name, waiting: true };
    },
    use() {
      const { vehicle } = line.atStop(stop, worldSeconds());
      if (vehicle === null) return;
      game.ride(rideMount(line, vehicle, opts, vehicleTransform));
      opts.sound?.(stop.board);
    },
  }));
}

function nextStop(line: TransitLine, stop: Stop): Stop {
  return line.stops[(line.stops.indexOf(stop) + 1) % line.stops.length];
}

/** Riding vehicle `v` of a line, in a seat picked from the player's id. */
function rideMount(line: TransitLine, v: number, opts: RideOptions, vehicleTransform: (state: VehicleState) => THREE.Matrix4): Mount {
  let hash = 0;
  for (const ch of game.player.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const index = hash % opts.seats.length;
  const seat = opts.seats[index];
  const turn = opts.facing?.[index] ?? 0;
  const state = line.state(worldSeconds(), v);
  const q = new THREE.Quaternion();
  const mount: Mount = {
    position: new THREE.Vector3(),
    yaw: 0,
    pose: opts.pose,
    label: opts.name,
    ride: true,
    update() {
      line.state(worldSeconds(), v, 0, state);
      const M = vehicleTransform(state);
      mount.position.copy(seat).applyMatrix4(M);
      q.setFromRotationMatrix(M);
      mount.yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y + turn;
    },
    blocked() {
      if (state.stopped || opts.hopOff?.(state)) return null;
      return `Next stop: ${state.next.name} in ${Math.ceil(state.wait)} s`;
    },
    exit() {
      if (state.stopped) return state.stopped.exit.clone();
      return opts.hopOff?.(state) ?? null;
    },
  };
  mount.update!();
  return mount;
}
