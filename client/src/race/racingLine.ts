import { curvatureOf, type Track } from './track.ts';
import { ACCEL_STEP, type Performance } from './f1.ts';

const G = 9.81;
/** Share of the car's weight (and downforce) on the driven rear tires. */
const REAR_SHARE = 0.58;

/**
 * The fastest way round: a line using the whole width of the track (in wide, clip the
 * apex, out wide) that bends as gently as the track allows, and how fast a car can go at
 * each point of it: as fast as the grip allows in the corners, flat out between them,
 * braking just in time for the next. Computer drivers follow it; the braking line shows it.
 */
export class RacingLine {
  /** Meters right of the centre line, per track point. */
  readonly offset: Float32Array;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly curvature: Float32Array;
  /** Target speed (m/s) per track point. */
  readonly speed: Float32Array;
  /** Braking here (the speed ahead is lower than flat out would give). */
  readonly braking: Uint8Array;
  /** The lap's time at those speeds (s). */
  readonly lapTime: number;

  constructor(
    readonly track: Track,
    readonly car: Performance,
    /** How close the car's centre comes to the track's edge (m). */
    margin = 1.5,
  ) {
    const n = track.n;
    this.offset = new Float32Array(n);
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.relax(track.width / 2 - margin);
    this.curvature = smooth(curvatureOf(this.x, this.z, 2), 4);
    const plan = this.plan(car);
    this.speed = plan.speed;
    this.braking = plan.braking;
    this.lapTime = plan.lapTime;
  }

  /** Speeds round the same line for a car that can do less (or more). */
  speedsFor(car: Performance): Float32Array {
    return this.plan(car).speed;
  }

  /**
   * The fastest a car with `car`'s grip could be going at each point and still make every
   * corner ahead (the speeds without the engine's limit: more than the plan on the
   * straights, where a tow or DRS gives more speed).
   */
  limitsFor(car: Performance): Float32Array {
    return this.plan(car).limit;
  }

  /**
   * Bends the line as little as possible within the track: repeatedly moves each point
   * toward where a smooth curve through its neighbors would put it, coarse to fine.
   */
  private relax(limit: number): void {
    const { track } = this;
    const n = track.n;
    const d = this.offset;
    const place = (i: number) => {
      this.x[i] = track.x[i] - track.tz[i] * d[i];
      this.z[i] = track.z[i] + track.tx[i] * d[i];
    };
    for (let i = 0; i < n; i++) place(i);
    const strides = [12, 6, 3, 1].map((m) => Math.max(1, Math.round((m * 4) / track.spacing)));
    for (const k of strides) {
      for (let iter = 0; iter < 300; iter++) {
        for (let i = 0; i < n; i++) {
          const a = (i - 2 * k + 2 * n) % n;
          const b = (i - k + n) % n;
          const c = (i + k) % n;
          const e = (i + 2 * k) % n;
          // Where a point would sit on a smooth (minimum bending) curve through its neighbors.
          const tx = (-this.x[a] + 4 * this.x[b] + 4 * this.x[c] - this.x[e]) / 6;
          const tz = (-this.z[a] + 4 * this.z[b] + 4 * this.z[c] - this.z[e]) / 6;
          const move = (tx - this.x[i]) * -track.tz[i] + (tz - this.z[i]) * track.tx[i];
          d[i] = Math.max(-limit, Math.min(limit, d[i] + move * 0.8));
          place(i);
        }
      }
    }
  }

