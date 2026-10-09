import * as THREE from 'three';
import { ANCIENT } from '../../../../shared/zones/ancient.ts';
import { boxCollider } from '../town/colliders.ts';
import { box, IDENTITY, placement } from '../town/meshBuilder.ts';
import { grazer, Herd, loopMover } from './creatures.ts';
import { ChunkedBuilder, compose, cylinderCollider, hullOf, instanced, mulberry32, palms, Placement, rockGeometry, withWorldUv, type ZoneContent, type ZoneContext } from './kit.ts';

const TRAVERTINE = '#e6d9bc';
const SAND = '#e2c690';
const MARBLE = '#f2efe8';

/** The Valley of Empires: Rome, Greece, Mesoamerica and Egypt side by side. */
export function buildAncient(ctx: ZoneContext): ZoneContent {
  const { physics, zm, terrain } = ctx;
  const group = new THREE.Group();
  group.name = 'zone-ancient';
  const b = new ChunkedBuilder();

  buildColosseum(ctx, b);
  buildAqueduct(ctx, b);
  buildArch(ctx, b);
  buildParthenon(ctx, b);
  buildStepPyramid(ctx, b);
  buildEgypt(ctx, b);

  // Obelisks lining the Via Imperialis.
  const obelisk = new THREE.CylinderGeometry(0.55, 0.85, 14, 4, 1).rotateY(Math.PI / 4).translate(0, 7, 0);
  const tip = new THREE.ConeGeometry(0.62, 1.4, 4).rotateY(Math.PI / 4).translate(0, 14.7, 0);
  for (const z of ANCIENT.obeliskZ) {
    for (const x of [-9, 9]) {
      const y = terrain.heightAt(x, z);
      b.add(box(2.6, 1.2, 2.6, 2), zm.sandstone, placement(x, y + 0.6, z), TRAVERTINE);
      b.add(obelisk, zm.sandstone, placement(x, y + 1.2, z), '#d8b888');
      b.add(tip, ctx.m.brass, placement(x, y + 1.2, z));
      boxCollider(physics, IDENTITY, { x, y: y + 4, z }, { x: 2.6, y: 8, z: 2.6 });
    }
  }

  // Palms around the oasis and along the roads; desert rocks.
  const place = new Placement('ancient');
  const o = ANCIENT.oasis;
  const palmSpots: { x: number; y: number; z: number; height: number; yaw: number }[] = [];
  const rng = mulberry32(81);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng() * 0.3;
    const r = o.r + 3 + rng() * 6;
    const x = o.x + Math.cos(a) * r;
    const z = o.z + Math.sin(a) * r;
    if (!place.free(x, z, 1.5)) continue;
    place.claim(x, z, 1.5);
    palmSpots.push({ x, y: terrain.heightAt(x, z), z, height: 8 + rng() * 5, yaw: rng() * 6 });
  }
  for (const s of place.scatter(40, { minX: -195, maxX: 195, minZ: 210, maxZ: 595 }, 2, 82, (x, z) => Math.abs(z - ANCIENT.kingsZ) < 30 || Math.abs(x) < 26)) {
    palmSpots.push({ x: s.x, y: terrain.heightAt(s.x, s.z), z: s.z, height: 7 + s.rng() * 6, yaw: s.rng() * 6 });
  }
  group.add(palms(palmSpots, ctx, zm.fronds, 83));
  const rocks = place.scatter(60, { minX: -195, maxX: 195, minZ: 210, maxZ: 598 }, 2, 84);
  group.add(instanced(rockGeometry(85, 1, 0.5), zm.sandstone, rocks.map((r) => ({ matrix: compose(r.x, terrain.heightAt(r.x, r.z), r.z, r.rng() * 6, 0.8 + r.rng() * 2), color: '#d8c090' }))));

  group.add(b.build('ancient'));

  // A camel caravan plods between the pyramids and the oasis.
  const camels = new Herd(
    grazer('camel', '#c49a62'),
    5,
    loopMover(
      [
        [70, 470],
        [140, 455],
        [185, 470],
        [185, 590],
        [90, 595],
        [65, 520],
      ],
      1.3,
      terrain,
      { spacing: 5 },
    ),
  );
  group.add(camels.group);
  return {
    id: 'ancient',
    group,
    update(view) {
      camels.update(view.time, view.camera.position);
    },
  };
}

