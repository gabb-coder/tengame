import * as THREE from 'three';
import { fbm } from '../../../../shared/noise.ts';
import { mulberry32 } from '../../../../shared/town.ts';
import { conifer, palm } from '../../world/zones/kit.ts';
import type { CircuitLayout } from '../layout.ts';
import type { Track } from '../track.ts';
import type { Ground } from './ground.ts';
import type { RaceMaterials } from './materials.ts';
import { mergeGeometries } from './surfaces.ts';

type TreeKind = 'conifer' | 'broadleaf' | 'palm';

/** How thickly each kind of country is wooded: trees per hectare near the track, and which kinds. */
const WOODS: Record<string, { density: number; kinds: TreeKind[]; patchy: number }> = {
  forest: { density: 22, kinds: ['broadleaf', 'broadleaf', 'conifer'], patchy: 0.25 },
  alpine: { density: 18, kinds: ['conifer', 'conifer', 'conifer', 'broadleaf'], patchy: 0.4 },
  temperate: { density: 9, kinds: ['broadleaf'], patchy: 0.55 },
  tropical: { density: 12, kinds: ['broadleaf', 'palm', 'palm'], patchy: 0.45 },
  desert: { density: 0.6, kinds: ['palm'], patchy: 0.7 },
  city: { density: 1.2, kinds: ['broadleaf', 'palm'], patchy: 0.6 },
};

/** Trees are kept this far from anything levelled for the circuit (m), and no further than FAR from the track. */
const CLEAR = 10;
const FAR = 650;

/**
 * The country round the circuit: woods and copses (pines in the hills, palms in the tropics
 * and the desert), and for the street circuits, the city's blocks of flats and towers.
 * `amount` (0..1) thins it all out on low graphics settings.
 */
export function buildScenery(track: Track, layout: CircuitLayout, ground: Ground, m: RaceMaterials, amount: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scenery';
  const scenery = track.info.scenery;
  const rng = mulberry32(31 + track.n);
  const city = scenery === 'city';
  if (city) group.add(buildings(track, layout, ground, m, rng, amount));

  // Trees: a jittered grid over the land near the track, patchy, kept clear of it all.
  const woods = WOODS[scenery];
  const spacing = 100 / Math.sqrt(woods.density * amount);
  const trees: { x: number; y: number; z: number; size: number; kind: TreeKind; clear: number }[] = [];
  const t = track.data.terrain;
  const maxTrees = Math.round(9000 * amount);
  for (let x = t.x0; x < t.x0 + (t.cols - 1) * t.step; x += spacing) {
    for (let z = t.z0; z < t.z0 + (t.rows - 1) * t.step; z += spacing) {
      const px = x + (rng() - 0.5) * spacing;
      const pz = z + (rng() - 0.5) * spacing;
      const clear = clearance(track, layout, px, pz);
      if (clear < CLEAR || clear > FAR) continue;
      // Woods come in patches; fewer far from the track.
      const patch = fbm(px / 180, pz / 180, 3, 41) * 0.5 + 0.5;
      if (patch < woods.patchy || rng() > 1 - clear / (FAR * 1.4)) continue;
      if (ground.wet(px, pz)) continue;
      const kind = woods.kinds[Math.floor(rng() * woods.kinds.length)];
      trees.push({ x: px, y: ground.heightAt(px, pz), z: pz, size: 0.75 + rng() * 0.55, kind, clear });
    }
  }
  // Nearest first, so a cap keeps the ones you see.
  trees.sort((a, b) => a.clear - b.clear);
  trees.length = Math.min(trees.length, maxTrees);
  group.add(...forest(trees, m, rng));
  return group;
}

/** Meters from (x, z) to the edge of what's levelled for the circuit (negative inside it). */
function clearance(track: Track, layout: CircuitLayout, x: number, z: number): number {
  let best = Infinity;
  for (const i of track.near(x, z, FAR + 80)) {
    const dx = x - track.x[i];
    const dz = z - track.z[i];
    const side = dx * -track.tz[i] + dz * track.tx[i] >= 0 ? 1 : -1;
    best = Math.min(best, Math.hypot(dx, dz) - layout.edge(i, side).level);
  }
  return best;
}

function forest(trees: { x: number; y: number; z: number; size: number; kind: TreeKind }[], m: RaceMaterials, rng: () => number): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  const place = (list: typeof trees, height: number, parts: { geometry: THREE.BufferGeometry; material: THREE.Material; colors: string[] }[]) => {
    if (!list.length) return;
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((t, k) => {
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (t.x * 13.1 + t.z * 7.7) % (Math.PI * 2));
        const h = height * t.size;
        matrix.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), q, new THREE.Vector3(h, h, h));
        mesh.setMatrixAt(k, matrix);
        mesh.setColorAt(k, color.set(part.colors[Math.floor(rng() * part.colors.length)]).offsetHSL(0, 0, (rng() - 0.5) * 0.06));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      out.push(mesh);
    }
  };
  const pine = conifer(false);
  place(trees.filter((t) => t.kind === 'conifer'), 16, [
    { geometry: pine.trunk, material: m.bark, colors: ['#ffffff'] },
    { geometry: pine.crown, material: m.leaves, colors: ['#2f4a2a', '#34512c', '#283f25', '#3b5a32'] },
  ]);
  const broad = broadleaf();
  place(trees.filter((t) => t.kind === 'broadleaf'), 13, [
    { geometry: broad.trunk, material: m.bark, colors: ['#ffffff'] },
    { geometry: broad.crown, material: m.leaves, colors: ['#4f6b33', '#5d7a3a', '#3f5a2e', '#6b7f3c', '#486634'] },
  ]);
  const palmShape = palm(3);
  place(trees.filter((t) => t.kind === 'palm'), 11, [
    { geometry: palmShape.trunk, material: m.bark, colors: ['#c9b394'] },
    { geometry: palmShape.fronds, material: m.leaves, colors: ['#4f7a32', '#5d8a3a', '#46702c'] },
  ]);
  return out;
}

