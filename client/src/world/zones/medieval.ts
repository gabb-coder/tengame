import * as THREE from 'three';
import { MEDIEVAL } from '../../../../shared/zones/medieval.ts';
import { boxCollider } from '../town/colliders.ts';
import { box, IDENTITY, placement } from '../town/meshBuilder.ts';
import { buildTrees } from '../town/props.ts';
import { banner, Banners } from './cloth.ts';
import { circleMover, flyer, Herd } from './creatures.ts';
import { ChunkedBuilder, cylinderCollider, Placement, type ZoneContent, type ZoneContext } from './kit.ts';

const STONE = '#c9c2b6';
const DARK_STONE = '#a39b8e';
const SLATE = '#3d4a66';
const WOOD = '#8a6440';
const HERALDRY = ['#8e1b1b', '#1d3c8a', '#c9a227', '#2f6b35'];

/** Castle Eldermoor and its village. */
export function buildMedieval(ctx: ZoneContext): ZoneContent {
  const { physics, zm, m, terrain } = ctx;
  const group = new THREE.Group();
  group.name = 'zone-medieval';
  const b = new ChunkedBuilder();
  const banners = new Banners();
  const c = MEDIEVAL.castle;
  const H = 11;
  const T = 3;

  /** A wall with a walkway and merlons on both edges, from (x0, z0) to (x1, z1). */
  const wall = (x0: number, z0: number, x1: number, z1: number, height = H, thick = T) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const M = placement((x0 + x1) / 2, 0, (z0 + z1) / 2, yaw);
    b.add(box(thick, height, len, 3), zm.castle, M.clone().multiply(placement(0, height / 2, 0)), STONE);
    boxCollider(physics, M, { x: 0, y: height / 2, z: 0 }, { x: thick, y: height, z: len });
    for (let s = -len / 2 + 1; s <= len / 2 - 1; s += 2.2) {
      for (const side of [-1, 1]) b.add(box(0.6, 1.2, 1.1, 3), zm.castle, M.clone().multiply(placement((side * (thick - 0.6)) / 2, height + 0.6, s)), STONE);
    }
  };
  /** A round tower with a pointed slate roof and a banner. */
  const tower = (x: number, z: number, r: number, h: number, flag: string) => {
    b.add(new THREE.CylinderGeometry(r, r * 1.08, h, 20).translate(0, h / 2, 0), zm.castle, placement(x, 0, z), STONE);
    cylinderCollider(physics, x, 0, z, r * 1.04, h);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      b.add(box(1, 1.3, 0.7, 3), zm.castle, placement(x + Math.cos(a) * (r - 0.2), h + 0.65, z + Math.sin(a) * (r - 0.2), -a + Math.PI / 2), STONE);
    }
    b.add(new THREE.ConeGeometry(r * 0.95, r * 1.6, 20).translate(0, h + 1.3 + r * 0.8, 0), m.roofs.shingles, placement(x, 0, z), SLATE);
    const top = h + 1.3 + r * 1.6;
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 4, 6).translate(0, top + 1.6, 0), m.darkMetal, placement(x, 0, z));
    banners.add(banner(x, top + 2.6, z, 2.4, 1.2, flag));
  };

  // Curtain walls with a gap in the south wall for the gate.
  const [x0, x1, z0, z1] = [c.x - c.half, c.x + c.half, c.z - c.half, c.z + c.half];
  const gate = 4.5;
  wall(x0, z0, x1, z0);
  wall(x0, z0, x0, z1);
  wall(x1, z0, x1, z1);
  wall(x0, z1, c.x - gate - 3.5, z1);
  wall(c.x + gate + 3.5, z1, x1, z1);
  [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].forEach(([x, z], i) => tower(x, z, 6, 17, HERALDRY[i % 4]));

  // Gatehouse: two square towers joined above an arch, with the portcullis raised.
  for (const side of [-1, 1]) {
    const gx = c.x + side * (gate + 1.75);
    b.add(box(3.5, 15, 8, 3), zm.castle, placement(gx, 7.5, z1), DARK_STONE);
    boxCollider(physics, IDENTITY, { x: gx, y: 7.5, z: z1 }, { x: 3.5, y: 15, z: 8 });
    for (let k = -1; k <= 1; k++) b.add(box(1, 1.3, 1, 3), zm.castle, placement(gx + k * 1.2, 15.65, z1 + 3.5), DARK_STONE);
    banners.add(banner(gx + side * 1.9, 11, z1 + 4.05, 1.4, 4, HERALDRY[0], true));
  }
  b.add(box(gate * 2, 6.5, 8, 3), zm.castle, placement(c.x, 11.75, z1), DARK_STONE);
  boxCollider(physics, IDENTITY, { x: c.x, y: 11.75, z: z1 }, { x: gate * 2, y: 6.5, z: 8 });
  for (let k = -4; k <= 4; k++) b.add(box(0.12, 3.2, 0.12), m.darkMetal, placement(c.x + k * 1, 7.1, z1 + 2.5));
  for (let k = 0; k < 3; k++) b.add(box(gate * 2, 0.12, 0.12), m.darkMetal, placement(c.x, 6 + k, z1 + 2.5));
  // Drawbridge chains.
  for (const side of [-1, 1]) {
    const from = new THREE.Vector3(c.x + side * 3.4, 8, z1 + 4);
    const to = new THREE.Vector3(c.x + side * 4.2, 0.6, z1 + c.moatOuter - c.half + 2);
    const len = from.distanceTo(to);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const look = new THREE.Matrix4().lookAt(from, to, new THREE.Vector3(0, 1, 0));
    const M = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromRotationMatrix(look)).setPosition(mid);
    b.add(new THREE.CylinderGeometry(0.06, 0.06, len, 5).rotateX(Math.PI / 2), m.darkMetal, M);
  }

  buildKeep(ctx, b, banners);
  buildCourtyard(ctx, b);
  const sails = buildVillage(ctx, b, banners);

  group.add(b.build('medieval'), sails);
  group.add(banners.mesh());

  // Trees in the countryside, clear of everything built.
  const place = new Placement('medieval');
  place.avoid({ type: 'rect', minX: x0 - 30, maxX: x1 + 30, minZ: z0 - 30, maxZ: z1 + 30 });
  place.avoid({ type: 'circle', x: MEDIEVAL.windmill.x, z: MEDIEVAL.windmill.z, r: 16 });
  const t = MEDIEVAL.tournament;
  place.avoid({ type: 'rect', minX: t.x - t.w / 2 - 8, maxX: t.x + t.w / 2 + 8, minZ: t.z - t.d / 2 - 16, maxZ: t.z + t.d / 2 + 8 });
  const spots = place.scatter(170, { minX: -190, maxX: 190, minZ: -590, maxZ: -215 }, 3, 41, (x, z) => terrain.heightAt(x, z) < 14);
  group.add(buildTrees(spots.map((s) => ({ x: s.x, z: s.z, y: terrain.heightAt(s.x, s.z) - 0.1, height: 7 + s.rng() * 6 })), m, physics, 42));

  // A dragon circles the castle; crows wheel over the fields.
  const dragon = new Herd(flyer({ size: 5, body: '#6e1d16', wing: '#4a120e', beat: 0.35, dragon: true }), 1, circleMover(c.x, c.z, 85, MEDIEVAL.dragonHeight, 16, null, { absolute: true }), [], 900);
  const crows = new Herd(flyer({ size: 0.35, body: '#1e1e22', wing: '#18181c', beat: 3 }), 6, circleMover(30, -250, 40, 30, 9, terrain), [], 300);
  group.add(dragon.group, crows.group);

  return {
    id: 'medieval',
    group,
    update(view) {
      banners.update(view.time);
      dragon.update(view.time, view.camera.position);
      crows.update(view.time, view.camera.position);
      sails.rotation.z = view.time * 0.6;
    },
  };
}

