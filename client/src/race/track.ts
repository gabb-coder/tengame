import type { CircuitData, CircuitInfo } from '../../../shared/circuits.ts';

/** Bridges: the upper pass is lifted fully this far either side of the crossing (m), then ramps down over BRIDGE_RAMP. */
export const BRIDGE_FLAT = 40;
export const BRIDGE_RAMP = 260;

/** Where on the track something is: `s` meters along the lap from the start line, `lateral` meters right of the centre line. */
export interface TrackSpot {
  s: number;
  lateral: number;
}

const GRID_CELL = 40;

/**
 * A circuit's centre line, as a loop of evenly spaced points: where any distance along the
 * lap is, which way the track runs and bends there, and where on the track a spot is.
 * x points east, z south, y up; "right" is the driver's right.
 */
export class Track {
  readonly n: number;
  readonly spacing: number;
  readonly length: number;
  readonly width: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Unit direction of travel (horizontal). */
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  /** Signed curvature (1/m): positive bends right. */
  readonly curvature: Float32Array;
  /** How much each point is lifted onto a bridge (m); 0 on the ground. */
  readonly lift: Float32Array;
  private grid = new Map<number, number[]>();

  constructor(
    readonly data: CircuitData,
    readonly info: CircuitInfo,
  ) {
    const p = data.points;
    this.n = p.length / 3;
    this.length = data.length;
    this.spacing = this.length / this.n;
    this.width = info.width;
    this.x = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.z = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.x[i] = p[i * 3] / 100;
      this.y[i] = p[i * 3 + 1] / 100;
      this.z[i] = p[i * 3 + 2] / 100;
    }
    this.tx = new Float32Array(this.n);
    this.tz = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const a = this.wrapIndex(i - 1);
      const b = this.wrapIndex(i + 1);
      const dx = this.x[b] - this.x[a];
      const dz = this.z[b] - this.z[a];
      const d = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / d;
      this.tz[i] = dz / d;
    }
    this.curvature = curvatureOf(this.x, this.z, 2);
    this.lift = new Float32Array(this.n);
    for (const b of data.bridges) {
      const at = Math.round(b.over / this.spacing);
      const under = this.wrapIndex(Math.round(b.under / this.spacing));
      const lift = Math.max(0, this.y[at] - this.y[under]);
      for (let i = 0; i < this.n; i++) {
        const d = Math.abs(this.delta(at * this.spacing, i * this.spacing));
        const ramp = d < BRIDGE_FLAT ? 1 : d < BRIDGE_FLAT + BRIDGE_RAMP ? 0.5 * (1 + Math.cos((Math.PI * (d - BRIDGE_FLAT)) / BRIDGE_RAMP)) : 0;
        this.lift[i] = Math.max(this.lift[i], lift * ramp);
      }
    }
    for (let i = 0; i < this.n; i++) {
      const key = this.cellKey(this.x[i], this.z[i]);
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(i);
    }
  }

  wrapIndex(i: number): number {
    return ((i % this.n) + this.n) % this.n;
  }

  /** `s` brought into 0..length. */
  wrap(s: number): number {
    return ((s % this.length) + this.length) % this.length;
  }

  /** How far ahead `b` is of `a` along the lap, the short way round (negative if behind). */
  delta(a: number, b: number): number {
    let d = this.wrap(b - a);
    if (d > this.length / 2) d -= this.length;
    return d;
  }

  /** Point index at or before `s`, and how far (0..1) toward the next. */
  private locate(s: number): [number, number, number] {
    const f = this.wrap(s) / this.spacing;
    const i = Math.floor(f) % this.n;
    return [i, (i + 1) % this.n, f - Math.floor(f)];
  }

  /** The centre line at `s`. */
  centre(s: number, out: { x: number; y: number; z: number }): typeof out {
    const [i, j, t] = this.locate(s);
    out.x = this.x[i] + (this.x[j] - this.x[i]) * t;
    out.y = this.y[i] + (this.y[j] - this.y[i]) * t;
    out.z = this.z[i] + (this.z[j] - this.z[i]) * t;
    return out;
  }

  /** The spot `lateral` meters right of the centre line at `s` (on the road surface). */
  pointAt(s: number, lateral: number, out: { x: number; y: number; z: number }): typeof out {
    const [i, j, t] = this.locate(s);
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const d = Math.hypot(tx, tz) || 1;
    out.x = this.x[i] + (this.x[j] - this.x[i]) * t - (tz / d) * lateral;
    out.y = this.y[i] + (this.y[j] - this.y[i]) * t;
    out.z = this.z[i] + (this.z[j] - this.z[i]) * t + (tx / d) * lateral;
    return out;
  }

  /** Heading at `s`, radians around +Y (0 faces +Z), as the game's cars measure it. */
  heading(s: number): number {
    const [i, j, t] = this.locate(s);
    return Math.atan2(this.tx[i] + (this.tx[j] - this.tx[i]) * t, this.tz[i] + (this.tz[j] - this.tz[i]) * t);
  }

  /** Curvature at `s` (1/m, positive bending right). */
  bend(s: number): number {
    const [i, j, t] = this.locate(s);
    return this.curvature[i] + (this.curvature[j] - this.curvature[i]) * t;
  }

  /**
   * Where (x, z) is on the track: the nearest point of the centre line. With `near` (a
   * distance along the lap it was recently), only that stretch is searched, so the right
   * pass is found where the track crosses itself; `y` helps too.
   */
  project(x: number, z: number, near?: number, y?: number): TrackSpot & { distance: number } {
    let best = -1;
    let bestD = Infinity;
    const consider = (i: number) => {
      const dx = this.x[i] - x;
      const dz = this.z[i] - z;
      let d = dx * dx + dz * dz;
      if (y !== undefined) d += ((this.y[i] - y) * 3) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    };
    if (near !== undefined) {
      const c = Math.round(this.wrap(near) / this.spacing);
      const reach = Math.ceil(80 / this.spacing);
      for (let k = -reach; k <= reach; k++) consider(this.wrapIndex(c + k));
      // Far from where it was (a teleport): search everywhere.
      if (bestD > 60 * 60) best = -1;
    }
    if (best < 0) {
      bestD = Infinity;
      const cx = Math.floor(x / GRID_CELL);
      const cz = Math.floor(z / GRID_CELL);
      for (let r = 0; r < 6 && best < 0; r++) {
        for (let gx = cx - r; gx <= cx + r; gx++) {
          for (let gz = cz - r; gz <= cz + r; gz++) {
            if (Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) !== r) continue;
            for (const i of this.grid.get(key(gx, gz)) ?? []) consider(i);
          }
        }
        // One more ring: a nearer point can sit in the next ring out.
        if (best >= 0) for (let gx = cx - r - 1; gx <= cx + r + 1; gx++) for (let gz = cz - r - 1; gz <= cz + r + 1; gz++) if (Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) === r + 1) for (const i of this.grid.get(key(gx, gz)) ?? []) consider(i);
      }
      if (best < 0) for (let i = 0; i < this.n; i++) consider(i);
    }
    // Refine on the segment either side of the nearest point.
    let s = best * this.spacing;
    let lateral = 0;
    let distance = Infinity;
    for (const a of [this.wrapIndex(best - 1), best]) {
      const b = this.wrapIndex(a + 1);
      const sx = this.x[b] - this.x[a];
      const sz = this.z[b] - this.z[a];
      const len2 = sx * sx + sz * sz || 1;
      const t = Math.min(1, Math.max(0, ((x - this.x[a]) * sx + (z - this.z[a]) * sz) / len2));
      const px = this.x[a] + sx * t;
      const pz = this.z[a] + sz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < distance) {
        distance = d;
        s = this.wrap((a + t) * this.spacing);
        const len = Math.sqrt(len2);
        // Right of travel is (-tz, tx).
        lateral = ((x - px) * -sz + (z - pz) * sx) / len;
      }
    }
    return { s, lateral, distance };
  }

  /** Indices of centre-line points within `radius` of (x, z). */
  near(x: number, z: number, radius: number): number[] {
    const out: number[] = [];
    const r = Math.ceil(radius / GRID_CELL);
    const cx = Math.floor(x / GRID_CELL);
    const cz = Math.floor(z / GRID_CELL);
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gz = cz - r; gz <= cz + r; gz++) {
        for (const i of this.grid.get(key(gx, gz)) ?? []) if ((this.x[i] - x) ** 2 + (this.z[i] - z) ** 2 <= radius * radius) out.push(i);
      }
    }
    return out;
  }

  private cellKey(x: number, z: number): number {
    return key(Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL));
  }
}

function key(gx: number, gz: number): number {
  return (gx + 4096) * 8192 + (gz + 4096);
}

/** Signed curvature of a closed line from the circle through each point and its neighbors `k` away. */
export function curvatureOf(x: ArrayLike<number>, z: ArrayLike<number>, k: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - k + n) % n;
    const b = (i + k) % n;
    const ax = x[i] - x[a];
    const az = z[i] - z[a];
    const bx = x[b] - x[i];
    const bz = z[b] - z[i];
    const cx = x[b] - x[a];
    const cz = z[b] - z[a];
    // Twice the triangle's area, signed; with x east and z south a positive cross turns right.
    const cross = ax * bz - az * bx;
    const den = Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(cx, cz);
    out[i] = den > 1e-9 ? (2 * cross) / den : 0;
  }
  return out;
}