/** A broadleaf tree of unit height: a short trunk and a crown of three lumpy clumps. */
function broadleaf(): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.025, 0.04, 0.45, 6).translate(0, 0.225, 0);
  const rng = mulberry32(5);
  const clumps: THREE.BufferGeometry[] = [];
  for (const [x, y, z, r] of [
    [0, 0.62, 0, 0.3],
    [0.16, 0.5, 0.08, 0.22],
    [-0.14, 0.52, -0.1, 0.22],
  ]) {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const d = 1 + (rng() - 0.5) * 0.25;
      p.setXYZ(k, p.getX(k) * d + x, p.getY(k) * d * 0.85 + y, p.getZ(k) * d + z);
    }
    clumps.push(g);
  }
  const crown = mergeGeometries(clumps.map((g) => (g.index ? g : withIndex(g))));
  crown.computeVertexNormals();
  return { trunk, crown };
}

function withIndex(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.setIndex(Array.from({ length: g.attributes.position.count }, (_, k) => k));
  return g;
}

/** Window spacing: one every WINDOW m across, a floor every FLOOR m up. */
const WINDOW = 3;
const FLOOR = 3.4;
const FACADES = ['#e8e2d6', '#d6d0c4', '#c9c2b4', '#b9c4cc', '#a8b4bf', '#efe9dc', '#cdbfa8', '#9fb0bd'];

/**
 * A city's blocks along the streets of a street circuit, set back behind the walls and
 * pavements, turned square to the road, taller further from it (towers for Marina Bay).
 */
function buildings(track: Track, layout: CircuitLayout, ground: Ground, m: RaceMaterials, rng: () => number, amount: number): THREE.Mesh {
  const towers = track.info.id === 'marina-bay';
  const parts: THREE.BufferGeometry[] = [];
  const t = track.data.terrain;
  const cell = 34;
  const taken: { x: number; z: number; r: number }[] = [];
  for (let x = t.x0; x < t.x0 + (t.cols - 1) * t.step; x += cell) {
    for (let z = t.z0; z < t.z0 + (t.rows - 1) * t.step; z += cell) {
      const px = x + (rng() - 0.5) * cell * 0.4;
      const pz = z + (rng() - 0.5) * cell * 0.4;
      const w = 14 + rng() * 14;
      const d = 12 + rng() * 12;
      const clear = clearance(track, layout, px, pz);
      const reach = Math.hypot(w, d) / 2;
      if (clear < reach + 3 || clear > 900) continue;
      if (rng() > amount * (clear < 200 ? 1 : 0.6)) continue;
      if (ground.wet(px, pz) || ground.wet(px + w / 2, pz) || ground.wet(px - w / 2, pz) || ground.wet(px, pz + d / 2) || ground.wet(px, pz - d / 2)) continue;
      if (taken.some((b) => Math.hypot(b.x - px, b.z - pz) < b.r + reach)) continue;
      taken.push({ x: px, z: pz, r: reach });
      // Square to the nearest road.
      const near = track.project(px, pz);
      const yaw = track.heading(near.s);
      const floors = towers ? Math.round(4 + rng() ** 2.2 * 46) : Math.round(3 + rng() * 8 + (clear > 120 ? rng() * 6 : 0));
      const base = Math.min(ground.heightAt(px - w / 2, pz), ground.heightAt(px + w / 2, pz), ground.heightAt(px, pz - d / 2), ground.heightAt(px, pz + d / 2), ground.heightAt(px, pz)) - 1;
      const top = ground.heightAt(px, pz) + floors * FLOOR;
      parts.push(block(px, pz, yaw, w, d, base, top, new THREE.Color(FACADES[Math.floor(rng() * FACADES.length)])));
    }
  }
  const mesh = new THREE.Mesh(parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry(), m.building);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A block of `w` by `d` meters from `base` up to `top`, turned `yaw`, windows on its walls, a plain roof. */
function block(x: number, z: number, yaw: number, w: number, d: number, base: number, top: number, color: THREE.Color): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const corner = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
  const corners = [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)];
  const lengths = [w, d, w, d];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k];
    const [bx, bz] = corners[(k + 1) % 4];
    const at = positions.length / 3;
    positions.push(ax, base, az, bx, base, bz, ax, top, az, bx, top, bz);
    const across = Math.round(lengths[k] / WINDOW);
    const up = (top - base) / FLOOR;
    uvs.push(0, 0, across, 0, 0, up, across, up);
    for (let v = 0; v < 4; v++) colors.push(color.r, color.g, color.b);
    index.push(at, at + 1, at + 2, at + 1, at + 3, at + 2);
  }
  // The roof: a plain grey slab (UVs off the windows).
  const at = positions.length / 3;
  for (const [cx, cz] of corners) {
    positions.push(cx, top, cz);
    uvs.push(0.02, 0.02);
    colors.push(0.55, 0.55, 0.55);
  }
  index.push(at, at + 2, at + 1, at, at + 3, at + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
