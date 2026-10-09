import * as THREE from 'three';
import { MEDIEVAL } from '../../../../shared/zones/medieval.ts';
import { boxCollider } from '../town/colliders.ts';
import { box, IDENTITY, placement } from '../town/meshBuilder.ts';
import { buildTrees } from '../town/props.ts';
import type { Mount } from '../../game/activities.ts';
import { game, onTrigger } from '../../game/link.ts';
import { AVATAR } from '../../player/character.ts';
import { ballistic, benchSeats, buttonActivity, zoneSeats } from './buttons.ts';
import { banner, Banners } from './cloth.ts';
import { circleMover, flyer, Herd, loopMover, type Mover, runner } from './creatures.ts';
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
  const bell = buildBellTower(ctx, b);
  const trebuchet = buildTrebuchet(ctx, b);
  const horses = buildCountryside(ctx, b);

  group.add(b.build('medieval'), sails, bell.group, trebuchet.group, horses.group);
  group.add(banners.mesh());

  // Trees in the countryside, clear of everything built.
  const place = new Placement('medieval');
  place.avoid({ type: 'rect', minX: x0 - 30, maxX: x1 + 30, minZ: z0 - 30, maxZ: z1 + 30 });
  place.avoid({ type: 'circle', x: MEDIEVAL.windmill.x, z: MEDIEVAL.windmill.z, r: 16 });
  place.avoid({ type: 'circle', x: MEDIEVAL.trebuchet.x, z: MEDIEVAL.trebuchet.z, r: 16 });
  place.avoid({ type: 'rect', minX: PADDOCK.x - 16, maxX: PADDOCK.x + 16, minZ: PADDOCK.z - 12, maxZ: PADDOCK.z + 12 });
  // Keep the trebuchet's line of fire clear.
  place.avoid({ type: 'path', path: [{ x: MEDIEVAL.trebuchet.x, y: 0, z: MEDIEVAL.trebuchet.z }, { x: c.x - c.moatOuter, y: 0, z: MEDIEVAL.trebuchet.target.z }], width: 30 });
  const t = MEDIEVAL.tournament;
  place.avoid({ type: 'rect', minX: t.x - t.w / 2 - 8, maxX: t.x + t.w / 2 + 8, minZ: t.z - t.d / 2 - 16, maxZ: t.z + t.d / 2 + 8 });
  const spots = place.scatter(170, { minX: -190, maxX: 190, minZ: -590, maxZ: -215 }, 3, 41, (x, z) => terrain.heightAt(x, z) < 14);
  group.add(buildTrees(spots.map((s) => ({ x: s.x, z: s.z, y: terrain.heightAt(s.x, s.z) - 0.1, height: 7 + s.rng() * 6 })), m, physics, 42));

  // A dragon circles the castle; crows wheel over the fields.
  const dragonFlight = circleMover(c.x, c.z, 85, MEDIEVAL.dragonHeight, 16, null, { absolute: true });
  const dragon = new Herd(flyer({ size: 5, body: '#6e1d16', wing: '#4a120e', beat: 0.35, dragon: true }), 1, dragonFlight, [], 900);
  const breath = new DragonFire(dragonFlight);
  const crows = new Herd(flyer({ size: 0.35, body: '#1e1e22', wing: '#18181c', beat: 3 }), 6, circleMover(30, -250, 40, 30, 9, terrain), [], 300);
  group.add(dragon.group, crows.group, breath.group);

  return {
    id: 'medieval',
    group,
    update(view) {
      banners.update(view.time);
      dragon.update(view.clock, view.camera.position);
      breath.update(view.clock, view.camera.position);
      crows.update(view.clock, view.camera.position);
      sails.rotation.z = view.clock * 0.6;
      bell.update(view.dt);
      trebuchet.update(view.dt);
      horses.update(view.clock, view.camera.position);
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
  zoneSeats.push({ id: 'medieval/throne', position: new THREE.Vector3(k.x, 1.12, back + 1.45), yaw: 0, floorY: 0.6, label: 'throne' });
  b.add(box(1.4, 0.5, 1.1), m.furnitureWood, placement(k.x, 0.85, back + 1.4), '#5a3a1e');
  b.add(box(1.4, 2.6, 0.25), m.furnitureWood, placement(k.x, 1.9, back + 0.9), '#5a3a1e');
  b.add(box(1.0, 0.1, 0.9), m.fabric, placement(k.x, 1.12, back + 1.45), '#8e1b1b');
  b.add(new THREE.ConeGeometry(0.15, 0.4, 6), m.brass, placement(k.x, 3.4, back + 0.9));
  for (const tx of [-5, 5]) {
    const tableZ = (front + back) / 2 + 1;
    b.add(box(1.4, 0.1, 10, 2), m.furnitureWood, placement(k.x + tx, 0.8, tableZ), WOOD);
    for (const lz of [-4.5, 4.5]) for (const lx of [-0.55, 0.55]) b.add(box(0.12, 0.76, 0.12), m.furnitureWood, placement(k.x + tx + lx, 0.38, tableZ + lz), WOOD);
    for (const bx of [-1.1, 1.1]) {
      b.add(box(0.4, 0.45, 9.5, 2), m.furnitureWood, placement(k.x + tx + bx, 0.25, tableZ), '#6a4a2a');
      // Places at the feast: facing the table.
      const x = k.x + tx + bx * 1.08;
      zoneSeats.push(...benchSeats(`medieval/feast${tx}${bx}`, { x, z: tableZ - 4 }, { x, z: tableZ + 4 }, 0.5, 0, bx > 0 ? -Math.PI / 2 : Math.PI / 2, 'feast bench', 1.3));
    }
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
  // Stands on the north side: rows low enough to step up, with seats along each.
  for (let row = 0; row < 4; row++) {
    const z = tz0 - 3 - row * 1.2;
    const top = 0.45 * (row + 1);
    b.add(box(t.w * 0.5, top, 1.2, 2), zm.planks, placement(t.x, top / 2, z), '#8a6440');
    boxCollider(physics, IDENTITY, { x: t.x, y: top / 2, z }, { x: t.w * 0.5, y: top, z: 1.2 });
    zoneSeats.push(...benchSeats(`medieval/stands${row}`, { x: t.x - t.w * 0.23, z: z + 0.25 }, { x: t.x + t.w * 0.23, z: z + 0.25 }, top + 0.02, top, 0, 'stands', 2.4));
  }
  b.add(box(t.w * 0.5, 0.15, 5.6, 2), zm.paint, placement(t.x, 4.6, tz0 - 4.8, 0, -0.08), '#1d3c8a');
  for (const px of [-1, 1]) for (const pz of [0, 1]) b.add(box(0.2, 4.6, 0.2), zm.planks, placement(t.x + px * t.w * 0.24, 2.3, tz0 - 2.4 - pz * 4.6), WOOD);
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

/** Every so often the dragon roars and breathes a long jet of fire (the same moment for everyone). */
class DragonFire {
  readonly group = new THREE.Group();
  private flames: THREE.Mesh[] = [];
  private pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  private roared = -Infinity;
  private static EVERY = 50;
  private static LENGTH = 3.5;

  constructor(private flight: Mover) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 1.2, 0.3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (let i = 0; i < 14; i++) {
      const flame = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), material);
      this.flames.push(flame);
      this.group.add(flame);
    }
    this.group.visible = false;
  }

  update(clock: number, camera: THREE.Vector3): void {
    const phase = clock % DragonFire.EVERY;
    const on = phase < DragonFire.LENGTH;
    this.group.visible = on;
    if (!on) return;
    this.flight(0, clock, this.pose);
    const p = this.pose;
    const fwd = new THREE.Vector3(Math.sin(p.yaw), -0.35, Math.cos(p.yaw)).normalize();
    const mouth = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(fwd, 7.5);
    if (clock - this.roared > DragonFire.EVERY / 2) {
      this.roared = clock;
      if (camera.distanceTo(mouth) < 320) game.sounds?.roar(mouth);
    }
    // Puffs of fire streaming out ahead, growing as they go.
    this.flames.forEach((f, i) => {
      const k = ((phase * 3 + i / this.flames.length) % 1) * Math.min(1, phase * 2) * Math.min(1, (DragonFire.LENGTH - phase) * 2);
      const d = k * 26;
      f.position.copy(mouth).addScaledVector(fwd, d);
      f.position.y -= k * k * 4;
      f.scale.setScalar(0.6 + k * 3.2);
    });
  }
}