/** The keep, with a great hall you can walk (or drive) into. */
function buildKeep(ctx: ZoneContext, b: ChunkedBuilder, banners: Banners): void {
  const { physics, zm, m, lights } = ctx;
  const k = MEDIEVAL.keep;
  const [hw, hd] = [k.w / 2, k.d / 2];
  const t = 1.6;
  const door = 3;
  const hall = 9;
  // Walls, with a doorway in the south face.
  const piece = (x: number, z: number, w: number, d: number, y0: number, y1: number) => {
    b.add(box(w, y1 - y0, d, 3), zm.castle, placement(x, (y0 + y1) / 2, z), STONE);
    boxCollider(physics, IDENTITY, { x, y: (y0 + y1) / 2, z }, { x: w, y: y1 - y0, z: d });
  };
  piece(k.x, k.z - hd + t / 2, k.w, t, 0, k.h);
  piece(k.x - hw + t / 2, k.z, t, k.d - 2 * t, 0, k.h);
  piece(k.x + hw - t / 2, k.z, t, k.d - 2 * t, 0, k.h);
  const side = (k.w - 2 * door) / 2;
  piece(k.x - hw + side / 2, k.z + hd - t / 2, side, t, 0, k.h);
  piece(k.x + hw - side / 2, k.z + hd - t / 2, side, t, 0, k.h);
  piece(k.x, k.z + hd - t / 2, 2 * door, t, 5.5, k.h);
  // Floor of the great hall and its ceiling, and the upper floors' slab as the roof.
  b.add(box(k.w - 2 * t, 0.1, k.d - 2 * t, 2), zm.castle, placement(k.x, 0.05, k.z), '#8c867c');
  piece(k.x, k.z, k.w - 2 * t, k.d - 2 * t, hall, hall + 0.8);
  piece(k.x, k.z, k.w, k.d, k.h, k.h + 0.6);
  for (let s = -hw + 1; s <= hw - 1; s += 2.2) {
    for (const z of [k.z - hd + 0.3, k.z + hd - 0.3]) b.add(box(1.1, 1.3, 0.6, 3), zm.castle, placement(k.x + s, k.h + 1.25, z), STONE);
  }
  for (let s = -hd + 1; s <= hd - 1; s += 2.2) {
    for (const x of [k.x - hw + 0.3, k.x + hw - 0.3]) b.add(box(0.6, 1.3, 1.1, 3), zm.castle, placement(x, k.h + 1.25, k.z + s), STONE);
  }
  // Corner turrets.
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = k.x + dx * hw;
    const z = k.z + dz * hd;
    b.add(new THREE.CylinderGeometry(2.4, 2.4, 6, 14).translate(0, k.h + 3, 0), zm.castle, placement(x, 0, z), STONE);
    b.add(new THREE.ConeGeometry(2.7, 4.5, 14).translate(0, k.h + 8.25, 0), m.roofs.shingles, placement(x, 0, z), SLATE);
  }
  banners.add(banner(k.x, k.h + 9, k.z, 4, 2, HERALDRY[1]));

  // The great hall: a red carpet to the throne, long tables, banners and chandeliers.
  const front = k.z + hd - t;
  const back = k.z - hd + t;
  b.add(box(2.4, 0.03, front - back - 3, 1), m.fabric, placement(k.x, 0.12, (front + back) / 2 + 1.5), '#8e1b1b', { castShadow: false });
  b.add(box(7, 0.6, 3.2, 2), zm.castle, placement(k.x, 0.3, back + 1.6), DARK_STONE);
  boxCollider(physics, IDENTITY, { x: k.x, y: 0.3, z: back + 1.6 }, { x: 7, y: 0.6, z: 3.2 });
  // Throne.
  b.add(box(1.4, 0.5, 1.1), m.furnitureWood, placement(k.x, 0.85, back + 1.4), '#5a3a1e');
  b.add(box(1.4, 2.6, 0.25), m.furnitureWood, placement(k.x, 1.9, back + 0.9), '#5a3a1e');
  b.add(box(1.0, 0.1, 0.9), m.fabric, placement(k.x, 1.12, back + 1.45), '#8e1b1b');
  b.add(new THREE.ConeGeometry(0.15, 0.4, 6), m.brass, placement(k.x, 3.4, back + 0.9));
  for (const tx of [-5, 5]) {
    const tableZ = (front + back) / 2 + 1;
    b.add(box(1.4, 0.1, 10, 2), m.furnitureWood, placement(k.x + tx, 0.8, tableZ), WOOD);
    for (const lz of [-4.5, 4.5]) for (const lx of [-0.55, 0.55]) b.add(box(0.12, 0.76, 0.12), m.furnitureWood, placement(k.x + tx + lx, 0.38, tableZ + lz), WOOD);
    for (const bx of [-1.1, 1.1]) b.add(box(0.4, 0.45, 9.5, 2), m.furnitureWood, placement(k.x + tx + bx, 0.25, tableZ), '#6a4a2a');
    boxCollider(physics, IDENTITY, { x: k.x + tx, y: 0.45, z: tableZ }, { x: 3, y: 0.9, z: 10 });
    for (let g = -4; g <= 4; g += 2) b.add(new THREE.CylinderGeometry(0.06, 0.05, 0.16, 8), m.brass, placement(k.x + tx + 0.3, 0.93, tableZ + g));
  }
  for (const wx of [-1, 1]) {
    for (let s = 0; s < 3; s++) banners.add(banner(k.x + wx * (hw - t - 0.05), 7, back + 4 + s * 6, 1.4, 4, HERALDRY[(s + (wx > 0 ? 1 : 0)) % 4], true, wx > 0 ? -Math.PI / 2 : Math.PI / 2));
  }
  // Chandeliers: an iron ring of candles.
  for (const cz of [back + 6, back + 14]) {
    b.add(new THREE.TorusGeometry(1.4, 0.06, 6, 20).rotateX(Math.PI / 2), m.darkMetal, placement(k.x, 6.2, cz));
    b.add(new THREE.CylinderGeometry(0.02, 0.02, hall - 6.2, 4).translate(0, (hall - 6.2) / 2, 0), m.darkMetal, placement(k.x, 6.2, cz));
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), m.porcelain, placement(k.x + Math.cos(ang) * 1.4, 6.4, cz + Math.sin(ang) * 1.4));
      b.add(new THREE.SphereGeometry(0.06, 6, 4), m.lampGlow, placement(k.x + Math.cos(ang) * 1.4, 6.62, cz + Math.sin(ang) * 1.4));
    }
    lights.add({ position: new THREE.Vector3(k.x, 5.8, cz), color: '#ffc67a', intensity: 30, range: 16, flicker: true });
  }
  // A fireplace on the east wall.
  const fx = k.x + hw - t - 0.6;
  b.add(box(1.2, 3, 3.6, 2), zm.castle, placement(fx, 1.5, k.z), DARK_STONE);
  b.add(box(0.3, 1.4, 2.2, 1), m.darkMetal, placement(fx - 0.5, 0.8, k.z), '#1a1410');
  b.add(box(0.2, 0.5, 1.6), zm.glow, placement(fx - 0.6, 0.35, k.z), '#ff7a2a');
  lights.add({ position: new THREE.Vector3(fx - 1.5, 1.2, k.z), color: '#ff9a4a', intensity: 25, range: 12, flicker: true });
}

