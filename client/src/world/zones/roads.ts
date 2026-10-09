import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Surface, WorldRoad } from '../../../../shared/world.ts';
import { boxCollider } from '../town/colliders.ts';
import type { TownMaterials } from '../town/materials.ts';
import { box, IDENTITY, MeshBuilder, placement } from '../town/meshBuilder.ts';
import type { ZoneMaterials } from './materials.ts';

/**
 * Where two roads overlap at a junction, the one drawn higher shows: highways over zone
 * roads, paved roads over dirt tracks. (The ground sits a few centimeters below them all.)
 */
const LIFT: Record<Surface, number> = { asphalt: 0.012, cobble: 0.008, sandstone: 0.008, metal: 0.008, snow: 0.008, dirt: 0 };
const DASH = 3;
const GAP = 3;
const LINE_WIDTH = 0.15;
const NO_SHADOW = { castShadow: false };
/** Roads are drawn this far above the ground under them. */
const SURFACE = 0.035;

/** The path with points every `step` meters (heights interpolated). */
function resample(path: { x: number; y: number; z: number }[], step: number): { x: number; y: number; z: number }[] {
  const out = [path[0]];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/** Road surfaces, center lines and bridges for every road outside the town. */
export function buildWorldRoads(roads: WorldRoad[], zm: ZoneMaterials, m: TownMaterials, physics: RAPIER.World, ground: (x: number, z: number) => number): THREE.Group {
  // Roads are long, so split them into chunks for culling.
  const chunks = new Map<string, MeshBuilder>();
  const builderAt = (x: number, z: number) => {
    const key = `${Math.floor(x / 200)},${Math.floor(z / 200)}`;
    if (!chunks.has(key)) chunks.set(key, new MeshBuilder());
    return chunks.get(key)!;
  };
  for (const road of roads) {
    const lift = LIFT[road.surface];
    const mat = zm.roads[road.surface];
    let start = 0;
    // Ribbons for each unbroken stretch between bridges.
    for (let i = 0; i <= road.bridge.length; i++) {
      if (i < road.bridge.length && !road.bridge[i]) continue;
      if (i > start) {
        // Dense, and draped on the ground itself, so the ground never pokes through.
        const stretch = resample(road.path.slice(start, i + 1), 1.5);
        for (let s = 0; s < stretch.length - 1; s += 80) {
          const part = stretch.slice(s, Math.min(stretch.length, s + 81));
          const mid = part[Math.floor(part.length / 2)];
          builderAt(mid.x, mid.z).add(ribbon(part, road.width, lift + SURFACE, ground), mat, IDENTITY, undefined, NO_SHADOW);
        }
        if (road.lines) addDashes(stretch, lift + SURFACE + 0.006, (x, z) => builderAt(x, z), m.markingYellow, ground);
      }
      start = i + 1;
    }
    buildBridges(road, zm, physics, builderAt);
  }
  const group = new THREE.Group();
  group.name = 'world-roads';
  for (const [key, b] of chunks) group.add(b.build(`roads-${key}`));
  return group;
}

/**
 * A strip along `path`, `width` wide, with UVs in world meters (so overlaps match). With
 * `ground`, it lies `lift` above the ground; otherwise `lift` above the path's heights.
 */
export function ribbon(path: { x: number; y: number; z: number }[], width: number, lift = 0, ground?: (x: number, z: number) => number): THREE.BufferGeometry {
  const across = ground ? [-1, -0.5, 0, 0.5, 1] : [-1, 1];
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  path.forEach((p, i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    // Left of the direction of travel.
    const nx = -tz / len;
    const nz = tx / len;
    for (const side of across) {
      const x = p.x + nx * side * (width / 2);
      const z = p.z + nz * side * (width / 2);
      positions.push(x, (ground ? ground(x, z) : p.y) + lift, z);
      uvs.push(x, -z);
      normals.push(0, 1, 0);
    }
    if (i > 0) {
      const n = across.length;
      for (let c = 0; c < n - 1; c++) {
        const k = (i - 1) * n + c;
        index.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(index);
  // Make sure it faces up whichever way the path runs (the first triangle is 0, n, 1).
  const p0 = new THREE.Vector3().fromArray(positions, 0);
  const p1 = new THREE.Vector3().fromArray(positions, 3);
  const p2 = new THREE.Vector3().fromArray(positions, across.length * 3);
  if (p2.sub(p0).cross(p1.sub(p0)).y < 0) {
    const flipped: number[] = [];
    for (let i = 0; i < index.length; i += 3) flipped.push(index[i], index[i + 2], index[i + 1]);
    g.setIndex(flipped);
  }
  return g.toNonIndexed();
}

/** Dashed center line along a path. */
function addDashes(path: { x: number; y: number; z: number }[], lift: number, builderAt: (x: number, z: number) => MeshBuilder, mat: THREE.Material, ground: (x: number, z: number) => number): void {
  let along = 0;
  let dash: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / 0.75));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      const phase = (along + len * t) % (DASH + GAP);
      if (phase < DASH) dash.push(p);
      else if (dash.length > 1) {
        builderAt(dash[0].x, dash[0].z).add(ribbon(dash, LINE_WIDTH, lift, (x, z) => ground(x, z)), mat, IDENTITY, undefined, NO_SHADOW);
        dash = [];
      } else dash = [];
    }
    along += len;
  }
}

/** Plank decks with rails over each bridged stretch, with colliders. */
function buildBridges(road: WorldRoad, zm: ZoneMaterials, physics: RAPIER.World, builderAt: (x: number, z: number) => MeshBuilder): void {
  const deckWidth = road.width + 1;
  const thick = 0.35;
  road.bridge.forEach((isBridge, i) => {
    if (!isBridge) return;
    const a = road.path[i];
    const b = road.path[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const pitch = -Math.atan2(b.y - a.y, len);
    const matrix = placement((a.x + b.x) / 2, (a.y + b.y) / 2 - thick / 2 + 0.02, (a.z + b.z) / 2, yaw, pitch);
    const builder = builderAt(a.x, a.z);
    builder.add(box(deckWidth, thick, len + 0.05, 1), zm.planks, matrix, '#a07850');
    boxCollider(physics, matrix, { x: 0, y: 0, z: 0 }, { x: deckWidth, y: thick, z: len + 0.05 });
    // Rails: a post at each end of the segment and a beam along it, both sides.
    for (const side of [-1, 1]) {
      const x = side * (deckWidth / 2 - 0.12);
      builder.add(box(0.16, 1.1, 0.16), zm.planks, matrix.clone().multiply(placement(x, 0.55 + thick / 2, -len / 2)), '#7a5a3a');
      builder.add(box(0.1, 0.12, len), zm.planks, matrix.clone().multiply(placement(x, 1.05 + thick / 2, 0)), '#8a6a48');
      builder.add(box(0.08, 0.08, len), zm.planks, matrix.clone().multiply(placement(x, 0.55 + thick / 2, 0)), '#8a6a48');
      boxCollider(physics, matrix, { x, y: 0.6 + thick / 2, z: 0 }, { x: 0.2, y: 1.2, z: len });
    }
  });
}
