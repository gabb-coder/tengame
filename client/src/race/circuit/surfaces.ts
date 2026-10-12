import * as THREE from 'three';
import { fbm } from '../../../../shared/noise.ts';
import type { CircuitLayout, Runoff } from '../layout.ts';
import { GARAGE_DEPTH, KERB_WIDTH, PIT_LANE_WIDTH, PIT_WALL } from '../layout.ts';
import type { DrsZone, RacingLine } from '../racingLine.ts';
import type { Track } from '../track.ts';
import type { RaceMaterials } from './materials.ts';
import { chunks, type Column, ribbon, runs, span } from './ribbon.ts';

/** What a tire is on: decides its grip (see race/surfaceGrip). */
export type SurfaceKind = 'road' | 'grass' | 'gravel' | 'sand';

const RUNOFF_SURFACE: Record<Runoff, SurfaceKind> = { grass: 'grass', gravel: 'gravel', asphalt: 'road', sand: 'sand' };

/** Collision geometry gathered per kind of surface. */
export class SurfaceColliders {
  readonly parts = new Map<SurfaceKind, THREE.BufferGeometry[]>();
  add(kind: SurfaceKind, g: THREE.BufferGeometry): void {
    let list = this.parts.get(kind);
    if (!list) this.parts.set(kind, (list = []));
    list.push(g);
  }
}

/**
 * The surfaces you drive on: the track (darker where the cars' rubber has gone down along
 * the racing line), its white edge lines and kerbs, the run-off beyond (grass, gravel,
 * asphalt or sand), the pit lane, the grid boxes and the start line.
 */
