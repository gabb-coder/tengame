import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { fbm, smoothstep } from '../../../../shared/noise.ts';
import type { CircuitLayout } from '../layout.ts';
import type { Track } from '../track.ts';
import type { RaceMaterials } from './materials.ts';

/** Most vertices the ground grid may have. */
const MAX_CELLS = 150_000;
/** The land beyond the surveyed area reaches this far (m), fading into the haze. */
const OUTER = 7000;
/** Ground lies this far under the run-off surfaces near the track. */
const UNDER = 0.08;

/**
 * The land the circuit sits in: the real hills and valleys around it (smoothed survey
 * heights), levelled where the track and its run-off run and blended back into the
 * hillside beyond the barriers. One height grid makes both the mesh and the heightfield
 * the cars drive on, so they match.
 */
export class Ground {
  readonly group = new THREE.Group();
  readonly step: number;
  readonly cols: number;
  readonly rows: number;
  readonly x0: number;
  readonly z0: number;
  readonly heights: Float32Array;
  /** The sea's height, if the circuit is by the sea. */
  readonly sea: number | null;
  readonly collider: RAPIER.Collider;

  constructor(track: Track, layout: CircuitLayout, m: RaceMaterials, physics: RAPIER.World) {
    const t = track.data.terrain;
    const width = (t.cols - 1) * t.step;
    const depth = (t.rows - 1) * t.step;
    this.step = Math.max(8, Math.ceil(Math.sqrt((width * depth) / MAX_CELLS)));
    this.cols = Math.floor(width / this.step) + 1;
    this.rows = Math.floor(depth / this.step) + 1;
    this.x0 = t.x0;
    this.z0 = t.z0;
    this.sea = track.data.sea;
    const survey = (x: number, z: number) => bicubic(t.heights, t.cols, t.rows, (x - t.x0) / t.step, (z - t.z0) / t.step) / 10;

    // Natural ground, then levelled to the track near it.
    this.heights = new Float32Array(this.cols * this.rows);
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        const x = this.x0 + c * this.step;
        const z = this.z0 + r * this.step;
        this.heights[c * this.rows + r] = level(track, layout, x, z, survey(x, z));
      }
    }

    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.heightfield(this.rows - 1, this.cols - 1, this.heights, { x: (this.cols - 1) * this.step, y: 1, z: (this.rows - 1) * this.step })
        .setTranslation(this.x0 + ((this.cols - 1) * this.step) / 2, 0, this.z0 + ((this.rows - 1) * this.step) / 2)
        .setFriction(0.8),
    );

    this.group.name = 'ground';
    const chunk = Math.max(8, Math.round(400 / this.step));
    for (let c0 = 0; c0 < this.cols - 1; c0 += chunk) {
      for (let r0 = 0; r0 < this.rows - 1; r0 += chunk) {
        const mesh = new THREE.Mesh(this.chunk(c0, r0, Math.min(chunk, this.cols - 1 - c0), Math.min(chunk, this.rows - 1 - r0), track.info.scenery === 'desert'), m.ground);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
      }
    }
    this.group.add(this.outerLand(m));
    if (this.sea !== null) {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(OUTER * 3, OUTER * 3).rotateX(-Math.PI / 2), m.water);
      sea.position.set(this.x0 + width / 2, this.sea, this.z0 + depth / 2);
      sea.renderOrder = 2;
      this.group.add(sea);
    }
  }

  /** Ground height at (x, z), matching the heightfield's triangles. */
  heightAt(x: number, z: number): number {
    const fx = Math.min(this.cols - 1.001, Math.max(0, (x - this.x0) / this.step));
    const fz = Math.min(this.rows - 1.001, Math.max(0, (z - this.z0) / this.step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h = (a: number, b: number) => this.heights[a * this.rows + b];
    return u + v < 1 ? h(i, j) + (h(i + 1, j) - h(i, j)) * u + (h(i, j + 1) - h(i, j)) * v : h(i + 1, j + 1) + (h(i, j + 1) - h(i + 1, j + 1)) * (1 - u) + (h(i + 1, j) - h(i + 1, j + 1)) * (1 - v);
  }

  /** Whether (x, z) is under the sea. */
  wet(x: number, z: number): boolean {
    return this.sea !== null && this.heightAt(x, z) < this.sea + 0.3;
  }

  private chunk(c0: number, r0: number, cw: number, rh: number, desert: boolean): THREE.BufferGeometry {
    const { rows, heights, step } = this;
    const vc = cw + 1;
    const vr = rh + 1;
    const positions = new Float32Array(vc * vr * 3);
    const normals = new Float32Array(vc * vr * 3);
    const uvs = new Float32Array(vc * vr * 2);
    const colors = new Float32Array(vc * vr * 3);
    const at = (c: number, r: number) => heights[Math.min(this.cols - 1, Math.max(0, c)) * rows + Math.min(rows - 1, Math.max(0, r))];
    const nrm = new THREE.Vector3();
    for (let a = 0; a < vc; a++) {
      for (let b = 0; b < vr; b++) {
        const c = c0 + a;
        const r = r0 + b;
        const k = a * vr + b;
        const x = this.x0 + c * step;
        const z = this.z0 + r * step;
        const y = at(c, r);
        positions.set([x, y, z], k * 3);
        nrm.set(-(at(c + 1, r) - at(c - 1, r)), 2 * step, -(at(c, r + 1) - at(c, r - 1))).normalize();
        normals.set([nrm.x, nrm.y, nrm.z], k * 3);
        uvs.set([x, z], k * 2);
        // Patchy color, drier on slopes; wet sand at the shore.
        const vary = fbm(x / 60, z / 60, 3, 21) * 0.18;
        const steep = 1 - smoothstep(nrm.y, 0.8, 0.97);
        let rr = 1 + vary;
        let gg = 1 + vary * 0.8;
        let bb = 1 + vary * 0.6;
        if (!desert) {
          rr += steep * 0.25;
          gg += steep * 0.05;
          bb -= steep * 0.05;
        }
        if (this.sea !== null && y < this.sea + 1) {
          const wet = smoothstep(this.sea + 1 - y, 0, 1.5);
          rr = rr * (1 - wet) + 0.75 * wet;
          gg = gg * (1 - wet) + 0.68 * wet;
          bb = bb * (1 - wet) + 0.55 * wet;
        }
        colors.set([rr, gg, bb], k * 3);
      }
    }
    const index: number[] = [];
    for (let a = 0; a < cw; a++) {
      for (let b = 0; b < rh; b++) {
        const p = a * vr + b;
        const q = (a + 1) * vr + b;
        // Same split as the heightfield (and heightAt): (c,r)-(c,r+1)-(c+1,r), (c+1,r+1)-(c+1,r)-(c,r+1).
        index.push(p, p + 1, q, q + 1, q, p + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
  }

  /** A wide, low-detail skirt of land from the grid's edge out to the horizon. */
  private outerLand(m: RaceMaterials): THREE.Mesh {
    const ring: number[] = [];
    const index: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const edge: [number, number, number][] = [];
    const w = (this.cols - 1) * this.step;
    const d = (this.rows - 1) * this.step;
    const per = 6;
    // The grid's edge, walked round, every `per` cells.
    for (let c = 0; c < this.cols - 1; c += per) edge.push([c, 0, 0]);
    for (let r = 0; r < this.rows - 1; r += per) edge.push([this.cols - 1, r, 0]);
    for (let c = this.cols - 1; c > 0; c -= per) edge.push([c, this.rows - 1, 0]);
    for (let r = this.rows - 1; r > 0; r -= per) edge.push([0, r, 0]);
    let mean = 0;
    for (const e of edge) {
      e[2] = this.heights[e[0] * this.rows + e[1]];
      mean += e[2];
    }
    mean /= edge.length;
    const cx = this.x0 + w / 2;
    const cz = this.z0 + d / 2;
    const far = this.sea !== null ? this.sea - 6 : mean - 2;
    for (const [c, r, h] of edge) {
      const x = this.x0 + c * this.step;
      const z = this.z0 + r * this.step;
      const dx = x - cx;
      const dz = z - cz;
      const len = Math.hypot(dx, dz);
      const mid = { x: cx + (dx / len) * (len + 600), z: cz + (dz / len) * (len + 600) };
      const out = { x: cx + (dx / len) * OUTER, z: cz + (dz / len) * OUTER };
      ring.push(x, h - 0.05, z, mid.x, h * 0.4 + far * 0.6, mid.z, out.x, far, out.z);
      uvs.push(x, z, mid.x, mid.z, out.x, out.z);
      colors.push(1, 1, 1, 0.95, 0.95, 0.95, 0.9, 0.9, 0.9);
    }
    const count = edge.length;
    for (let k = 0; k < count; k++) {
      const a = k * 3;
      const b = ((k + 1) % count) * 3;
      for (let j = 0; j < 2; j++) index.push(a + j, b + j, a + j + 1, b + j, b + j + 1, a + j + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ring, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    // Wound either way round depending on the walk: draw both sides.
    const material = m.ground.clone();
    material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}

/**
 * The ground's height at (x, z): level with the track (just under its surfaces) out to
 * past the barriers, then easing back to the natural `natural` height, more gently the
 * bigger the difference.
 */
function level(track: Track, layout: CircuitLayout, x: number, z: number, natural: number): number {
  let best = Infinity;
  let height = natural;
  let weight = 0;
  for (const i of track.near(x, z, 260)) {
    // The bridge deck's own stretch stands above the ground; the land there follows the lower road.
    if (track.lift[i] > 5.5) continue;
    const dx = x - track.x[i];
    const dz = z - track.z[i];
    const side = dx * -track.tz[i] + dz * track.tx[i] >= 0 ? 1 : -1;
    const flat = layout.edge(i, side).level;
    const past = Math.hypot(dx, dz) - flat;
    const y = track.y[i] - UNDER;
    const span = Math.min(160, Math.max(30, Math.abs(natural - y) * 3));
    const w = 1 - smoothstep(past, 0, span);
    // The nearest stretch of track wins where two are near.
    if (past < best) {
      best = past;
      height = y;
      weight = w;
    }
  }
  return height * weight + natural * (1 - weight);
}

/** Catmull-Rom interpolation of a column-major grid at fractional (fx, fz). */
function bicubic(h: number[], cols: number, rows: number, fx: number, fz: number): number {
  const c = Math.floor(fx);
  const r = Math.floor(fz);
  const u = fx - c;
  const v = fz - r;
  const at = (a: number, b: number) => h[Math.min(cols - 1, Math.max(0, a)) * rows + Math.min(rows - 1, Math.max(0, b))];
  const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = (b: number) => cubic(at(c - 1, b), at(c, b), at(c + 1, b), at(c + 2, b), u);
  return cubic(row(r - 1), row(r), row(r + 1), row(r + 2), v);
}
