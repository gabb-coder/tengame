import type { CarControls } from '../vehicles/carPhysics.ts';
import { F1, F1_PERFORMANCE } from './f1.ts';
import type { RacingLine } from './racingLine.ts';
import type { Racer } from './racer.ts';

/** Another car, as a computer driver sees it: where it is on the track and how fast it's going. */
export interface Nearby {
  s: number;
  lateral: number;
  speed: number;
}

const WHEELBASE = F1.wheelZFront - F1.wheelZRear;
/** Side by side, cars keep this far apart (m, centre to centre). */
const SIDE_BY_SIDE = 2.7;
/** How fast a driver moves across the track to pass or make room (m/s). */
const SHIFT_RATE = 2.6;

/**
 * A computer driver. It follows the racing line, steering for a point a little way down
 * the road (further the faster it goes) and braking for each corner's speed; how close to
 * the limit it drives is its `skill` (0.9 to 1). Catching a slower car, it stays in its
 * slipstream (taking the extra speed it gives, and DRS's) until close, then pulls out to pass
 * on a side with room, but never into a braking zone, where it drops back to a safe gap;
 * side by side it leaves space.
 */
export class AiDriver {
  /** Meters off the racing line it's steering for (passing or making room). */
  private avoid = 0;
  private stuckFor = 0;
  private waited = 0;
  /** Seconds after the lights go out before it gets going. */
  private reaction: number;
  private speeds: Float32Array;
  /** The most it could be going and still make the corners ahead (above `speeds` on straights). */
  private limits: Float32Array;
  private place = { x: 0, y: 0, z: 0 };

  constructor(
    readonly line: RacingLine,
    readonly skill: number,
    rng: () => number,
  ) {
    this.reaction = 0.18 + rng() * 0.25;
    // Its own speeds: the line's, with the grip it dares to use.
    const dares = { ...F1_PERFORMANCE, grip: F1_PERFORMANCE.grip * skill, longGrip: F1_PERFORMANCE.longGrip * (0.92 + 0.08 * skill) };
    this.speeds = line.speedsFor(dares);
    this.limits = line.limitsFor(dares);
  }

  private at(values: Float32Array, s: number): number {
    const t = this.line.track;
    const f = t.wrap(s) / t.spacing;
    const i = Math.floor(f) % t.n;
    const j = (i + 1) % t.n;
    return values[i] + (values[j] - values[i]) * (f - Math.floor(f));
  }

  private speedAt(s: number): number {
    return this.at(this.speeds, s);
  }

