import * as THREE from 'three';
import { mulberry32 } from '../../../../shared/town.ts';
import { GARAGE_DEPTH, PIT_LANE_WIDTH, PIT_WALL, STAND_RISE, STAND_ROW, type CircuitLayout, type Grandstand } from '../layout.ts';
import { TEAMS } from '../../../../shared/racing.ts';
import type { Track } from '../track.ts';
import type { Ground } from './ground.ts';
import type { RaceMaterials } from './materials.ts';
import { type Column, finish, ribbon, span, strip } from './ribbon.ts';
import { mergeGeometries } from './surfaces.ts';

/** Height of the first row of seats above the ground, and of the roof above the top row. */
const STAND_BASE = 1.3;
const ROOF_CLEAR = 3.4;
const SHIRTS = ['#d64545', '#e0b030', '#2f7fd8', '#ffffff', '#f2f2f2', '#2d2d2d', '#3c9d4a', '#ef7d2d', '#8e44ad', '#c0392b', '#1abc9c', '#f5d76e'];
const SKIN = ['#f1c6a6', '#d9a47e', '#b57a55', '#8d5a3b', '#5c3a26', '#e8b896'];
const STAND_COLORS = ['#2c5aa0', '#b8282e', '#3a8a46', '#8a8f96', '#d39b22'];

/**
 * Grandstands: rows of seats stepping up from behind the barrier, a roof over them, and a
 * crowd, more or fewer by graphics quality (`crowd` 0..1 is the share of seats taken).
 */
