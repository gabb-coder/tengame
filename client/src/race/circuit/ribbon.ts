import * as THREE from 'three';
import type { Track } from '../track.ts';

/** One line of vertices across the track: meters right of the centre line, and height above the road. */
export interface Column {
  lateral: number;
  dy: number;
}

export interface RibbonOptions {
  /** U texture coordinate for a column (default: its lateral, in meters). */
  u?: (lateral: number, column: number) => number;
  /** Vertex color for a point (default none). */
  color?: (i: number, column: Column, out: THREE.Color) => void;
  /** Flip the triangles (for surfaces seen from the other side). */
  flip?: boolean;
}

/** Track point indices from `from` to `to` inclusive (`to` >= `from`; either may lie past the loop's ends). */
export function span(from: number, to: number): number[] {
  const out: number[] = [];
  for (let k = from; k <= to; k++) out.push(k);
  return out;
}

/**
 * A strip of surface following the track through the points `rows` (indices that may run
 * past the end of the loop, so a strip can wrap round), with `columns(i)` across it at
 * each. V is the distance along the lap (m), U the lateral (m) unless `u` says otherwise.
 */
export function ribbon(track: Track, rows: number[], columns: (i: number) => Column[], options: RibbonOptions = {}): THREE.BufferGeometry {
  const first = columns(track.wrapIndex(rows[0]));
  const across = first.length;
  const positions = new Float32Array(rows.length * across * 3);
  const uvs = new Float32Array(rows.length * across * 2);
  const colors = options.color ? new Float32Array(rows.length * across * 3) : null;
  const color = new THREE.Color();
  rows.forEach((row, r) => {
    const i = track.wrapIndex(row);
    const cols = columns(i);
    const rx = -track.tz[i];
    const rz = track.tx[i];
    const s = row * track.spacing;
    cols.forEach((c, k) => {
      const v = r * across + k;
      positions[v * 3] = track.x[i] + rx * c.lateral;
      positions[v * 3 + 1] = track.y[i] + c.dy;
      positions[v * 3 + 2] = track.z[i] + rz * c.lateral;
      uvs[v * 2] = options.u ? options.u(c.lateral, k) : c.lateral;
      uvs[v * 2 + 1] = s;
      if (colors && options.color) {
        options.color(i, c, color);
        colors.set([color.r, color.g, color.b], v * 3);
      }
    });
  });
  const index: number[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    for (let k = 0; k < across - 1; k++) {
      const a = r * across + k;
      const b = a + 1;
      const c = a + across;
      const d = c + 1;
      // Counter-clockwise seen from above: rows run along the track, columns to the right.
      if (options.flip) index.push(a, c, b, b, c, d);
      else index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (colors) g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * Cuts a run of rows into pieces of about `size` rows (sharing their end rows), so each
 * piece can be skipped when it's off screen.
 */
export function chunks(rows: number[], size = 64): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < rows.length - 1; k += size) out.push(rows.slice(k, Math.min(rows.length, k + size + 1)));
  return out;
}

/** Contiguous runs of track points (going round the loop) where `test` holds. */
export function runs(track: Track, test: (i: number) => boolean): { from: number; to: number }[] {
  const n = track.n;
  let start = 0;
  while (start < n && test(start)) start++;
  if (start === n) return [{ from: 0, to: n }];
  const out: { from: number; to: number }[] = [];
  let from = -1;
  for (let k = 1; k <= n; k++) {
    const i = start + k;
    const on = test(track.wrapIndex(i));
    if (on && from < 0) from = i;
    if ((!on || k === n) && from >= 0) {
      out.push({ from, to: on ? i : i - 1 });
      from = -1;
    }
  }
  return out;
}

/**
 * An upright strip along the track at `lateral(i)` (+ `out` meters further from the track
 * on `side`), from `bottom` to `top` above the road. UVs: along the lap, and up.
 */
export function strip(track: Track, rows: number[], lateral: (i: number) => number, out: number, side: 1 | -1, bottom: number, top: number, unitV = false): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  rows.forEach((row, r) => {
    const i = track.wrapIndex(row);
    const l = lateral(row) + side * out;
    const x = track.x[i] - track.tz[i] * l;
    const z = track.z[i] + track.tx[i] * l;
    const y = track.y[i];
    positions.push(x, y + bottom, z, x, y + top, z);
    const s = row * track.spacing;
    uvs.push(s, unitV ? 0 : bottom, s, unitV ? 1 : top);
    if (r > 0) {
      const a = (r - 1) * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  return finish(positions, uvs, index);
}

/** A flat top `width` wide, at `height`, from `lateral(i)` outward. */
export function flat(track: Track, rows: number[], lateral: (i: number) => number, side: 1 | -1, width: number, height: number, unitV = false): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  rows.forEach((row, r) => {
    const i = track.wrapIndex(row);
    const y = track.y[i] + height;
    for (const w of [0, width]) {
      const l = lateral(row) + side * w;
      positions.push(track.x[i] - track.tz[i] * l, y, track.z[i] + track.tx[i] * l);
      uvs.push(row * track.spacing, unitV ? w / width : w);
    }
    if (r > 0) {
      const a = (r - 1) * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  return finish(positions, uvs, index);
}

export function finish(positions: number[], uvs: number[], index: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