  /**
   * This step's controls. `go` once the race has started (until then it waits on the
   * grid); `others` are the cars around it.
   */
  drive(me: Racer, others: Nearby[], go: boolean, dt: number): CarControls {
    const track = this.line.track;
    const half = track.width / 2;
    const v = Math.max(0, me.speed);
    const s = me.s;

    // Who's in the way: cars ahead in our lane (pass or follow), and anyone alongside (leave room).
    let target = this.speedAt(s + v * 0.1);
    // The plan expects no help on the straights: when a tow or DRS gives more speed, take it,
    // as long as it can still brake for what's ahead.
    const limit = this.at(this.limits, s + v * 0.1);
    if (limit > target + 1 && Math.abs(this.line.bendAt(s)) < 1 / 300) target = Math.max(target, Math.min(limit, v + 3));
    let pass = 0;
    let room = 0;
    let blocked = false;
    /** Waiting behind someone close ahead (not stuck). */
    let queued = false;
    const lineHere = this.line.offsetAt(s);
    const braking = this.line.braking[track.wrapIndex(Math.round(s / track.spacing))] === 1;
    const cornerAhead = braking || this.speedAt(s + 50) < v - 5;
    // A braking zone within a second and a half: no starting a pass that can't be finished
    // before it, and a safe gap to the car ahead (it may brake sooner).
    const zoneSoon = braking || this.speedAt(s + Math.max(30, v * 1.5)) < v - 8;
    // Too narrow here to pass two abreast with room to spare.
    const narrow = track.width < 2 * SIDE_BY_SIDE + 5;
    for (const o of others) {
      const ds = track.delta(s, o.s);
      const dl = o.lateral - (lineHere + this.avoid);
      if (ds > -5.5 && ds < 5.5) {
        const gap = o.lateral - me.lateral;
        if (Math.abs(gap) < SIDE_BY_SIDE) room += (gap > 0 ? -1 : 1) * (SIDE_BY_SIDE - Math.abs(gap)) * 1.5;
        // Side by side into a corner, the one behind gives way and tucks in.
        if (ds > 0.5 && cornerAhead) target = Math.min(target, o.speed - 3);
      } else if (ds >= 5.5 && ds < 60 && Math.abs(o.lateral - me.lateral) < 2.3) {
        // Don't run into it: slow to its speed in time (closing speed against the room left).
        const closing = v - o.speed;
        const gap = Math.max(0.5, ds - 7);
        if (closing > 0 && (closing * closing) / (2 * gap) > 2.5) target = Math.min(target, o.speed - 1);
        if (ds < 10) target = Math.min(target, o.speed - 1.5);
        if (zoneSoon && ds < 8 + v * 0.3) target = Math.min(target, o.speed - 1);
        if (ds < 16) queued = true;
      }
      // Catching it: stay in its slipstream until close, then pull out with the speed it gave
      // (sooner if it's much slower).
      const close = ds < 14 + Math.max(0, v - o.speed) * 1.5 || o.speed < v - 6;
      if (ds >= 5.5 && ds < 45 && Math.abs(dl) < 2.4 && close && (o.speed < v + 2 || ds < 15)) {
        // Pass on a side with room (the one it's already pulling out to), and not into a
        // braking zone.
        const fits = (l: number) => Math.abs(l) < half - 1.1;
        const heading = lineHere + this.avoid;
        const pick = [o.lateral - SIDE_BY_SIDE, o.lateral + SIDE_BY_SIDE].filter(fits).sort((a, b) => Math.abs(a - heading) - Math.abs(b - heading))[0];
        if (pick !== undefined && !zoneSoon && !(narrow && cornerAhead)) pass += pick - lineHere - this.avoid;
        else blocked = true;
      }
    }
    const want = (blocked ? 0 : pass) + room;
    const goal = Math.max(-half + 1.2 - lineHere, Math.min(half - 1.2 - lineHere, this.avoid + want));
    this.avoid += Math.max(-SHIFT_RATE * dt, Math.min(SHIFT_RATE * dt, goal - this.avoid));
    if (!want) this.avoid *= Math.exp(-dt * 0.4);

    // Steering: for a point on the line (plus any sidestep) a little way ahead.
    const ahead = Math.min(55, Math.max(9, 7 + v * 0.42));
    const aim = track.pointAt(s + ahead, this.line.offsetAt(s + ahead) + this.avoid, this.place);
    const pos = me.body.translation();
    const yaw = me.yaw;
    const dx = aim.x - pos.x;
    const dz = aim.z - pos.z;
    // The car's own frame: +X is its left.
    const left = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const reach2 = dx * dx + dz * dz;
    // Pure pursuit, plus a nudge back toward the line where the car has drifted off it.
    const drift = this.line.offsetAt(s) + this.avoid - me.lateral;
    const angle = Math.atan((WHEELBASE * 2 * left) / Math.max(reach2, 1)) - drift * 0.012;
    const lock = me.physics.lockAt(v);
    let steer = Math.max(-1, Math.min(1, -angle / lock));

    let throttle = 0;
    let brake = 0;
    if (!go) {
      // On the grid: sitting still (holding the brake pedal at a standstill would reverse).
      this.waited = 0;
    } else {
      this.waited += dt;
      const err = target - v;
      if (this.waited < this.reaction) throttle = 0;
      else if (err > 0) throttle = Math.min(1, 0.45 + err * 0.6);
      else if (err < -0.3) brake = Math.min(1, 0.3 - err * 0.35);
      else throttle = 0.25;
      // Sliding: ease off, and catch it.
      const slide = me.physics.slipAngle;
      if (slide > 0.08 && v > 12) {
        throttle *= 0.3;
        steer *= 0.6;
      }
    }

    // Stuck (spun into the barrier, beached in gravel), rather than queueing: it'll be rescued.
    if (go && this.waited > 3 && v < 2.5 && !queued) this.stuckFor += dt;
    else this.stuckFor = Math.max(0, this.stuckFor - dt);
    if (this.stuckFor > 1.5) {
      // Try reversing out first.
      throttle = 0;
      brake = 1;
      steer = -steer;
    }
    return { throttle, brake, steer, handbrake: false };
  }

  /** Needs putting back on the track: stuck for a while, upside down, or lost far off it. */
  needsRescue(me: Racer): boolean {
    return this.stuckFor > 5 || me.upset || Math.abs(me.lateral) > this.line.track.width / 2 + 40;
  }

  rescued(): void {
    this.stuckFor = 0;
    this.avoid = 0;
  }
}
