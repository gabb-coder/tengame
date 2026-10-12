import type { RacingLine } from './racingLine.ts';
import type { Track, TrackSpot } from './track.ts';

/** Grid slots are this far apart along the track (m), as in real races, behind the line by GRID_FIRST. */
export const GRID_SPACING = 8;
const GRID_FIRST = 9;
/** The pit lane runs along the start straight, at most this far before and after the line (m). */
const PIT_BEFORE = 430;
const PIT_AFTER = 240;
/** Pit wall, pit lane and garages, in meters beyond the track's edge. */
export const PIT_WALL = 3;
export const PIT_LANE_WIDTH = 12;
export const GARAGE_DEPTH = 18;
/** Kerbs: how wide, and how close the racing line must come to the edge for a corner to have one. */
export const KERB_WIDTH = 1.5;
const KERB_REACH = 2.6;

/** Each row of a grandstand: how deep (m) and how much higher than the one in front. */
export const STAND_ROW = 0.85;
export const STAND_RISE = 0.45;

export type Runoff = 'grass' | 'gravel' | 'asphalt' | 'sand';

/** One side of the track at one point: where the barrier stands and what lies before it. */
export interface Edge {
  /** Barrier distance from the centre line (m). */
  barrier: number;
  /** Kerb along this edge here. */
  kerb: boolean;
  /** What's between the track (or kerb) and the barrier. */
  runoff: Runoff;
  /** The ground is level with the track out to here (m from the centre line). */
  level: number;
}

export interface Grandstand {
  /** Along the lap, the stretch it faces, and which side. */
  from: number;
  to: number;
  side: 1 | -1;
  /** Its front, in meters from the centre line. */
  lateral: number;
  /** Rows of seats. */
  rows: number;
}

/**
 * Everything about a circuit that follows from its shape: the starting grid, the pits, the
 * kerbs on the corners, how far back the barriers stand (well back on the outside of fast
 * corners, tight to the track on city streets, never into another part of the track) and
 * where the grandstands go.
 */
export class CircuitLayout {
  /** Per track point, the edges on the left (-1) and right (+1). */
  readonly left: Edge[] = [];
  readonly right: Edge[] = [];
  /** Which side the pits are on (+1 right of the start straight). */
  readonly pitSide: 1 | -1;
  /** Which side pole position is on. */
  readonly poleSide: 1 | -1;
  readonly grandstands: Grandstand[] = [];
  /** The pit lane runs from `pitFrom` to `pitTo` (m along the lap from the line; pitFrom < 0). */
  readonly pitFrom: number;
  readonly pitTo: number;