export function buildSurfaces(track: Track, line: RacingLine, layout: CircuitLayout, drs: DrsZone[], m: RaceMaterials, colliders: SurfaceColliders): THREE.Group {
  const group = new THREE.Group();
  group.name = 'surfaces';
  const n = track.n;
  const half = track.width / 2;
  const all = span(0, n);
  const add = (g: THREE.BufferGeometry, material: THREE.Material, shadows = true) => {
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = shadows;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    return mesh;
  };

  // The track: rubbered in along the racing line, a little patchy elsewhere.
  const across = Math.max(8, Math.round(track.width));
  const roadColumns: Column[] = Array.from({ length: across + 1 }, (_, k) => ({ lateral: -half + (k / across) * track.width, dy: 0 }));
  const road = (rows: number[]) =>
    ribbon(track, rows, () => roadColumns, {
      color: (i, c, out) => {
        const off = c.lateral - line.offset[i];
        const rubber = Math.exp(-((off / 1.7) ** 2)) * 0.32;
        const patch = fbm(i * track.spacing * 0.02, c.lateral * 0.1, 2, 5) * 0.12;
        const v = 1 - rubber + patch;
        out.setRGB(v, v, v * 1.01);
      },
    });
  for (const rows of chunks(all)) add(road(rows), m.asphalt);
  colliders.add('road', road(all));

  // White lines along both edges.
  for (const side of [-1, 1]) {
    const cols = [
      { lateral: side * (half - 0.32), dy: 0.004 },
      { lateral: side * (half - 0.1), dy: 0.004 },
    ].sort((a, b) => a.lateral - b.lateral);
    for (const rows of chunks(all, 128)) add(ribbon(track, rows, () => cols), m.paint, false);
  }

  // Kerbs: rising a few centimeters to the outside, in red and white blocks.
  for (const side of [-1, 1] as const) {
    for (const r of runs(track, (i) => layout.edge(i, side).kerb)) {
      const rows = span(r.from, r.to);
      const profile = [0, 0.3, 0.75, 1].map((f) => ({ lateral: side * (half - 0.1 + f * (KERB_WIDTH + 0.1)), dy: 0.006 + f * 0.045 * (1 - f * 0.4) }));
      const cols = side < 0 ? [...profile].reverse() : profile;
      const g = ribbon(track, rows, () => cols, { u: (lateral) => (Math.abs(lateral) - half) / KERB_WIDTH });
      add(g, m.kerb);
      colliders.add('road', g);
    }
  }

  // Run-off, side by side by kind, out to the barriers.
  const runoffMaterial: Record<Runoff, THREE.Material> = { grass: m.grass, gravel: m.gravel, asphalt: m.runoff, sand: m.sand };
  for (const side of [-1, 1] as const) {
    for (const kind of ['grass', 'gravel', 'asphalt', 'sand'] as Runoff[]) {
      for (const r of runs(track, (i) => layout.edge(i, side).runoff === kind)) {
        // One row more at each end, under the neighbor, so no gap shows.
        const rows = span(r.from - 1, r.to + 1);
        const cols = (i: number) => {
          const b = layout.edge(i, side).barrier;
          const inner = { lateral: side * (half - 0.02), dy: kind === 'gravel' ? -0.02 : -0.005 };
          const outer = { lateral: side * (b + 0.3), dy: kind === 'gravel' ? -0.02 : -0.005 };
          return side < 0 ? [outer, inner] : [inner, outer];
        };
        for (const part of chunks(rows)) {
          const g = ribbon(track, part, cols, {
            color: kind === 'gravel' ? undefined : (i, c, out) => {
              const v = 0.92 + fbm(i * track.spacing * 0.015, c.lateral * 0.05, 2, 9) * 0.18;
              out.setRGB(v, v, v);
            },
          });
          add(g, runoffMaterial[kind]);
        }
        colliders.add(RUNOFF_SURFACE[kind], ribbon(track, rows, cols));
      }
    }
  }

  // The pit lane, and the apron in front of the garages.
  const pitRows = span(Math.round(layout.pitFrom / track.spacing), Math.round(layout.pitTo / track.spacing));
  const ps = layout.pitSide;
  const laneIn = half + PIT_WALL + 0.4;
  const laneOut = half + PIT_WALL + PIT_LANE_WIDTH + GARAGE_DEPTH * 0.1;
  const laneCols = [
    { lateral: ps * laneIn, dy: 0.02 },
    { lateral: ps * laneOut, dy: 0.02 },
  ].sort((a, b) => a.lateral - b.lateral);
  const lane = ribbon(track, pitRows, () => laneCols, { color: (_, __, out) => out.setRGB(0.95, 0.95, 0.95) });
  add(lane, m.runoff);
  colliders.add('road', lane);
  // The line between the fast lane and the working lane.
  const mid = half + PIT_WALL + PIT_LANE_WIDTH * 0.45;
  const midCols = [
    { lateral: ps * mid, dy: 0.026 },
    { lateral: ps * (mid + 0.15), dy: 0.026 },
  ].sort((a, b) => a.lateral - b.lateral);
  add(ribbon(track, pitRows, () => midCols), m.paint, false);

  // Grid boxes: a line across in front of each car, and short lines down its sides.
  const marks: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 20; k++) {
    const slot = layout.gridSlot(k);
    const front = slot.s + 2.9;
    marks.push(patch(track, front - 0.15, front, slot.lateral - 1.1, slot.lateral + 1.1));
    for (const e of [-1, 1]) marks.push(patch(track, front - 1.6, front, slot.lateral + e * 1.1 - 0.1, slot.lateral + e * 1.1));
  }
  // DRS detection and activation lines across the track.
  for (const z of drs) {
    for (const s of [z.detection, z.start]) for (let l = -half + 0.5; l < half - 0.5; l += 1.6) marks.push(patch(track, s - 0.1, s + 0.1, l, l + 0.8));
  }
  add(mergeGeometries(marks), m.paint, false);

  // The start and finish line: a chequered band across the track.
  const flagCols = 16;
  const cells: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  for (let row = 0; row < 2; row++) {
    for (let c = 0; c < flagCols; c++) {
      const a = -half + (c / flagCols) * track.width;
      const b = a + track.width / flagCols;
      ((row + c) % 2 ? dark : cells).push(patch(track, row * 0.6 - 0.6, row * 0.6, a, b));
    }
  }
  add(mergeGeometries(cells), m.paint, false);
  const black = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  add(mergeGeometries(dark), black, false);
  return group;
}

/** A small flat painted patch on the track: from s0 to s1 along, a to b across. */
function patch(track: Track, s0: number, s1: number, a: number, b: number): THREE.BufferGeometry {
  const p = { x: 0, y: 0, z: 0 };
  const corners = [
    [s0, a],
    [s0, b],
    [s1, a],
    [s1, b],
  ].map(([s, l]) => {
    track.pointAt(s, l, p);
    return [p.x, p.y + 0.006, p.z];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  return g;
}

/** Joins indexed geometries with the same attributes into one. */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = Object.keys(list[0].attributes).filter((a) => list.every((g) => g.attributes[a]));
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = list[0].attributes[name].itemSize;
    const total = list.reduce((t, g) => t + g.attributes[name].count, 0);
    const array = new Float32Array(total * size);
    let offset = 0;
    for (const g of list) {
      array.set(g.attributes[name].array as ArrayLike<number>, offset * size);
      offset += g.attributes[name].count;
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  const index: number[] = [];
  let base = 0;
  for (const g of list) {
    const idx = g.index ? (g.index.array as ArrayLike<number>) : Array.from({ length: g.attributes.position.count }, (_, k) => k);
    for (let k = 0; k < idx.length; k++) index.push(idx[k] + base);
    base += g.attributes.position.count;
  }
  out.setIndex(index);
  return out;
}