/** Paving, a well, training dummies, hay and barrels inside the walls. */
function buildCourtyard(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm, m } = ctx;
  const c = MEDIEVAL.castle;
  b.add(box(c.half * 2 - 3, 0.04, c.half * 2 - 3, 1), zm.roads.cobble, placement(c.x, 0.02, c.z), undefined, { castShadow: false });
  // Well.
  const well = { x: c.x - 26, z: c.z + 22 };
  b.add(new THREE.CylinderGeometry(1.3, 1.4, 1.0, 16, 1, true).translate(0, 0.5, 0), zm.castle, placement(well.x, 0, well.z), DARK_STONE);
  b.add(new THREE.CircleGeometry(1.25, 16).rotateX(-Math.PI / 2).translate(0, 0.4, 0), zm.water, placement(well.x, 0, well.z));
  for (const s of [-1, 1]) b.add(box(0.15, 2.2, 0.15), zm.planks, placement(well.x + s * 1.2, 1.1, well.z), WOOD);
  b.add(box(2.8, 0.15, 0.15), zm.planks, placement(well.x, 2.2, well.z), WOOD);
  b.add(new THREE.ConeGeometry(1.8, 0.9, 4).rotateY(Math.PI / 4).translate(0, 2.7, 0), m.roofs.thatch, placement(well.x, 0, well.z), '#a88a55');
  cylinderCollider(physics, well.x, 0, well.z, 1.4, 1.0);
  // Training dummies: a post, a straw body and a crossbar.
  for (let i = 0; i < 4; i++) {
    const x = c.x + 18 + i * 4;
    const z = c.z + 18;
    b.add(box(0.15, 2.2, 0.15), zm.planks, placement(x, 1.1, z), WOOD);
    b.add(new THREE.CylinderGeometry(0.32, 0.36, 0.9, 10), m.roofs.thatch, placement(x, 1.6, z), '#c9a86a');
    b.add(new THREE.SphereGeometry(0.22, 10, 8), m.roofs.thatch, placement(x, 2.25, z), '#c9a86a');
    b.add(box(1.2, 0.1, 0.1), zm.planks, placement(x, 1.85, z), WOOD);
    cylinderCollider(physics, x, 0, z, 0.35, 2.3);
  }
  // Hay and barrels by the walls.
  for (let i = 0; i < 6; i++) {
    const x = c.x - c.half + 5 + (i % 3) * 2.2;
    const z = c.z - c.half + 5 + Math.floor(i / 3) * 2.4;
    b.add(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 14).rotateZ(Math.PI / 2), m.roofs.thatch, placement(x, 0.75, z), '#d8b86a');
    cylinderCollider(physics, x, 0, z, 0.8, 1.5);
  }
  for (let i = 0; i < 8; i++) {
    const x = c.x + c.half - 5 - (i % 4) * 1.1;
    const z = c.z - c.half + 5 + Math.floor(i / 4) * 1.2;
    b.add(barrel(), zm.planks, placement(x, 0, z), '#7a5432');
    cylinderCollider(physics, x, 0, z, 0.45, 1.1);
  }
}