  constructor(
    readonly track: Track,
    readonly line: RacingLine,
  ) {
    const street = track.info.style === 'street';
    const half = track.width / 2;
    const n = track.n;
    const clearance = { [-1]: new Float32Array(n), [1]: new Float32Array(n) } as Record<1 | -1, Float32Array>;
    for (const side of [-1, 1] as const) for (let i = 0; i < n; i++) clearance[side][i] = this.clearance(i, side);

    // The pits run along the start straight, as far as it is straight, on whichever side
    // has more room.
    const straight = (s: number) => Math.abs(track.bend(s)) < 1 / 300;
    let from = 0;
    while (from > -PIT_BEFORE && straight(from - track.spacing)) from -= track.spacing;
    let to = 0;
    while (to < PIT_AFTER && straight(to + track.spacing)) to += track.spacing;
    this.pitFrom = Math.min(from, -120);
    this.pitTo = Math.max(to, 60);
    const room = (side: 1 | -1) => {
      let min = Infinity;
      for (let s = this.pitFrom; s <= this.pitTo; s += 10) min = Math.min(min, clearance[side][this.index(s)]);
      return min;
    };
    this.pitSide = room(1) >= room(-1) ? 1 : -1;
    this.poleSide = line.offsetAt(0) >= 0 ? 1 : -1;

    for (const side of [-1, 1] as const) {
      const want = new Float32Array(n);
      // Gravel traps on the outside of the real corners, reaching back into the braking zone.
      const trap = new Float32Array(n);
      for (let i = 0; i < n; i++) trap[i] = line.curvature[i] * side < -1 / 260 ? 1 : 0;
      const gravel = maxFilter(trap, Math.round(60 / track.spacing));
      for (let i = 0; i < n; i++) {
        const bend = line.curvature[i];
        // Outside of a bend: room to run wide, more the faster the corner.
        const outside = bend * side < 0 && Math.abs(bend) > 1 / 600;
        const speed = line.speed[i];
        if (street) want[i] = half + (outside && Math.abs(bend) > 1 / 120 ? 2.5 : 0.8);
        else want[i] = half + (outside ? Math.min(55, Math.max(14, 6 + speed * 0.45)) : 10);
      }
      // Big run-off reaches back before the corner and on past it.
      const spread = street ? 3 : Math.round(70 / track.spacing);
      const widened = maxFilter(want, spread);
      const smoothed = boxFilter(widened, Math.round(25 / track.spacing));
      // On the inside of a bend, a line further in than its radius would fold over itself.
      const fold = new Float32Array(n).fill(Infinity);
      for (let i = 0; i < n; i++) {
        // Surfaces are laid out square to the centre line, so its bend is what matters.
        const bend = track.curvature[i] * side;
        if (bend <= 0) continue;
        for (let k = -4; k <= 4; k++) fold[(i + k + n) % n] = Math.min(fold[(i + k + n) % n], 0.8 / bend);
      }
      const edges = side < 0 ? this.left : this.right;
      for (let i = 0; i < n; i++) {
        // Half way to any other stretch of track alongside.
        const limit = Math.min(fold[i], Math.max(half + 0.6, clearance[side][i] / 2 - 1.5));
        let barrier = Math.max(half + 0.6, Math.min(smoothed[i], limit));
        if (side === this.pitSide && this.inPits(i * track.spacing)) barrier = half + PIT_WALL;
        // Up on a bridge (or the ramps to it), walls right by the track.
        if (track.lift[i] > 0.5) barrier = Math.min(barrier, half + 1.5);
        let runoff: Runoff = 'grass';
        if (track.info.scenery === 'desert') runoff = barrier - half > 12 ? 'asphalt' : 'sand';
        else if (gravel[i] && barrier - half > 18) runoff = 'gravel';
        if (street || track.lift[i] > 0.5) runoff = 'asphalt';
        edges.push({ barrier, kerb: false, runoff, level: barrier + 6 });
      }
      // Runoff kinds change in long stretches, not point to point.
      for (let i = 0; i < n; i++) {
        const prev = edges[(i - 1 + n) % n].runoff;
        if (edges[i].runoff !== prev) {
          let same = 0;
          while (same < 12 && edges[(i + same) % n].runoff === edges[i].runoff) same++;
          if (same < 12) edges[i].runoff = prev;
        }
      }
    }

    // Kerbs where the racing line runs out to the edge in a corner (the apex, and the exit).
    const reach = Math.round(14 / track.spacing);
    for (let i = 0; i < n; i++) {
      const off = line.offset[i];
      if (Math.abs(line.curvature[i]) < 1 / 320 && Math.abs(line.curvature[(i + reach) % n]) < 1 / 320) continue;
      if (Math.abs(off) < half - KERB_REACH) continue;
      const edges = off < 0 ? this.left : this.right;
      for (let k = -reach; k <= reach; k++) edges[(i + k + n) % n].kerb = true;
    }

    this.placeGrandstands(clearance);
    // How far out from the centre line the ground is levelled: past the barrier, and under
    // the pits and grandstands.
    for (const side of [-1, 1] as const) {
      const edges = side < 0 ? this.left : this.right;
      for (let i = 0; i < n; i++) edges[i].level = edges[i].barrier + 6;
      if (side === this.pitSide) {
        for (let i = 0; i < n; i++) if (this.inPits(i * track.spacing)) edges[i].level = half + PIT_WALL + PIT_LANE_WIDTH + GARAGE_DEPTH + 20;
      }
      for (const g of this.grandstands) {
        if (g.side !== side) continue;
        const from = Math.round(g.from / track.spacing);
        const count = Math.round(track.wrap(g.to - g.from) / track.spacing);
        for (let k = -3; k <= count + 3; k++) {
          const e = edges[track.wrapIndex(from + k)];
          e.level = Math.max(e.level, g.lateral + g.rows * STAND_ROW + 10);
        }
      }
    }
  }

  private index(s: number): number {
    return this.track.wrapIndex(Math.round(this.track.wrap(s) / this.track.spacing));
  }

  /** Whether `s` is along the pit straight. */
  inPits(s: number): boolean {
    const d = this.track.delta(0, s);
    return d >= this.pitFrom && d <= this.pitTo;
  }

