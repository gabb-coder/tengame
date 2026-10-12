import * as THREE from 'three';
import type { CircuitLayout } from '../layout.ts';
import type { Track } from '../track.ts';
import { SPONSORS, type RaceMaterials } from './materials.ts';
import { finish, flat, runs, span, strip } from './ribbon.ts';
import { mergeGeometries } from './surfaces.ts';

const WALL_HEIGHT = 1.05;
const WALL_THICK = 0.5;
const FENCE_HEIGHT = 3.2;
const ARMCO_HEIGHT = 0.8;
const TYRE_DEPTH = 1.1;
const TYRE_HEIGHT = 1.0;
/** Runoff narrower than this (beyond the track's edge) gets a concrete wall and fence, not armco. */
const WALL_WITHIN = 14;

/** A barrier's kind at one point on one side of the track. */
type Kind = 'wall' | 'armco' | 'tyres';

/**
 * The barriers round the circuit: concrete walls topped with catch fencing where the track
 * runs close to them (all the way round a street circuit), steel armco where there's run-off,
 * and walls of tyres on the outside of the corners. Their faces (`solid`) are what the cars
 * hit; advertising boards ride along them.
 */
export function buildBarriers(track: Track, layout: CircuitLayout, m: RaceMaterials, grandstand: (i: number, side: 1 | -1) => boolean): { group: THREE.Group; solid: THREE.BufferGeometry } {
  const group = new THREE.Group();
  group.name = 'barriers';
  const half = track.width / 2;
  const street = track.info.style === 'street';
  const solid: THREE.BufferGeometry[] = [];
  const concrete: THREE.BufferGeometry[] = [];
  const fence: THREE.BufferGeometry[] = [];
  const rails: THREE.BufferGeometry[] = [];
  const tyres: THREE.BufferGeometry[] = [];
  const boards: THREE.BufferGeometry[] = [];
  const posts: THREE.Matrix4[] = [];

  for (const side of [-1, 1] as const) {
    const kind = (i: number): Kind => {
      const e = layout.edge(i, side);
      if (street || e.barrier - half < WALL_WITHIN || grandstand(i, side) || (side === layout.pitSide && layout.inPits(i * track.spacing))) return 'wall';
      return e.runoff === 'gravel' ? 'tyres' : 'armco';
    };
    // Smooth out kinds that would flicker point to point.
    const kinds: Kind[] = [];
    for (let i = 0; i < track.n; i++) kinds.push(kind(i));
    for (let pass = 0; pass < 2; pass++) {
      for (const r of runs(track, (i) => kinds[i] === 'wall')) if (r.to - r.from < 6) for (let i = r.from; i <= r.to; i++) kinds[track.wrapIndex(i)] = 'armco';
      for (const r of runs(track, (i) => kinds[i] === 'tyres')) if (r.to - r.from < 5) for (let i = r.from; i <= r.to; i++) kinds[track.wrapIndex(i)] = 'armco';
    }
    const at = (i: number) => side * layout.edge(track.wrapIndex(i), side).barrier;

    for (const k of ['wall', 'armco', 'tyres'] as Kind[]) {
      for (const r of runs(track, (i) => kinds[i] === k)) {
        const rows = span(r.from - 1, r.to + 1);
        if (k === 'wall') {
          // Concrete: the face toward the track, the top, and the back; fencing above.
          concrete.push(strip(track, rows, at, 0, side, -0.4, WALL_HEIGHT));
          concrete.push(flat(track, rows, at, side, WALL_THICK, WALL_HEIGHT));
          concrete.push(strip(track, rows, at, WALL_THICK, side, -0.4, WALL_HEIGHT));
          solid.push(strip(track, rows, at, 0, side, -0.5, WALL_HEIGHT + 0.6));
          fence.push(strip(track, rows, at, 0.25, side, WALL_HEIGHT, WALL_HEIGHT + FENCE_HEIGHT));
          for (const row of rows) if (row % 3 === 0) posts.push(post(track, row, at(row) + side * 0.25, WALL_HEIGHT, FENCE_HEIGHT + 0.15));
          // Boards along the walls, a sponsor every 12 m.
          for (const row of rows) if (row % 3 === 0 && rows.includes(row + 3)) boards.push(board(track, row, row + 3, at, side, 0.32, 0.92, (row / 3) % SPONSORS.length));
        } else if (k === 'armco') {
          // Two steel rails on posts.
          for (const y of [0.42, 0.68]) rails.push(strip(track, rows, at, 0, side, y - 0.14, y + 0.14));
          solid.push(strip(track, rows, at, 0, side, -0.5, ARMCO_HEIGHT + 0.5));
          for (const row of rows) posts.push(post(track, row, at(row) + side * 0.12, -0.2, ARMCO_HEIGHT + 0.2, 0.1));
          if (track.info.scenery !== 'desert') for (const row of rows) if (row % 8 === 0 && rows.includes(row + 2)) boards.push(board(track, row, row + 2, at, side, 0.85, 1.75, (row / 8) % SPONSORS.length, -0.05));
        } else {
          // Tyres bound in red and white belting, in front of armco.
          const front = (i: number) => at(i) - side * TYRE_DEPTH;
          tyres.push(strip(track, rows, front, 0, side, 0, TYRE_HEIGHT, true));
          tyres.push(flat(track, rows, front, side, TYRE_DEPTH, TYRE_HEIGHT, true));
          for (const y of [0.42, 0.68]) rails.push(strip(track, rows, at, 0, side, y - 0.14, y + 0.14));
          solid.push(strip(track, rows, front, 0, side, -0.5, TYRE_HEIGHT + 0.4));
        }
      }
    }
  }

  const add = (list: THREE.BufferGeometry[], material: THREE.Material, cast = true) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(list), material);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  };
  add(concrete, wallMaterial(m));
  add(fence, m.fence, false);
  add(rails, m.metal);
  add(tyres, m.tyreWall);
  add(boards, m.boards, false);
  if (posts.length) {
    const g = new THREE.CylinderGeometry(0.05, 0.05, 1, 6).translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(g, m.metal, posts.length);
    posts.forEach((p, k) => mesh.setMatrixAt(k, p));
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return { group, solid: mergeGeometries(solid) };
}