/** A wooden barrel standing on the ground. */
function barrel(): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    [
      [0.36, 0],
      [0.44, 0.3],
      [0.46, 0.55],
      [0.44, 0.8],
      [0.36, 1.1],
      [0, 1.1],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    14,
  );
}

/** Market stalls, the smithy, the windmill and the tournament grounds. */
function buildVillage(ctx: ZoneContext, b: ChunkedBuilder, banners: Banners): THREE.Group {
  const { physics, zm, m, lights, terrain } = ctx;
  const sq = MEDIEVAL.square;
  // Market stalls in the square's four corners, facing its middle.
  const stallColors = ['#b8452e', '#2e5a8a', '#c9a227', '#2f6b35', '#7a3a7a', '#b86a2e'];
  let n = 0;
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      for (const along of [0, 1]) {
        const x = sq.x + dx * (along ? 9 : 15);
        const z = sq.z + dz * (along ? 15 : 9);
        const yaw = Math.atan2(sq.x - x, sq.z - z);
        const M = placement(x, 0, z, yaw);
        const color = stallColors[n++ % stallColors.length];
        for (const [px, pz] of [[-1.4, -0.8], [1.4, -0.8], [-1.4, 0.8], [1.4, 0.8]]) b.add(box(0.12, 2.4, 0.12), zm.planks, M.clone().multiply(placement(px, 1.2, pz)), WOOD);
        b.add(box(3, 0.9, 1.0, 1), zm.planks, M.clone().multiply(placement(0, 0.45, 0.4)), '#8a6a48');
        b.add(box(3.3, 0.06, 2.2, 1), zm.paint, M.clone().multiply(placement(0, 2.45, 0.1, 0, 0.2)), color);
        // Goods on the counter.
        for (let g = -1; g <= 1; g++) b.add(new THREE.SphereGeometry(0.16, 8, 6), zm.paint, M.clone().multiply(placement(g * 0.8, 1.02, 0.4)), ['#c8402a', '#e0b030', '#6a9a3a'][(g + 1 + n) % 3]);
        boxCollider(physics, M, { x: 0, y: 0.6, z: 0.2 }, { x: 3.2, y: 1.2, z: 1.8 });
      }
    }
  }
  // The well on the square.
  const w = MEDIEVAL.well;
  b.add(new THREE.CylinderGeometry(1.1, 1.2, 0.9, 14, 1, true).translate(0, 0.45, 0), zm.castle, placement(w.x, 0, w.z), DARK_STONE);
  b.add(new THREE.ConeGeometry(1.6, 0.8, 4).rotateY(Math.PI / 4).translate(0, 2.4, 0), m.roofs.thatch, placement(w.x, 0, w.z), '#a88a55');
  for (const s of [-1, 1]) b.add(box(0.14, 2.1, 0.14), zm.planks, placement(w.x + s, 1.05, w.z), WOOD);
  cylinderCollider(physics, w.x, 0, w.z, 1.2, 0.9);

  // The smithy: a roof on posts over a glowing forge and an anvil.
  const s = MEDIEVAL.smithy;
  for (const [px, pz] of [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]]) {
    b.add(box(0.25, 3.2, 0.25), zm.planks, placement(s.x + px, 1.6, s.z + pz), WOOD);
    cylinderCollider(physics, s.x + px, 0, s.z + pz, 0.18, 3.2);
  }
  b.add(box(7.4, 0.25, 6.4, 2), m.roofs.thatch, placement(s.x, 3.3, s.z, 0, 0, 0.15), '#9a7a48');
  b.add(box(2, 1.1, 1.6, 2), zm.castle, placement(s.x - 1.5, 0.55, s.z - 1.2), DARK_STONE);
  b.add(box(1.4, 0.12, 1.0), zm.glow, placement(s.x - 1.5, 1.12, s.z - 1.2), '#ff6a1a');
  b.add(box(0.5, 0.35, 0.9), m.darkMetal, placement(s.x + 1.2, 0.75, s.z + 0.6));
  b.add(box(0.3, 0.55, 0.3), m.darkMetal, placement(s.x + 1.2, 0.28, s.z + 0.6));
  boxCollider(physics, IDENTITY, { x: s.x - 1.5, y: 0.55, z: s.z - 1.2 }, { x: 2, y: 1.1, z: 1.6 });
  lights.add({ position: new THREE.Vector3(s.x - 1.5, 1.8, s.z - 1.2), color: '#ff8a3a', intensity: 18, range: 12, flicker: true });

  // The windmill on its hill.
  const wm = MEDIEVAL.windmill;
  const wy = wm.y;
  b.add(new THREE.CylinderGeometry(3, 4.2, 12, 16).translate(0, 6, 0), zm.castle, placement(wm.x, wy, wm.z), '#d8d0c0');
  b.add(new THREE.ConeGeometry(3.8, 4, 16).translate(0, 14, 0), m.roofs.thatch, placement(wm.x, wy, wm.z), '#8a6a3a');
  b.add(box(1.4, 2.4, 0.2), m.door, placement(wm.x, wy + 1.2, wm.z + 4.05), '#5a3a22');
  cylinderCollider(physics, wm.x, wy, wm.z, 4.1, 16);
  const sails = new THREE.Group();
  const sailMat = zm.planks;
  for (let k = 0; k < 4; k++) {
    const arm = new THREE.Group();
    arm.rotation.z = (k / 4) * Math.PI * 2;
    const spar = new THREE.Mesh(box(0.25, 9, 0.2), sailMat);
    spar.position.y = 4.8;
    const cloth = new THREE.Mesh(box(1.8, 7, 0.06), zm.paint);
    cloth.position.set(1.0, 5.4, 0);
    arm.add(spar, cloth);
    sails.add(arm);
  }
  sails.position.set(wm.x, wy + 11.5, wm.z + 4.2);
  sails.traverse((o) => (o.castShadow = true));

  // Tournament grounds: fence, the tilt barrier, stands and striped pavilions.
  const t = MEDIEVAL.tournament;
  const [tx0, tx1, tz0, tz1] = [t.x - t.w / 2, t.x + t.w / 2, t.z - t.d / 2, t.z + t.d / 2];
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bx - ax, bz - az);
    const M = placement((ax + bx) / 2, 0, (az + bz) / 2, yaw);
    for (const y of [0.55, 1.05]) b.add(box(0.1, 0.12, len), zm.planks, M.clone().multiply(placement(0, y, 0)), '#8a6a48');
    for (let p = -len / 2; p <= len / 2; p += 3) b.add(box(0.16, 1.2, 0.16), zm.planks, M.clone().multiply(placement(0, 0.6, p)), WOOD);
    boxCollider(physics, M, { x: 0, y: 0.6, z: 0 }, { x: 0.2, y: 1.2, z: len });
  };
  rail(tx0, tz0, tx1, tz0);
  rail(tx0, tz1, tx0 + t.w * 0.4, tz1);
  rail(tx1 - t.w * 0.4, tz1, tx1, tz1);
  rail(tx0, tz0, tx0, tz1);
  rail(tx1, tz0, tx1, tz1);
  // The tilt: a long painted barrier down the middle.
  b.add(box(t.w * 0.7, 1.3, 0.25, 1), zm.paint, placement(t.x, 0.65, t.z), '#e8e2d0');
  for (let k = 0; k < 14; k++) b.add(box(2.2, 1.32, 0.27), zm.paint, placement(t.x - t.w * 0.35 + 1.25 + k * 5, 0.65, t.z), '#8e1b1b');
  boxCollider(physics, IDENTITY, { x: t.x, y: 0.65, z: t.z }, { x: t.w * 0.7, y: 1.3, z: 0.3 });
  // Stands on the north side.
  for (let row = 0; row < 4; row++) {
    const z = tz0 - 3 - row * 1.2;
    b.add(box(t.w * 0.5, 0.5 + row * 0.6, 1.2, 2), zm.planks, placement(t.x, (0.5 + row * 0.6) / 2, z), '#8a6440');
  }
  boxCollider(physics, IDENTITY, { x: t.x, y: 1.2, z: tz0 - 4.8 }, { x: t.w * 0.5, y: 2.4, z: 4.8 });
  b.add(box(t.w * 0.5, 0.15, 5.6, 2), zm.paint, placement(t.x, 5.2, tz0 - 4.8, 0, -0.08), '#1d3c8a');
  for (const px of [-1, 1]) for (const pz of [0, 1]) b.add(box(0.2, 5.2, 0.2), zm.planks, placement(t.x + px * t.w * 0.24, 2.6, tz0 - 2.4 - pz * 4.6), WOOD);
  // Pavilions at both ends of the lists.
  for (const [px, color] of [
    [tx0 - 9, '#8e1b1b'],
    [tx1 + 9, '#1d3c8a'],
  ] as const) {
    for (const pz of [-8, 8]) {
      const x = px;
      const z = t.z + pz;
      const y = ctx.terrain.heightAt(x, z);
      b.add(new THREE.CylinderGeometry(3, 3, 2.6, 16, 1, true).translate(0, 1.3, 0), zm.paint, placement(x, y, z), '#efe8d8');
      b.add(new THREE.ConeGeometry(3.4, 2.6, 16).translate(0, 3.9, 0), zm.paint, placement(x, y, z), color);
      cylinderCollider(physics, x, y, z, 3, 2.6);
      banners.add(banner(x, y + 6.4, z, 1.6, 0.7, color));
      b.add(new THREE.CylinderGeometry(0.04, 0.04, 2, 5).translate(0, 5.6, 0), m.darkMetal, placement(x, y, z));
    }
  }
  // Hay bales in the fields south of the village.
  for (let i = 0; i < 26; i++) {
    const x = -150 + ((i * 53) % 300);
    const z = -250 + ((i * 37) % 40);
    if (Math.abs(x) < 10 || Math.abs(x - MEDIEVAL.smithy.x) < 12) continue;
    const y = terrain.heightAt(x, z);
    b.add(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 14).rotateZ(Math.PI / 2), m.roofs.thatch, placement(x, y + 0.65, z, i), '#d8b86a');
    cylinderCollider(physics, x, y, z, 0.75, 1.4);
  }
  return sails;
}