/** The Colosseum: three tiers of arches round an arena, partly ruined on one side. */
function buildColosseum(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm } = ctx;
  const c = ANCIENT.colosseum;
  const N = 56;
  const tier = 7;
  const ellipse = (a: number, rx: number, rz: number) => new THREE.Vector3(c.x + Math.cos(a) * rx, 0, c.z + Math.sin(a) * rz);
  const isGate = (a: number) => Math.min(Math.abs(Math.atan2(Math.sin(a), Math.cos(a))), Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI)))) < 0.12;
  const ruined = (a: number) => a > 1.9 && a < 3.0;
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2;
    const a1 = ((k + 1) / N) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const p0 = ellipse(a0, c.rx, c.rz);
    const p1 = ellipse(a1, c.rx, c.rz);
    const len = p0.distanceTo(p1);
    const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    const M = placement((p0.x + p1.x) / 2, 0, (p0.z + p1.z) / 2, yaw);
    const tiers = ruined(mid) ? 2 : 3;
    const gate = isGate(mid) || isGate(a0);
    for (let t = 0; t < tiers; t++) {
      const y = t * tier;
      // A pier at the segment's start and the arch's lintel over the opening (the gates
      // at either end are wider: no pier at ground level).
      if (!(gate && t === 0)) b.add(box(1.6, tier - 1.4, 1.5, 3), zm.sandstone, M.clone().multiply(placement(0, y + (tier - 1.4) / 2, -len / 2 + 0.75)), TRAVERTINE);
      b.add(box(1.6, 1.4, len, 3), zm.sandstone, M.clone().multiply(placement(0, y + tier - 0.7, 0)), TRAVERTINE);
      // Half columns on the piers.
      b.add(new THREE.CylinderGeometry(0.32, 0.32, tier - 1.4, 8), zm.sandstone, M.clone().multiply(placement(0.9, y + (tier - 1.4) / 2, -len / 2 + 0.75)), MARBLE);
    }
    if (!ruined(mid)) b.add(box(1.6, 3, len, 3), zm.sandstone, M.clone().multiply(placement(0, 3 * tier + 1.5, 0)), '#ddd0b2');
    if (gate) boxCollider(physics, M, { x: 0, y: tier + ((tiers - 1) * tier) / 2, z: -len / 2 + 0.75 }, { x: 1.6, y: (tiers - 1) * tier, z: 1.5 });
    else boxCollider(physics, M, { x: 0, y: (tiers * tier) / 2, z: -len / 2 + 0.75 }, { x: 1.6, y: tiers * tier, z: 1.5 });
    boxCollider(physics, M, { x: 0, y: tier - 0.7, z: 0 }, { x: 1.6, y: 1.4, z: len });

    if (isGate(mid)) continue;
    // Seating: rising rings from the arena wall to the outer wall.
    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const f = (r + 0.5) / rows;
      const rx = c.arenaRx + 1 + f * (c.rx - c.arenaRx - 3);
      const rz = c.arenaRz + 1 + f * (c.rz - c.arenaRz - 3);
      const q0 = ellipse(a0, rx, rz);
      const q1 = ellipse(a1, rx, rz);
      const h = 3 + r * 2.4;
      const depth = (c.rx - c.arenaRx - 3) / rows + 0.4;
      const Q = placement((q0.x + q1.x) / 2, 0, (q0.z + q1.z) / 2, Math.atan2(q1.x - q0.x, q1.z - q0.z));
      b.add(box(depth, h, q0.distanceTo(q1) + 0.1, 3), zm.sandstone, Q.clone().multiply(placement(0, h / 2, 0)), r % 2 ? '#d8cbab' : '#cfc2a2');
      boxCollider(physics, Q, { x: 0, y: h / 2, z: 0 }, { x: depth, y: h, z: q0.distanceTo(q1) + 0.1 });
    }
  }
  // The arena's sand floor.
  const floor = withWorldUv(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2).scale(c.arenaRx + 1, 1, c.arenaRz + 1), 1);
  b.add(floor, zm.sand, placement(c.x, 0.03, c.z), '#f0dcb0', { castShadow: false });
  // Fallen stones in the ruined part.
  const rng = mulberry32(86);
  for (let i = 0; i < 14; i++) {
    const a = 1.9 + rng() * 1.1;
    const r = 0.9 + rng() * 0.35;
    const x = c.x + Math.cos(a) * c.rx * r;
    const z = c.z + Math.sin(a) * c.rz * r;
    const s = 0.8 + rng() * 1.2;
    b.add(box(s * 2, s, s * 1.2, 3), zm.sandstone, placement(x, s / 2 + 3 * (r < 1 ? 1 : 0), z, rng() * 3, rng() * 0.3), TRAVERTINE);
  }
}