  /** Where the `k`th car (0 = pole) lines up. */
  gridSlot(k: number): TrackSpot {
    const side = k % 2 === 0 ? this.poleSide : -this.poleSide;
    return { s: this.track.wrap(-(GRID_FIRST + k * GRID_SPACING)), lateral: (side * this.track.width) / 4.4 };
  }

  edge(i: number, side: 1 | -1): Edge {
    return (side < 0 ? this.left : this.right)[this.track.wrapIndex(i)];
  }

  /**
   * Free ground beside point `i` on one side (m from the centre line) before reaching
   * some other part of the track (to its centre line, less its half width).
   */
  private clearance(i: number, side: 1 | -1): number {
    const t = this.track;
    const rx = -t.tz[i] * side;
    const rz = t.tx[i] * side;
    let best = 400;
    for (const j of t.near(t.x[i], t.z[i], 400)) {
      if (Math.abs(t.delta(i * t.spacing, j * t.spacing)) < 160) continue;
      // Over or under a bridge doesn't count.
      if (Math.abs(t.y[j] - t.y[i]) > 5) continue;
      const dx = t.x[j] - t.x[i];
      const dz = t.z[j] - t.z[i];
      const across = dx * rx + dz * rz;
      const along = Math.abs(dx * t.tx[i] + dz * t.tz[i]);
      if (across <= 0 || along > across * 0.7 + 15) continue;
      best = Math.min(best, across - t.width / 2);
    }
    return best;
  }

  /**
   * Grandstands: a long one facing the pits across the start straight, and one on the
   * outside of each of the slowest corners (where the overtaking happens), set back behind
   * the barrier, where there's room.
   */
  private placeGrandstands(clearance: Record<1 | -1, Float32Array>): void {
    const t = this.track;
    const n = t.n;
    const add = (centre: number, length: number, side: 1 | -1, rows: number) => {
      const from = t.wrap(centre - length / 2);
      const to = t.wrap(centre + length / 2);
      let lateral = 0;
      for (let s = 0; s <= length; s += t.spacing) {
        const i = this.index(from + s);
        const e = this.edge(i, side);
        // Behind the barrier, and nowhere near another stretch of track.
        if (clearance[side][i] < e.barrier + 40) return false;
        lateral = Math.max(lateral, e.barrier + 6);
      }
      // Not on the inside of a bend too tight for it to follow.
      for (let s = -20; s <= length + 20; s += t.spacing) {
        const bend = t.curvature[this.index(from + s)] * side;
        if (bend > 0 && 1 / bend < lateral + rows * STAND_ROW + 15) return false;
      }
      const clash = this.grandstands.some((g) => {
        const half = t.wrap(g.to - g.from) / 2;
        return Math.abs(t.delta(t.wrap(g.from + half), centre)) < half + length / 2 + 30;
      });
      if (clash) return false;
      this.grandstands.push({ from, to, side, lateral, rows });
      return true;
    };
    const main = Math.min(260, this.pitTo - this.pitFrom);
    add((this.pitFrom + this.pitTo) / 2, main, (-this.pitSide) as 1 | -1, 14);
    // The slowest corners, slowest first.
    const corners: { i: number; v: number }[] = [];
    for (let i = 0; i < n; i++) {
      const v = this.line.speed[i];
      if (v < this.line.speed[(i - 1 + n) % n] && v <= this.line.speed[(i + 1) % n] && Math.abs(this.line.curvature[i]) > 1 / 200) corners.push({ i, v });
    }
    corners.sort((a, b) => a.v - b.v);
    let placed = 0;
    for (const c of corners) {
      if (placed >= 4) break;
      const side = (this.line.curvature[c.i] > 0 ? -1 : 1) as 1 | -1;
      // Facing the braking zone into the corner.
      if (add(c.i * t.spacing - 60, 110, side, 10)) placed++;
    }
  }
}

/** Each value replaced by the largest within `r` either side (around a loop). */
function maxFilter(values: Float32Array, r: number): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let k = -r; k <= r; k++) m = Math.max(m, values[(i + k + n) % n]);
    out[i] = m;
  }
  return out;
}

/** Average of the values within `r` either side (around a loop). */
function boxFilter(values: Float32Array, r: number): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += values[(i + k + n) % n];
    out[i] = sum / (2 * r + 1);
  }
  return out;
}