/** Concrete walls, drawn from both sides. */
function wallMaterial(m: RaceMaterials): THREE.Material {
  const w = m.concrete.clone();
  w.side = THREE.DoubleSide;
  w.vertexColors = false;
  return w;
}

/** An advertising board facing the track, from row a to row b, between heights lo and hi, showing sponsor `k`. */
function board(track: Track, a: number, b: number, lateral: (i: number) => number, side: 1 | -1, lo: number, hi: number, k: number, out = -0.02): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const u0 = k / SPONSORS.length;
  const u1 = (k + 1) / SPONSORS.length;
  for (let row = a; row <= b; row++) {
    const i = track.wrapIndex(row);
    const l = lateral(row) + side * out;
    const x = track.x[i] - track.tz[i] * l;
    const z = track.z[i] + track.tx[i] * l;
    const y = track.y[i];
    const t = (row - a) / (b - a);
    // Facing a board on the right, the lap runs from your right to your left.
    const u = side > 0 ? u1 - (u1 - u0) * t : u0 + (u1 - u0) * t;
    positions.push(x, y + lo, z, x, y + hi, z);
    uvs.push(u, 0, u, 1);
    if (row > a) {
      const q = (row - a - 1) * 2;
      index.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
    }
  }
  const g = finish(positions, uvs, index);
  return g;
}

function post(track: Track, row: number, lateral: number, bottom: number, height: number, radius = 0.06): THREE.Matrix4 {
  const i = track.wrapIndex(row);
  const x = track.x[i] - track.tz[i] * lateral;
  const z = track.z[i] + track.tx[i] * lateral;
  return new THREE.Matrix4().compose(new THREE.Vector3(x, track.y[i] + bottom, z), new THREE.Quaternion(), new THREE.Vector3(radius / 0.05, height, radius / 0.05));
}