/** A Roman aqueduct striding across the valley on arches. */
function buildAqueduct(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm, terrain } = ctx;
  const a = ANCIENT.aqueduct;
  const top = a.height;
  const span = 8;
  for (let x = a.x0; x < a.x1; x += span) {
    const ground = Math.min(terrain.heightAt(x, a.z), terrain.heightAt(x + span, a.z));
    const h = top - ground;
    b.add(box(2, h - 2.6, 2.6, 3), zm.sandstone, placement(x, ground + (h - 2.6) / 2, a.z), TRAVERTINE);
    boxCollider(physics, IDENTITY, { x, y: ground + h / 2, z: a.z }, { x: 2, y: h, z: 2.6 });
    // The arch top and the water channel.
    b.add(box(span, 1.4, 2.6, 3), zm.sandstone, placement(x + span / 2, top - 1.9, a.z), TRAVERTINE);
    b.add(box(span, 1.2, 3, 3), zm.sandstone, placement(x + span / 2, top - 0.6, a.z), '#ddd0b2');
    b.add(box(span, 0.1, 1.4), zm.water, placement(x + span / 2, top + 0.02, a.z));
  }
  boxCollider(physics, IDENTITY, { x: (a.x0 + a.x1) / 2, y: top - 1.3, z: a.z }, { x: a.x1 - a.x0, y: 2.6, z: 3 });
}

/** A triumphal arch over the Via Imperialis. */
function buildArch(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm } = ctx;
  const { x, z } = ANCIENT.arch;
  for (const side of [-1, 1]) {
    b.add(box(6, 13, 6, 3), zm.marble, placement(x + side * 9, 6.5, z), MARBLE);
    boxCollider(physics, IDENTITY, { x: x + side * 9, y: 6.5, z }, { x: 6, y: 13, z: 6 });
    for (const f of [-1, 1]) b.add(new THREE.CylinderGeometry(0.45, 0.45, 11, 12), zm.marble, placement(x + side * 7.4, 5.5, z + f * 3.2), '#ece7dc');
  }
  b.add(box(24, 4, 6.4, 3), zm.marble, placement(x, 15, z), MARBLE);
  b.add(box(18, 2, 6.6, 3), zm.marble, placement(x, 14.2, z), '#d8d2c4');
  boxCollider(physics, IDENTITY, { x, y: 15, z }, { x: 24, y: 4, z: 6.4 });
  // Bronze chariot group on top (a simple silhouette).
  b.add(box(5, 1.2, 2.5), ctx.m.brass, placement(x, 17.6, z));
  for (const k of [-1.5, -0.5, 0.5, 1.5]) b.add(box(0.6, 1.8, 1.6), ctx.m.brass, placement(x + k, 19, z - 0.5));
}