  /** The speeds: cornering limits, then accelerating out and braking in. */
  private plan(car: Performance): { speed: Float32Array; limit: Float32Array; braking: Uint8Array; lapTime: number } {
    const { track } = this;
    const n = track.n;
    const v = new Float32Array(n);
    const braking = new Uint8Array(n);
    const k = this.curvature;
    const step = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      step[i] = Math.hypot(this.x[j] - this.x[i], this.z[j] - this.z[i], track.y[j] - track.y[i]) || track.spacing;
    }
    const lateralGrip = (speed: number) => car.grip * (G + (car.downforce * speed * speed) / car.mass);
    for (let i = 0; i < n; i++) {
      const bend = Math.abs(k[i]);
      const aero = (car.grip * car.downforce) / car.mass;
      v[i] = bend <= aero ? car.topSpeed : Math.min(car.topSpeed, Math.sqrt((car.grip * G) / (bend - aero)));
    }
    // What's left of the grip for speeding up or slowing down, given the cornering.
    const spare = (i: number, speed: number) => {
      const used = (speed * speed * Math.abs(k[i])) / lateralGrip(speed);
      return Math.sqrt(Math.max(0, 1 - Math.min(1, used) ** 2));
    };
    const grade = (i: number) => (track.y[(i + 1) % n] - track.y[i]) / step[i];
    // Braking: all four tires, helped by the drag.
    const brakeInto = (speeds: Float32Array) => {
      for (let c = 2 * n; c > 0; c--) {
        const i = c % n;
        const h = (i - 1 + n) % n;
        const u = speeds[i];
        const a = car.longGrip * (G + (car.downforce * u * u) / car.mass) * spare(i, u) + (car.drag * u * u) / car.mass + G * grade(h);
        speeds[h] = Math.min(speeds[h], Math.sqrt(u * u + 2 * a * step[h]));
      }
    };
    const limit = Float32Array.from(v);
    brakeInto(limit);
    for (let pass = 0; pass < 3; pass++) {
      // Accelerating: engine power, or the rear tires' grip, whichever runs out first.
      for (let c = 0; c < 2 * n; c++) {
        const i = c % n;
        const j = (i + 1) % n;
        const u = Math.max(v[i], 1);
        const drag = (car.drag * u * u) / car.mass;
        const grip = car.longGrip * REAR_SHARE * (G + (car.downforce * u * u) / car.mass) * spare(i, u) - drag;
        const engine = car.accel ? accelAt(car.accel, u) : car.power / (car.mass * u) - drag;
        const a = Math.min(engine, grip) - G * grade(i);
        v[j] = Math.min(v[j], Math.sqrt(Math.max(0, u * u + 2 * a * step[i])));
      }
      brakeInto(v);
    }
    // Braking (or lifting) wherever the speed a little way ahead is clearly lower.
    const ahead = Math.max(1, Math.round(24 / track.spacing));
    for (let i = 0; i < n; i++) braking[i] = v[(i + ahead) % n] < v[i] - 1.5 ? 1 : 0;
    let time = 0;
    for (let i = 0; i < n; i++) time += step[i] / Math.max(1, (v[i] + v[(i + 1) % n]) / 2);
    return { speed: v, limit, braking, lapTime: time };
  }

  private at(values: Float32Array, s: number): number {
    const f = this.track.wrap(s) / this.track.spacing;
    const i = Math.floor(f) % this.track.n;
    const j = (i + 1) % this.track.n;
    const t = f - Math.floor(f);
    return values[i] + (values[j] - values[i]) * t;
  }

  /** Target speed (m/s) at `s`. */
  speedAt(s: number): number {
    return this.at(this.speed, s);
  }

  /** The line's distance right of the centre line at `s`. */
  offsetAt(s: number): number {
    return this.at(this.offset, s);
  }

  /** The line's curvature at `s` (1/m, positive bending right). */
  bendAt(s: number): number {
    return this.at(this.curvature, s);
  }
}

/** Interpolates a table of accelerations every ACCEL_STEP m/s at `speed`. */
function accelAt(table: readonly number[], speed: number): number {
  const f = Math.min(table.length - 1.001, Math.max(0, speed / ACCEL_STEP));
  const i = Math.floor(f);
  return table[i] + (table[i + 1] - table[i]) * (f - i);
}

/** Box-blurs a loop of values `passes` times over three neighbors. */
function smooth(values: Float32Array, passes: number): Float32Array {
  const n = values.length;
  let a = values;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) b[i] = (a[(i - 1 + n) % n] + a[i] + a[(i + 1) % n]) / 3;
    a = b;
  }
  return a;
}

/** A straight where the rear wing may open, and where it's decided who may open it. */
export interface DrsZone {
  /** Where the timing is checked: within a second of the car ahead here, and the wing may open in the zone. */
  detection: number;
  start: number;
  end: number;
}

/** Shortest straight worth a DRS zone (m), and how many a lap gets at most. */
const DRS_MIN = 450;
const DRS_SHORTEST = 250;
const DRS_MAX = 3;

/**
 * The circuit's DRS zones: its longest straights, as they are in real races, opening a
 * little after the corner before and closing before the braking for the next. Detection
 * is a few hundred meters before.
 */
export function drsZones(line: RacingLine): DrsZone[] {
  const { track } = line;
  const n = track.n;
  // Flat out, and barely turning: the wing can open without the car stepping out.
  const straight = (i: number) => {
    const v = line.speed[i];
    const grip = line.car.grip * (9.81 + (line.car.downforce * v * v) / line.car.mass);
    return !line.braking[i] && v * v * Math.abs(line.curvature[i]) < 0.3 * grip && v > 40;
  };
  // Start counting from a point that isn't on a straight, so runs don't wrap mid-way.
  let first = 0;
  while (first < n && straight(first)) first++;
  const runs: { from: number; to: number }[] = [];
  let from = -1;
  for (let c = 1; c <= n; c++) {
    const i = (first + c) % n;
    if (straight(i) && from < 0) from = first + c;
    if ((!straight(i) || c === n) && from >= 0) {
      runs.push({ from, to: first + c });
      from = -1;
    }
  }
  const straights = runs
    .map((r) => ({ start: r.from * track.spacing + 50, end: r.to * track.spacing - 90 }))
    .sort((a, b) => b.end - b.start - (a.end - a.start));
  // Twisty street circuits still get one, on their longest straight.
  const long = straights.filter((r, i) => r.end - r.start >= (i === 0 ? DRS_SHORTEST : DRS_MIN));
  return long
    .filter((r, i) => i < 2 || r.end - r.start >= 650)
    .slice(0, DRS_MAX)
    .map((r) => ({ detection: track.wrap(r.start - 320), start: track.wrap(r.start), end: track.wrap(r.end) }))
    .sort((a, b) => a.start - b.start);
}