export function buildGrandstands(track: Track, stands: Grandstand[], m: RaceMaterials, crowd: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'grandstands';
  const rng = mulberry32(17);
  const shells: THREE.BufferGeometry[] = [];
  const roofs: THREE.BufferGeometry[] = [];
  const people: { p: THREE.Vector3; yaw: number }[] = [];
  const p = { x: 0, y: 0, z: 0 };
  stands.forEach((g, k) => {
    const color = new THREE.Color(STAND_COLORS[k % STAND_COLORS.length]);
    const concrete = new THREE.Color('#9a9a96');
    const from = Math.round(g.from / track.spacing);
    const rows = span(from, from + Math.round(track.wrap(g.to - g.from) / track.spacing));
    // The stepped profile, front to back: each step's tread (seats) and riser (concrete).
    const profile: (Column & { tread?: boolean })[] = [{ lateral: 0, dy: -3 }];
    for (let r = 0; r < g.rows; r++) {
      const y = STAND_BASE + r * STAND_RISE;
      profile.push({ lateral: r * STAND_ROW, dy: y - (r === 0 ? 0 : STAND_RISE) }, { lateral: r * STAND_ROW, dy: y });
      profile.push({ lateral: r * STAND_ROW, dy: y, tread: true }, { lateral: (r + 1) * STAND_ROW, dy: y, tread: true });
    }
    const top = STAND_BASE + (g.rows - 1) * STAND_RISE;
    const depth = g.rows * STAND_ROW;
    profile.push({ lateral: depth, dy: top }, { lateral: depth, dy: top + ROOF_CLEAR + 0.6 }, { lateral: depth + 0.3, dy: top + ROOF_CLEAR + 0.6 }, { lateral: depth + 0.3, dy: -3 });
    const cols = profile.map((c) => ({ ...c, lateral: g.side * (g.lateral + c.lateral) }));
    const ordered = g.side < 0 ? [...cols].reverse() : cols;
    shells.push(
      ribbon(track, rows, () => ordered, {
        color: (_, c, out) => out.copy((c as (typeof cols)[number]).tread ? color : concrete),
      }),
    );
    // End walls.
    for (const row of [rows[0], rows[rows.length - 1]]) {
      const i = track.wrapIndex(row);
      const ring = cols.map((c) => [track.x[i] - track.tz[i] * c.lateral, track.y[i] + c.dy, track.z[i] + track.tx[i] * c.lateral]);
      const positions: number[] = [];
      const index: number[] = [];
      for (let c = 1; c < ring.length - 1; c++) {
        positions.push(...ring[0], ...ring[c], ...ring[c + 1]);
        index.push(positions.length / 3 - 3, positions.length / 3 - 2, positions.length / 3 - 1);
      }
      const end = finish(positions, positions.map(() => 0).slice(0, (positions.length / 3) * 2), index);
      end.setAttribute('color', new THREE.Float32BufferAttribute(positions.map(() => 0.6), 3));
      shells.push(end);
    }
    // The roof, sloping up toward the track.
    const roof: Column[] = [
      { lateral: g.side * (g.lateral - 1.2), dy: top + ROOF_CLEAR + 1.1 },
      { lateral: g.side * (g.lateral + depth + 0.3), dy: top + ROOF_CLEAR + 0.6 },
    ];
    roofs.push(ribbon(track, rows, () => (g.side < 0 ? [...roof].reverse() : roof)));
    // The crowd: one seat every 0.6 m along each row.
    const length = rows.length - 1;
    for (let s = 0.4; s < length * track.spacing - 0.4; s += 0.6) {
      for (let r = 0; r < g.rows; r++) {
        if (rng() > crowd) continue;
        track.pointAt(g.from + s, g.side * (g.lateral + (r + 0.62) * STAND_ROW), p);
        const yaw = track.heading(g.from + s) + (g.side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.4;
        people.push({ p: new THREE.Vector3(p.x, p.y + STAND_BASE + r * STAND_RISE, p.z), yaw });
      }
    }
  });
  if (shells.length) {
    const shell = new THREE.Mesh(mergeGeometries(shells), m.painted);
    shell.castShadow = shell.receiveShadow = true;
    group.add(shell);
    const roof = new THREE.Mesh(mergeGeometries(roofs), new THREE.MeshStandardMaterial({ color: '#7d838a', roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }));
    roof.castShadow = true;
    group.add(roof);
  }
  if (people.length) group.add(...spectators(people, m, rng));
  return group;
}

/** Seated spectators: shirts (colored bodies) and heads, as two instanced meshes. */
function spectators(people: { p: THREE.Vector3; yaw: number }[], m: RaceMaterials, rng: () => number): THREE.InstancedMesh[] {
  const body = new THREE.BoxGeometry(0.42, 0.58, 0.3).translate(0, 0.32, -0.02);
  const head = new THREE.IcosahedronGeometry(0.11, 0).translate(0, 0.74, 0);
  const bodies = new THREE.InstancedMesh(body, m.crowd, people.length);
  const heads = new THREE.InstancedMesh(head, m.crowd, people.length);
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  people.forEach((s, k) => {
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.yaw);
    const size = 0.92 + rng() * 0.16;
    matrix.compose(s.p, q, new THREE.Vector3(size, size, size));
    bodies.setMatrixAt(k, matrix);
    heads.setMatrixAt(k, matrix);
    bodies.setColorAt(k, color.set(SHIRTS[Math.floor(rng() * SHIRTS.length)]));
    heads.setColorAt(k, color.set(SKIN[Math.floor(rng() * SKIN.length)]));
  });
  for (const mesh of [bodies, heads]) mesh.computeBoundingSphere();
  return [bodies, heads];
}

/**
 * The pit building along the pit lane: a garage for each team at the front (in its
 * colors), glass-fronted hospitality floors above, under a long roof.
 */