/** A Greek temple: stepped base, a peristyle of columns, pediments and a cella. */
function buildParthenon(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm } = ctx;
  const p = ANCIENT.parthenon;
  for (let s = 0; s < 3; s++) {
    const w = p.w + 2.4 - s * 0.8;
    const d = p.d + 2.4 - s * 0.8;
    b.add(box(w, 0.5, d, 3), zm.marble, placement(p.x, 0.25 + s * 0.5, p.z), MARBLE);
    boxCollider(physics, IDENTITY, { x: p.x, y: 0.25 + s * 0.5, z: p.z }, { x: w, y: 0.5, z: d });
  }
  const base = 1.5;
  const colH = 10;
  const column = new THREE.CylinderGeometry(0.75, 0.9, colH, 16);
  const cols = { x: 8, z: 17 };
  const rng = mulberry32(87);
  for (let i = 0; i < cols.x; i++) {
    for (let j = 0; j < cols.z; j++) {
      if (i > 0 && i < cols.x - 1 && j > 0 && j < cols.z - 1) continue;
      const x = p.x - p.w / 2 + 1.2 + (i * (p.w - 2.4)) / (cols.x - 1);
      const z = p.z - p.d / 2 + 1.2 + (j * (p.d - 2.4)) / (cols.z - 1);
      // Two columns have fallen: just their stumps remain.
      const broken = (i === 0 && j === 11) || (i === cols.x - 1 && j === 4);
      const h = broken ? 3 + rng() * 2 : colH;
      b.add(broken ? new THREE.CylinderGeometry(0.8, 0.9, h, 16) : column, zm.marble, placement(x, base + h / 2, z), MARBLE);
      if (!broken) b.add(box(2, 0.5, 2, 3), zm.marble, placement(x, base + colH + 0.25, z), MARBLE);
      cylinderCollider(physics, x, base, z, 0.9, h);
      if (broken) {
        for (let d = 0; d < 3; d++) b.add(new THREE.CylinderGeometry(0.8, 0.8, 1.8, 16).rotateZ(Math.PI / 2), zm.marble, placement(x + (i === 0 ? -3 - d * 2 : 3 + d * 2), 0.8, z + rng(), rng()), MARBLE);
      }
    }
  }
  const top = base + colH + 0.5;
  // Entablature, with a gap over the fallen columns' corner left intact for simplicity.
  b.add(box(p.w, 2.4, p.d, 3), zm.marble, placement(p.x, top + 1.2, p.z), '#ece8de');
  boxCollider(physics, IDENTITY, { x: p.x, y: top + 1.2, z: p.z }, { x: p.w, y: 2.4, z: p.d });
  // Pediments and a low pitched roof.
  const rise = 3.4;
  const shape = new THREE.Shape([new THREE.Vector2(-p.w / 2, 0), new THREE.Vector2(p.w / 2, 0), new THREE.Vector2(0, rise)]);
  const pediment = new THREE.ExtrudeGeometry(shape, { depth: p.d, bevelEnabled: false }).translate(0, 0, -p.d / 2);
  b.add(pediment, zm.marble, placement(p.x, top + 2.4, p.z), '#e8e4da');
  hullOf(physics, pediment, placement(p.x, top + 2.4, p.z));
  // The cella: an inner hall with a doorway facing south.
  const cw = p.w - 8;
  const cd = p.d - 12;
  for (const side of [-1, 1]) {
    b.add(box(1, colH, cd, 3), zm.marble, placement(p.x + side * (cw / 2), base + colH / 2, p.z), '#e6e1d4');
    boxCollider(physics, IDENTITY, { x: p.x + side * (cw / 2), y: base + colH / 2, z: p.z }, { x: 1, y: colH, z: cd });
  }
  b.add(box(cw, colH, 1, 3), zm.marble, placement(p.x, base + colH / 2, p.z - cd / 2), '#e6e1d4');
  boxCollider(physics, IDENTITY, { x: p.x, y: base + colH / 2, z: p.z - cd / 2 }, { x: cw, y: colH, z: 1 });
  for (const side of [-1, 1]) {
    b.add(box(cw / 2 - 2, colH, 1, 3), zm.marble, placement(p.x + side * (cw / 4 + 1), base + colH / 2, p.z + cd / 2), '#e6e1d4');
    boxCollider(physics, IDENTITY, { x: p.x + side * (cw / 4 + 1), y: base + colH / 2, z: p.z + cd / 2 }, { x: cw / 2 - 2, y: colH, z: 1 });
  }
  // Athena's statue inside, gilded.
  b.add(box(2.4, 1.2, 2.4, 2), zm.marble, placement(p.x, base + 0.6, p.z - cd / 2 + 4), MARBLE);
  statue(b, ctx.m.brass, p.x, base + 1.2, p.z - cd / 2 + 4, 5, Math.PI);
  // Statues on plinths along the approach.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const x = p.x + side * 8;
      const z = p.z + p.d / 2 + 8 + k * 10;
      b.add(box(1.6, 1.6, 1.6, 2), zm.marble, placement(x, 0.8, z), MARBLE);
      statue(b, zm.marble, x, 1.6, z, 2.3, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      boxCollider(physics, IDENTITY, { x, y: 1.6, z }, { x: 1.6, y: 3.2, z: 1.6 });
    }
  }
}