/** A paddock of horses between the tournament grounds and the castle. */
const PADDOCK = { x: -112, z: -428, w: 26, d: 18 };

/**
 * Life in the countryside: horses in their paddock, hay carts, scarecrows in the fields,
 * crates and barrels round the market, and torches by the castle gate and the keep.
 */
function buildCountryside(ctx: ZoneContext, b: ChunkedBuilder): Herd {
  const { physics, zm, m, terrain, lights } = ctx;
  const ground = (x: number, z: number) => terrain.heightAt(x, z);
  const P = PADDOCK;
  // The paddock fence: posts and two rails, with a gate gap on the south side.
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bx - ax, bz - az);
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const y = ground(mx, mz);
    const M = placement(mx, y, mz, yaw);
    for (const ry of [0.6, 1.1]) b.add(box(0.08, 0.1, len), zm.planks, M.clone().multiply(placement(0, ry, 0)), '#7a5a3a');
    for (let s = -len / 2; s <= len / 2; s += 3) b.add(box(0.14, 1.3, 0.14), zm.planks, M.clone().multiply(placement(0, 0.65, s)), WOOD);
    boxCollider(physics, M, { x: 0, y: 0.65, z: 0 }, { x: 0.2, y: 1.3, z: len });
  };
  const [x0, x1, z0, z1] = [P.x - P.w / 2, P.x + P.w / 2, P.z - P.d / 2, P.z + P.d / 2];
  rail(x0, z0, x1, z0);
  rail(x0, z0, x0, z1);
  rail(x1, z0, x1, z1);
  rail(x0, z1, P.x - 2, z1);
  rail(P.x + 2, z1, x1, z1);
  // A water trough and a hay rack.
  b.add(box(2.4, 0.5, 0.7, 1), zm.planks, placement(x0 + 2, ground(x0 + 2, P.z) + 0.25, P.z), '#6a4a2a');
  b.add(box(2.2, 0.05, 0.55), zm.water, placement(x0 + 2, ground(x0 + 2, P.z) + 0.48, P.z));
  b.add(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 14).rotateZ(Math.PI / 2), m.roofs.thatch, placement(x1 - 2.5, ground(x1 - 2.5, P.z - 4) + 0.7, P.z - 4), '#d8b86a');
  const horses = new Herd(
    runner('horse', '#8a5a32'),
    4,
    loopMover([[x0 + 5, z0 + 4], [x1 - 6, z0 + 5], [x1 - 5, z1 - 4], [x0 + 6, z1 - 5]], 1.3, terrain, { spacing: 9, spread: 1.5 }),
    [1, 0.95, 1.05, 0.9],
  );
  ['#8a5a32', '#2a2220', '#e8e2d8', '#6a4a32'].forEach((c, i) => {
    for (const p of [0, 1, 2, 5, 6, 7, 8]) horses.tint(i, p, c);
  });

  // Hay carts by the village.
  for (const [x, z, yaw] of [[-36, -288, 0.4], [100, -312, -1.2]] as const) {
    const y = ground(x, z);
    const M = placement(x, y, z, yaw);
    b.add(box(1.8, 0.12, 3, 1), zm.planks, M.clone().multiply(placement(0, 0.9, 0)), '#8a6440');
    for (const side of [-1, 1]) b.add(box(0.08, 0.5, 3, 1), zm.planks, M.clone().multiply(placement(side * 0.9, 1.2, 0)), '#7a5432');
    b.add(box(1.7, 0.8, 2.8, 1), m.roofs.thatch, M.clone().multiply(placement(0, 1.4, 0)), '#d8b86a');
    for (const side of [-1, 1]) {
      const wheel = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 14).rotateZ(Math.PI / 2);
      b.add(wheel, zm.planks, M.clone().multiply(placement(side * 1.0, 0.55, 0.6)), '#4a3220');
    }
    b.add(box(0.1, 0.1, 2.4), zm.planks, M.clone().multiply(placement(0, 0.7, 2.6, 0, -0.25)), WOOD);
    boxCollider(physics, M, { x: 0, y: 1, z: 0 }, { x: 2.2, y: 2, z: 3 });
  }
  // Scarecrows watching the fields.
  for (const [x, z] of [[-60, -232], [112, -240], [-128, -236]] as const) {
    const y = ground(x, z);
    b.add(box(0.1, 2.4, 0.1), zm.planks, placement(x, y + 1.2, z), WOOD);
    b.add(box(1.6, 0.08, 0.08), zm.planks, placement(x, y + 1.8, z), WOOD);
    b.add(box(0.5, 0.7, 0.3, 1), m.fabric, placement(x, y + 1.6, z), '#5a6a8a');
    b.add(new THREE.SphereGeometry(0.2, 10, 8), m.roofs.thatch, placement(x, y + 2.25, z), '#d8b86a');
    b.add(new THREE.ConeGeometry(0.35, 0.35, 12), m.roofs.thatch, placement(x, y + 2.5, z), '#8a6a3a');
  }
  // Crates, sacks and barrels round the market stalls.
  const sq = MEDIEVAL.square;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sq.x + dx * 18.5;
    const z = sq.z + dz * 18.5;
    b.add(box(0.8, 0.8, 0.8, 1), zm.planks, placement(x, 0.4, z, dx), '#8a6a44');
    b.add(box(0.7, 0.7, 0.7, 1), zm.planks, placement(x + dx * 0.9, 0.35, z, 0.3), '#7a5a3a');
    b.add(barrel(), zm.planks, placement(x - dx * 0.2, 0, z + dz * 1.0), '#7a5432');
    b.add(new THREE.SphereGeometry(0.35, 8, 6).scale(1, 0.8, 1), m.fabric, placement(x + dx * 0.4, 1.05, z), '#c8b48a');
    cylinderCollider(physics, x, 0, z, 1, 1);
  }
  // Torches by the castle gate and the keep's door: flickering at night.
  const c = MEDIEVAL.castle;
  const k = MEDIEVAL.keep;
  const torches = [
    [c.x - 6.6, 3.8, c.z + c.half + 4.15],
    [c.x + 6.6, 3.8, c.z + c.half + 4.15],
    [k.x - 4, 3.6, k.z + k.d / 2 + 0.25],
    [k.x + 4, 3.6, k.z + k.d / 2 + 0.25],
  ] as const;
  for (const [x, y, z] of torches) {
    b.add(new THREE.CylinderGeometry(0.06, 0.04, 0.7, 6).rotateX(-0.4), m.darkMetal, placement(x, y, z));
    b.add(new THREE.ConeGeometry(0.12, 0.3, 8).translate(0, 0.15, 0), zm.glow, placement(x, y + 0.35, z + 0.12), '#ff9a3a');
    lights.add({ position: new THREE.Vector3(x, y + 0.7, z + 0.4), color: '#ff9a4a', intensity: 9, range: 9, flicker: true });
  }
  return horses;
}