export function buildPits(track: Track, layout: CircuitLayout, m: RaceMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pits';
  const side = layout.pitSide;
  const half = track.width / 2;
  const front = half + PIT_WALL + PIT_LANE_WIDTH + 0.6;
  const back = front + GARAGE_DEPTH;
  const rows = span(Math.round((layout.pitFrom + 30) / track.spacing), Math.round((layout.pitTo - 15) / track.spacing));
  const at = () => side * front;
  const garages = new THREE.MeshStandardMaterial({ map: garageTexture(), roughness: 0.7 });
  const glassFront = () => side * (front + 1.6);
  const add = (g: THREE.BufferGeometry, material: THREE.Material) => {
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  const doors = strip(track, rows, at, 0, side, 0, 4.8, true);
  // Garage fronts: one team every 9 m (U runs along the lap in meters; the texture holds ten).
  const uv = doors.getAttribute('uv');
  for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) / 90);
  add(doors, doubleSided(garages));
  add(strip(track, rows, glassFront, 0, side, 4.8, 12.4), doubleSided(m.glass));
  const slab = (lo: number, hi: number, y: number) => {
    const cols: Column[] = [
      { lateral: side * lo, dy: y },
      { lateral: side * hi, dy: y },
    ];
    return ribbon(track, rows, () => (side < 0 ? [...cols].reverse() : cols));
  };
  const concrete = doubleSided(m.concrete);
  add(mergeGeometries([slab(front - 0.4, back, 4.8), slab(front - 1.5, back + 0.4, 12.6), slab(front - 1.5, back + 0.4, 13.0)]), concrete);
  add(strip(track, rows, () => side * back, 0, side, -3, 13), concrete);
  add(strip(track, rows, at, 0, side, -3, 0.02), concrete);
  // Closed ends, and walls across the pit lane's ends.
  for (const row of [rows[0], rows[rows.length - 1]]) {
    add(endWall(track, row, side * front, side * back, -3, 13), concrete);
    add(endWall(track, row, side * (half + PIT_WALL), side * front, -1, 1.1), concrete);
  }
  return group;
}

/** A wall straight across from `a` to `b` (lateral) at a track point, `bottom` to `top`. */
function endWall(track: Track, row: number, a: number, b: number, bottom: number, top: number): THREE.BufferGeometry {
  const i = track.wrapIndex(row);
  const pt = (l: number, h: number) => [track.x[i] - track.tz[i] * l, track.y[i] + h, track.z[i] + track.tx[i] * l];
  const positions = [...pt(a, bottom), ...pt(b, bottom), ...pt(a, top), ...pt(b, top)];
  return finish(positions, [0, 0, Math.abs(b - a), 0, 0, top - bottom, Math.abs(b - a), top - bottom], [0, 1, 2, 1, 3, 2]);
}