/** A robed figure of height `h`, standing at (x, y, z) facing `yaw`. */
function statue(b: ChunkedBuilder, mat: THREE.Material, x: number, y: number, z: number, h: number, yaw: number): void {
  const M = placement(x, y, z, yaw);
  const s = h / 2.3;
  b.add(new THREE.CylinderGeometry(0.28 * s, 0.42 * s, 1.3 * s, 12).translate(0, 0.65 * s, 0), mat, M, MARBLE);
  b.add(new THREE.CylinderGeometry(0.3 * s, 0.28 * s, 0.6 * s, 12).translate(0, 1.6 * s, 0), mat, M, MARBLE);
  b.add(new THREE.SphereGeometry(0.17 * s, 12, 10).translate(0, 2.08 * s, 0), mat, M, MARBLE);
  b.add(new THREE.CylinderGeometry(0.06 * s, 0.07 * s, 0.75 * s, 6).rotateZ(-0.5).translate(0.42 * s, 1.75 * s, 0.1 * s), mat, M, MARBLE);
  b.add(new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 2.2 * s, 6).translate(-0.5 * s, 1.1 * s, 0.1 * s), mat, M, MARBLE);
}

/** A Mesoamerican step pyramid with stairs up two sides and a temple on top. */
function buildStepPyramid(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm } = ctx;
  const sp = ANCIENT.stepPyramid;
  const tierH = sp.height / sp.tiers;
  const top = 14;
  const inset = (sp.base - top) / 2 / sp.tiers;
  for (let t = 0; t < sp.tiers; t++) {
    const s = sp.base - 2 * inset * t;
    b.add(box(s, tierH, s, 3), zm.sandstone, placement(sp.x, t * tierH + tierH / 2, sp.z), t % 2 ? '#c9b48a' : '#bfa97e');
    boxCollider(physics, IDENTITY, { x: sp.x, y: t * tierH + tierH / 2, z: sp.z }, { x: s, y: tierH, z: s });
  }
  // Stairs on the north and south faces: real steps you can climb.
  const run = (sp.base - top) / 2;
  const steps = Math.ceil(sp.height / 0.4);
  const rise = sp.height / steps;
  const tread = run / steps;
  for (const dir of [-1, 1]) {
    for (let k = 0; k < steps; k++) {
      const y = (k + 1) * rise;
      const z = sp.z + dir * (sp.base / 2 - (k + 0.5) * tread);
      b.add(box(8, rise, tread + 0.02, 1), zm.sandstone, placement(sp.x, y - rise / 2, z), '#d8c49a');
      boxCollider(physics, IDENTITY, { x: sp.x, y: y - rise / 2, z }, { x: 8, y: rise, z: tread + 0.02 });
    }
    // Balustrades, ending in serpent heads at the foot.
    for (const side of [-1, 1]) {
      const len = Math.hypot(run, sp.height);
      const angle = Math.atan2(sp.height, run);
      b.add(box(1, 1, len, 2), zm.sandstone, placement(sp.x + side * 4.5, sp.height / 2 + 0.5, sp.z + dir * (sp.base / 2 - run / 2), 0, dir * angle), '#a8946c');
      b.add(box(1.4, 1.4, 2.2, 1), zm.sandstone, placement(sp.x + side * 4.5, 0.7, sp.z + dir * (sp.base / 2 + 1)), '#8a7a58');
      b.add(new THREE.ConeGeometry(0.3, 0.8, 4).rotateX(dir * Math.PI / 2), zm.paint, placement(sp.x + side * 4.5, 0.9, sp.z + dir * (sp.base / 2 + 2.4)), '#c8402a');
    }
  }
  // The temple on top, open to the south.
  const ty = sp.height;
  for (const side of [-1, 1]) {
    b.add(box(1.2, 5, 9, 2), zm.sandstone, placement(sp.x + side * 4, ty + 2.5, sp.z - 0.5), '#b49c70');
    boxCollider(physics, IDENTITY, { x: sp.x + side * 4, y: ty + 2.5, z: sp.z - 0.5 }, { x: 1.2, y: 5, z: 9 });
  }
  b.add(box(9.2, 5, 1.2, 2), zm.sandstone, placement(sp.x, ty + 2.5, sp.z - 4.4), '#b49c70');
  boxCollider(physics, IDENTITY, { x: sp.x, y: ty + 2.5, z: sp.z - 4.4 }, { x: 9.2, y: 5, z: 1.2 });
  b.add(box(10, 1.4, 10, 2), zm.sandstone, placement(sp.x, ty + 5.7, sp.z - 0.5), '#a8946c');
  for (let k = -2; k <= 2; k++) b.add(box(1, 1.4, 0.6, 1), zm.paint, placement(sp.x + k * 2, ty + 7.1, sp.z + 4.2), '#2e8a7a');
}