/** The bell tower on the market square: pull the rope and the bell swings and rings out. */
function buildBellTower(ctx: ZoneContext, b: ChunkedBuilder): { group: THREE.Group; update(dt: number): void } {
  const { physics, zm, m } = ctx;
  const { x, z } = MEDIEVAL.bellTower;
  const shaft = 9;
  b.add(box(4, shaft, 4, 3), zm.castle, placement(x, shaft / 2, z), STONE);
  boxCollider(physics, IDENTITY, { x, y: shaft / 2, z }, { x: 4, y: shaft, z: 4 });
  b.add(box(4.4, 0.4, 4.4, 3), zm.castle, placement(x, shaft + 0.2, z), DARK_STONE);
  // An open belfry: four pillars under a slate spire.
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.add(box(0.7, 3.4, 0.7, 3), zm.castle, placement(x + dx * 1.75, shaft + 2.1, z + dz * 1.75), STONE);
  b.add(box(4.4, 0.5, 4.4, 3), zm.castle, placement(x, shaft + 4, z), DARK_STONE);
  b.add(new THREE.ConeGeometry(3.3, 5, 4).rotateY(Math.PI / 4).translate(0, shaft + 6.75, 0), m.roofs.shingles, placement(x, 0, z), SLATE);
  b.add(box(0.25, 0.25, 4.2), zm.planks, placement(x, shaft + 3.4, z), WOOD);
  // A little arched door, and the rope's end hanging by it.
  b.add(box(1.3, 2.3, 0.1), m.door, placement(x, 1.15, z + 2.02), '#5a3a22');
  const group = new THREE.Group();
  const bronze = new THREE.MeshStandardMaterial({ color: '#a8782e', metalness: 0.9, roughness: 0.35 });
  const yoke = new THREE.Group();
  yoke.position.set(x, shaft + 3.3, z);
  const bellShape = new THREE.LatheGeometry(
    [[0, 0], [0.45, -0.05], [0.55, -0.4], [0.62, -0.9], [0.82, -1.3], [0.85, -1.4], [0.7, -1.38], [0.6, -1.0], [0.5, -0.45], [0, -0.3]].map(([r, y]) => new THREE.Vector2(r, y)),
    24,
  );
  const bellMesh = new THREE.Mesh(bellShape, bronze);
  bellMesh.castShadow = true;
  yoke.add(bellMesh);
  const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), m.darkMetal);
  clapper.position.y = -1.15;
  yoke.add(clapper);
  // The rope runs down the outside of the tower to where you pull it.
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, shaft + 2, 5).translate(0, -(shaft + 2) / 2, 0), m.fabric);
  rope.material = new THREE.MeshStandardMaterial({ color: '#c8a870', roughness: 1 });
  rope.position.set(0.9, 0, 2.3);
  yoke.add(rope);
  group.add(yoke);
  game.activities.add(buttonActivity('medieval/bell'));
  let swing = -1;
  onTrigger('medieval/bell', () => {
    swing = 0;
    const at = new THREE.Vector3(x, shaft + 3, z);
    for (let k = 0; k < 4; k++) game.sounds?.bell(at, k * 1.25);
  });
  return {
    group,
    update(dt) {
      if (swing < 0) return;
      swing += dt;
      const amp = Math.exp(-swing / 2.4) * 0.65;
      yoke.rotation.x = Math.sin((swing / 2.5) * Math.PI * 2) * amp;
      if (amp < 0.01) {
        swing = -1;
        yoke.rotation.x = 0;
      }
    },
  };
}