/** Garage fronts for the ten teams, side by side: open doors, the team's colors above. */
function garageTexture(): THREE.CanvasTexture {
  const w = 2048;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const each = w / TEAMS.length;
  TEAMS.forEach((t, k) => {
    const x = k * each;
    ctx.fillStyle = '#d8d8d4';
    ctx.fillRect(x, 0, each, h);
    ctx.fillStyle = t.primary;
    ctx.fillRect(x + 4, 4, each - 8, h * 0.2);
    ctx.fillStyle = t.secondary;
    ctx.font = `bold ${Math.round(h * 0.13)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(t.name.toUpperCase(), x + each / 2, h * 0.16);
    // The open door: a dim, lit interior.
    const grad = ctx.createLinearGradient(0, h * 0.28, 0, h);
    grad.addColorStop(0, '#3a3c40');
    grad.addColorStop(1, '#1b1c1f');
    ctx.fillStyle = grad;
    ctx.fillRect(x + each * 0.08, h * 0.28, each * 0.84, h * 0.72);
    ctx.fillStyle = t.primary;
    ctx.fillRect(x + each * 0.08, h * 0.95, each * 0.84, h * 0.05);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The start lights: five pairs of red lights over the grid. `set(n)` lights the first n pairs. */
export interface StartLights {
  group: THREE.Group;
  set(lit: number): void;
}

/**
 * The gantry over the start line: posts either side (the pit-side one on the pit wall), a
 * beam across, and the start lights hanging from it, facing the grid.
 */
export function buildGantry(track: Track, layout: CircuitLayout, m: RaceMaterials): StartLights {
  const group = new THREE.Group();
  group.name = 'gantry';
  const half = track.width / 2;
  const i = 0;
  const left = -(layout.pitSide < 0 ? half + PIT_WALL + 0.25 : layout.edge(i, -1).barrier + 1.2);
  const right = layout.pitSide > 0 ? half + PIT_WALL + 0.25 : layout.edge(i, 1).barrier + 1.2;
  const base = new THREE.Vector3(track.x[i], track.y[i], track.z[i]);
  const heading = track.heading(0);
  const frame = new THREE.Group();
  frame.position.copy(base);
  frame.rotation.y = heading;
  group.add(frame);
  // Local frame: +Z along the lap, -X to the driver's right.
  const steel = new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.5, metalness: 0.6 });
  for (const l of [left, right]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), steel);
    post.position.set(-l, 4, 0);
    post.castShadow = true;
    frame.add(post);
  }
  const span = right - left;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.6, 1.1, 0.7), steel);
  beam.position.set(-(left + right) / 2, 7.6, 0);
  beam.castShadow = true;
  frame.add(beam);
  // A sponsor board along the beam, facing the grid.
  const board = new THREE.Mesh(new THREE.PlaneGeometry(span, 1), m.boards);
  board.position.set(-(left + right) / 2, 7.6, -0.36);
  board.rotation.y = Math.PI;
  frame.add(board);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 0.4), steel);
  panel.position.set(0, 6.4, -0.2);
  frame.add(panel);
  const lamps: THREE.MeshStandardMaterial[] = [];
  const bulb = new THREE.CircleGeometry(0.16, 16);
  for (let c = 0; c < 5; c++) {
    const mat = new THREE.MeshStandardMaterial({ color: '#2a0000', emissive: '#ff1a0a', emissiveIntensity: 0, roughness: 0.3 });
    lamps.push(mat);
    for (const row of [0, 1]) {
      const lamp = new THREE.Mesh(bulb, mat);
      lamp.position.set((c - 2) * 0.62, 6.15 + row * 0.5, -0.41);
      lamp.rotation.y = Math.PI;
      frame.add(lamp);
    }
  }
  return {
    group,
    set: (lit) => lamps.forEach((mat, k) => (mat.emissiveIntensity = k < lit ? 6 : 0)),
  };
}

/** Bridges where the track crosses itself: a deck under the upper road, piers, and abutments at its ends. */
export function buildBridges(track: Track, ground: Ground, m: RaceMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bridges';
  const half = track.width / 2 + 1.6;
  const deck: THREE.BufferGeometry[] = [];
  const concrete = doubleSided(m.concrete);
  const on = (i: number) => track.lift[track.wrapIndex(i)] > 5.5;
  for (let i = 0; i < track.n; i++) {
    if (!on(i) || on(i - 1)) continue;
    let end = i;
    while (on(end + 1) && end - i < track.n) end++;
    const rows = span(i - 1, end + 1);
    const bottom: Column[] = [
      { lateral: half, dy: -1.3 },
      { lateral: -half, dy: -1.3 },
    ];
    deck.push(ribbon(track, rows, () => bottom));
    for (const s of [-1, 1] as const) deck.push(strip(track, rows, () => s * half, 0, s, -1.3, 0));
    // Abutments: the embankment's end faces, down to the ground.
    for (const row of [i - 1, end + 1]) {
      const k = track.wrapIndex(row);
      const drop = track.y[k] - ground.heightAt(track.x[k], track.z[k]);
      deck.push(endWall(track, row, -half - 1, half + 1, -drop - 1, 0));
    }
    // Piers every 24 m, clear of the road beneath.
    const step = Math.round(24 / track.spacing);
    for (let row = i + step; row < end; row += step) {
      for (const l of [-half * 0.6, half * 0.6]) {
        const k = track.wrapIndex(row);
        const x = track.x[k] - track.tz[k] * l;
        const z = track.z[k] + track.tx[k] * l;
        const below = track.project(x, z, undefined, ground.heightAt(x, z));
        if (below.distance < track.width / 2 + 4 && Math.abs(track.delta(below.s, row * track.spacing)) > 50) continue;
        const g0 = ground.heightAt(x, z);
        const h = track.y[k] - 1.3 - g0;
        if (h < 1) continue;
        deck.push(new THREE.BoxGeometry(1.2, h, 1.2).translate(x, g0 + h / 2, z));
      }
    }
  }
  if (deck.length) {
    const g = mergeGeometries(deck);
    const mesh = new THREE.Mesh(g, concrete);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Floodlight towers round a night circuit: poles behind the barriers with banks of lamps angled at the track. */
export function buildFloodlights(track: Track, layout: CircuitLayout, m: RaceMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'floodlights';
  const spots: THREE.Matrix4[] = [];
  const heads: THREE.Matrix4[] = [];
  const every = Math.round(36 / track.spacing);
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  for (let i = 0, k = 0; i < track.n; i += every, k++) {
    const side = (k % 2 ? 1 : -1) as 1 | -1;
    const l = side * (layout.edge(i, side).barrier + 3.5);
    const x = track.x[i] - track.tz[i] * l;
    const z = track.z[i] + track.tx[i] * l;
    const y = track.y[i];
    spots.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.identity(), new THREE.Vector3(1, 16, 1)));
    // The lamp bank leans out over the track.
    euler.set(0.5, track.heading(i * track.spacing) + (side > 0 ? Math.PI / 2 : -Math.PI / 2), 0, 'YXZ');
    heads.push(new THREE.Matrix4().compose(new THREE.Vector3(x + track.tz[i] * side * 0.8, y + 16, z - track.tx[i] * side * 0.8), new THREE.Quaternion().setFromEuler(euler), new THREE.Vector3(1, 1, 1)));
  }
  const pole = new THREE.CylinderGeometry(0.16, 0.24, 1, 8).translate(0, 0.5, 0);
  const poles = new THREE.InstancedMesh(pole, m.metal, spots.length);
  spots.forEach((s, k) => poles.setMatrixAt(k, s));
  const bank = new THREE.BoxGeometry(2.6, 1.2, 0.3);
  bank.setAttribute('color', new THREE.Float32BufferAttribute(new Array(bank.attributes.position.count * 3).fill(1), 3));
  const lamps = new THREE.InstancedMesh(bank, m.lamp, heads.length);
  heads.forEach((h, k) => lamps.setMatrixAt(k, h));
  for (const mesh of [poles, lamps]) mesh.computeBoundingSphere();
  group.add(poles, lamps);
  return group;
}

/** Marshal posts every few hundred meters behind the barriers: little white huts with an orange roof. */
export function buildMarshalPosts(track: Track, layout: CircuitLayout, m: RaceMaterials): THREE.Group {
  const group = new THREE.Group();
  const every = Math.round(320 / track.spacing);
  const hut = new THREE.BoxGeometry(2, 2.3, 2).translate(0, 1.15, 0);
  const roof = new THREE.BoxGeometry(2.4, 0.2, 2.4).translate(0, 2.4, 0);
  const g = mergeGeometries([withColor(hut, '#f2f2ee'), withColor(roof, '#ef7d1a')]);
  const places: THREE.Matrix4[] = [];
  for (let i = every / 2, k = 0; i < track.n; i += every, k++) {
    const side = (k % 2 ? 1 : -1) as 1 | -1;
    const e = layout.edge(i, side);
    if (layout.inPits(i * track.spacing) || track.lift[i] > 0.5) continue;
    const l = side * (e.barrier + 2.4);
    const x = track.x[i] - track.tz[i] * l;
    const z = track.z[i] + track.tx[i] * l;
    places.push(new THREE.Matrix4().compose(new THREE.Vector3(x, track.y[i], z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, track.heading(i * track.spacing)), new THREE.Vector3(1, 1, 1)));
  }
  const mesh = new THREE.InstancedMesh(g, m.painted, places.length);
  places.forEach((p, k) => mesh.setMatrixAt(k, p));
  mesh.castShadow = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
  return group;
}

function withColor(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const out = g.index ? g : withIndex(g);
  out.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: out.attributes.position.count }, () => [c.r, c.g, c.b]).flat(), 3));
  return out;
}

function withIndex(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.setIndex(Array.from({ length: g.attributes.position.count }, (_, k) => k));
  return g;
}

function doubleSided<T extends THREE.Material>(material: T): T {
  const c = material.clone() as T;
  c.side = THREE.DoubleSide;
  return c;
}