/** The Great Pyramid, a smaller queen's pyramid, and the Sphinx. */
function buildEgypt(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm, m } = ctx;
  for (const p of [ANCIENT.greatPyramid, ANCIENT.smallPyramid]) {
    const r = (p.base / 2) * Math.SQRT2;
    const g = new THREE.ConeGeometry(r, p.height, 4, 1).rotateY(Math.PI / 4).translate(0, p.height / 2, 0);
    const M = placement(p.x, -0.3, p.z);
    b.add(g, zm.sandstone, M, SAND);
    hullOf(physics, g, M);
    // A gilded capstone.
    const cap = new THREE.ConeGeometry(r * 0.06, p.height * 0.06, 4).rotateY(Math.PI / 4).translate(0, p.height * 0.97, 0);
    b.add(cap, m.brass, M);
  }
  // The Sphinx, lying on a plinth, gazing west down the avenue.
  const s = ANCIENT.sphinx;
  const S = placement(s.x, 0, s.z, -Math.PI / 2);
  const part = (g: THREE.BufferGeometry, color = SAND) => b.add(g, zm.sandstone, S, color);
  part(new THREE.BoxGeometry(9, 1, 24).translate(0, 0.5, 0), '#cdb080');
  part(new THREE.CapsuleGeometry(3, 11, 6, 12).rotateX(Math.PI / 2).translate(0, 4, -2));
  part(new THREE.BoxGeometry(2, 1.6, 8).translate(-1.8, 1.8, 7));
  part(new THREE.BoxGeometry(2, 1.6, 8).translate(1.8, 1.8, 7));
  part(new THREE.BoxGeometry(4.4, 5, 4).translate(0, 8.5, 5.2));
  part(new THREE.BoxGeometry(5.6, 4, 2.6).translate(0, 8.8, 4.4), '#b89a68');
  part(new THREE.BoxGeometry(3.4, 1.6, 1.4).translate(0, 7.4, 7.6), '#c8aa78');
  boxCollider(physics, S, { x: 0, y: 4, z: 0 }, { x: 9, y: 8, z: 24 });
  boxCollider(physics, S, { x: 0, y: 8.5, z: 5 }, { x: 5.6, y: 5, z: 4 });
}