/**
 * A trebuchet aimed over the castle walls. Climb into the sling, and it hurls you into
 * the courtyard (everyone sees its arm swing).
 */
function buildTrebuchet(ctx: ZoneContext, b: ChunkedBuilder): { group: THREE.Group; update(dt: number): void } {
  const { physics, zm, m } = ctx;
  const T = MEDIEVAL.trebuchet;
  const yaw = Math.atan2(T.target.x - T.x, T.target.z - T.z);
  const M = placement(T.x, T.y, T.z, yaw);
  const pivotY = 6.5;
  const long = 9;
  const short = 2.6;
  // The frame: two A-frames on a base, joined by the axle.
  b.add(box(5, 0.5, 10, 1), zm.planks, M.clone().multiply(placement(0, 0.25, 0)), WOOD);
  for (const side of [-1, 1]) {
    for (const dz of [-1, 1]) b.add(box(0.4, 7.6, 0.4, 1), zm.planks, M.clone().multiply(placement(side * 1.6, 3.6, dz * 1.6, 0, dz * 0.42)), WOOD);
    b.add(box(0.4, 0.4, 4.4, 1), zm.planks, M.clone().multiply(placement(side * 1.6, 2.6, 0)), WOOD);
  }
  b.add(new THREE.CylinderGeometry(0.18, 0.18, 3.8, 10).rotateZ(Math.PI / 2), m.darkMetal, M.clone().multiply(placement(0, pivotY, 0)));
  for (const side of [-1, 1]) boxCollider(physics, M, { x: side * 1.6, y: 3.4, z: 0 }, { x: 0.5, y: 6.8, z: 5 });
  boxCollider(physics, M, { x: 0, y: 0.25, z: 0 }, { x: 5, y: 0.5, z: 10 });
  // A wheeled ladder, and stones piled ready.
  for (let i = 0; i < 5; i++) b.add(new THREE.SphereGeometry(0.45, 8, 6), zm.castle, M.clone().multiply(placement(2.8 + (i % 2) * 0.6, 0.45 + Math.floor(i / 3) * 0.6, -3 + i * 0.5)), '#8a8478');

  const group = new THREE.Group();
  group.position.set(T.x, T.y + pivotY, T.z);
  group.rotation.y = yaw;
  const arm = new THREE.Group();
  group.add(arm);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, long + short), zm.planks);
  beam.position.z = (long - short) / 2;
  const weight = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2, 2), zm.planks);
  weight.position.set(0, -1, -short);
  const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 1, side: THREE.DoubleSide }));
  pouch.position.z = long;
  arm.add(beam, weight, pouch);
  arm.traverse((o) => (o.castShadow = true));
  // The long end rests down behind the frame; firing whips it up and over. The arm's angle
  // is its long end's elevation: 0 points at the target, PI/2 straight up.
  const REST = Math.PI + 0.62;
  const RELEASE = Math.PI / 2 - 0.25;
  const END = 0.35;
  const FIRE_TIME = 0.95;
  const armAngle = (a: number) => (arm.rotation.x = -a);
  armAngle(REST);
  let t = -1;
  let angle = REST;
  const sling = new THREE.Vector3();
  const slingPoint = () => {
    group.updateMatrixWorld(true);
    return pouch.getWorldPosition(sling);
  };
  const target = new THREE.Vector3(T.target.x, 0.2, T.target.z);
  const fire = () => {
    if (t >= 0 && t < FIRE_TIME) return;
    t = 0;
    game.sounds?.whoosh(slingPoint(), 1.2);
  };
  game.activities.add(
    buttonActivity('medieval/trebuchet', () => {
      if (t >= 0) return false;
      const rider: Mount = {
        position: new THREE.Vector3(),
        yaw,
        pose: 'sit',
        label: 'trebuchet',
        ride: true,
        update() {
          rider.position.copy(slingPoint()).y += 0.1;
        },
        blocked: () => 'Hold on tight!',
        done: () => angle <= RELEASE,
        exit: () => slingPoint().clone(),
        release: () => ballistic(slingPoint(), target, 0.62, AVATAR.gravity),
      };
      game.ride(rider);
      fire();
      return true;
    }),
  );
  // Our own shot started the moment we climbed in.
  onTrigger('medieval/trebuchet', (_by, mine) => {
    if (!mine) fire();
  });
  return {
    group,
    update(dt) {
      if (t < 0) return;
      t += dt;
      if (t < FIRE_TIME) angle = REST - (REST - END) * (t / FIRE_TIME) ** 2;
      else angle = END + (REST - END) * Math.min(1, (t - FIRE_TIME) / 5) ** 2;
      armAngle(angle);
      if (t > FIRE_TIME + 5) {
        t = -1;
        angle = REST;
        armAngle(REST);
      }
    },
  };
}
