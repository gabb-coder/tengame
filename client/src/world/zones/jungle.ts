import * as THREE from 'three';
import { JUNGLE } from '../../../../shared/zones/jungle.ts';
import { boxCollider } from '../town/colliders.ts';
import { box, IDENTITY, placement } from '../town/meshBuilder.ts';
import { circleMover, flyer, Herd } from './creatures.ts';
import { ChunkedBuilder, compose, cylinderCollider, fern, hull, instanced, mulberry32, palms, Placement, Puffs, rockGeometry, type ZoneContent, type ZoneContext } from './kit.ts';

const MOSS = '#7a8a62';
const STONE = '#8a8a78';

/** The Emerald Jungle: rainforest, a waterfall, a lagoon and a lost temple. */
export function buildJungle(ctx: ZoneContext): ZoneContent {
  const { physics, zm, m, terrain, lights } = ctx;
  const group = new THREE.Group();
  group.name = 'zone-jungle';
  const b = new ChunkedBuilder();
  const ground = (x: number, z: number) => terrain.heightAt(x, z);
  const place = new Placement('jungle');
  const t = JUNGLE.temple;
  place.avoid({ type: 'rect', minX: t.x - 36, maxX: t.x + 36, minZ: t.z - 30, maxZ: t.z + 32 });
  const area = { minX: -598, maxX: -205, minZ: -198, maxZ: 198 };

  // Giant rainforest trees: tall trunks, buttress roots and broad layered crowns.
  const giants = place.scatter(330, area, 4.5, 151, (x, z) => ground(x, z) > -0.5);
  const trunkGeo = new THREE.CylinderGeometry(0.035, 0.06, 1, 8).translate(0, 0.5, 0);
  const roots = new THREE.ConeGeometry(0.12, 0.12, 6).translate(0, 0.06, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1).scale(1, 0.45, 1);
  const trunkItems: { matrix: THREE.Matrix4; color: string }[] = [];
  const crownItems: { matrix: THREE.Matrix4; color: string }[] = [];
  const crownColors = ['#2f5a24', '#3a6a2a', '#28501f', '#45722e'];
  for (const g of giants) {
    const h = 18 + g.rng() * 16;
    const y = ground(g.x, g.z) - 0.3;
    trunkItems.push({ matrix: compose(g.x, y, g.z, g.rng() * 6, h), color: '#9a8a70' });
    trunkItems.push({ matrix: compose(g.x, y, g.z, g.rng() * 6, h * 0.9), color: '#8a7a60' });
    for (let k = 0; k < 3; k++) {
      const a = g.rng() * Math.PI * 2;
      const r = h * (0.22 + g.rng() * 0.12);
      const off = k === 0 ? 0 : r * 0.6;
      crownItems.push({
        matrix: compose(g.x + Math.cos(a) * off, y + h * (0.88 + k * 0.05), g.z + Math.sin(a) * off, g.rng() * 6, new THREE.Vector3(r, r, r)),
        color: crownColors[Math.floor(g.rng() * crownColors.length)],
      });
    }
    cylinderCollider(physics, g.x, y, g.z, 0.9, h * 0.6);
  }
  group.add(instanced(trunkGeo, m.bark, trunkItems.filter((_, i) => i % 2 === 0)));
  group.add(instanced(roots, m.bark, trunkItems.filter((_, i) => i % 2 === 1)));
  group.add(instanced(crownGeo, m.foliage, crownItems));

  // Hanging vines from the canopy.
  const vineGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 4).translate(0, -0.5, 0);
  const vines: { matrix: THREE.Matrix4; color: string }[] = [];
  const vr = mulberry32(152);
  for (const g of giants.slice(0, 160)) {
    for (let k = 0; k < 3; k++) {
      const a = vr() * Math.PI * 2;
      const d = 2 + vr() * 5;
      const top = ground(g.x, g.z) + 16 + vr() * 6;
      vines.push({ matrix: compose(g.x + Math.cos(a) * d, top, g.z + Math.sin(a) * d, 0, new THREE.Vector3(1, 6 + vr() * 10, 1)), color: '#3a5a22' });
    }
  }
  group.add(instanced(vineGeo, m.foliage, vines, { castShadow: false, detail: 200 }));

  // Undergrowth: palms, ferns, big-leaved plants and flowers.
  const palmSpots = place.scatter(140, area, 2.5, 153, (x, z) => ground(x, z) > -0.5);
  group.add(palms(palmSpots.map((s) => ({ x: s.x, y: ground(s.x, s.z), z: s.z, height: 6 + s.rng() * 8, yaw: s.rng() * 6 })), ctx, zm.fronds, 154));
  const ferns = place.scatter(700, area, 1.2, 155, (x, z) => ground(x, z) > -0.8);
  group.add(instanced(fern(156), zm.fronds, ferns.map((s) => ({ matrix: compose(s.x, ground(s.x, s.z) - 0.1, s.z, s.rng() * 6, 1 + s.rng() * 1.6), color: s.rng() < 0.5 ? '#3f6a24' : '#4f7a2a' })), { castShadow: false, detail: 180 }));
  const bigLeaves = place.scatter(220, area, 1.6, 157, (x, z) => ground(x, z) > -0.5);
  group.add(instanced(fern(158, 6), zm.fronds, bigLeaves.map((s) => ({ matrix: compose(s.x, ground(s.x, s.z) - 0.1, s.z, s.rng() * 6, new THREE.Vector3(2.4, 2.8 + s.rng() * 1.4, 2.4)), color: '#4a8a2e' })), { castShadow: false, detail: 200 }));
  const flowers = place.scatter(260, area, 0.6, 159, (x, z) => ground(x, z) > -0.5);
  group.add(instanced(new THREE.SphereGeometry(0.18, 8, 6), zm.paint, flowers.map((s, i) => ({ matrix: compose(s.x, ground(s.x, s.z) + 0.5, s.z), color: ['#e83a5a', '#f2a03a', '#d84ad8', '#f2e04a'][i % 4] })), { castShadow: false, detail: 120 }));
  const riverRocks = place.scatter(90, area, 1.5, 160, (x, z) => ground(x, z) < 0.5, true);
  group.add(instanced(rockGeometry(161, 1, 0.5), zm.mossy, riverRocks.map((s) => ({ matrix: compose(s.x, ground(s.x, s.z), s.z, s.rng() * 6, 0.8 + s.rng() * 1.8), color: '#9aa088' }))));

  buildTemple(ctx, b);

  // A canoe on the lagoon and a ranger's tent by the shore.
  const L = JUNGLE.lagoon;
  const canoe = new THREE.Mesh(hull(5, 1.1, 0.5), zm.planks);
  canoe.position.set(L.x - 6, JUNGLE.riverLevel + 0.15, L.z + 4);
  canoe.rotation.y = 0.8;
  canoe.castShadow = true;
  group.add(canoe);
  const tx = L.x + L.r + 14;
  const tz = L.z + 2;
  const tent = new THREE.ConeGeometry(2.6, 2.6, 4, 1).rotateY(Math.PI / 4).translate(0, 1.3, 0).scale(1, 1, 1.5);
  b.add(tent, zm.paint, placement(tx, ground(tx, tz), tz, 0.4), '#5a7a3a');
  cylinderCollider(physics, tx, ground(tx, tz), tz, 2, 2.6);

  group.add(b.build('jungle'));

  // The waterfall: a sheet of falling water and a cloud of spray at its foot.
  const fall = waterfall();
  fall.mesh.position.set(JUNGLE.falls.x, (JUNGLE.plateau - 1.3 + JUNGLE.riverLevel) / 2, JUNGLE.falls.z);
  group.add(fall.mesh);
  const spray = new Puffs(18, '#f4f8fa', 0.4, { x: JUNGLE.falls.x + 2, y: JUNGLE.riverLevel, z: JUNGLE.falls.z, spread: 4, rise: 1.4, grow: 0.6, life: 5, size: 1.5, wind: [0.5, 0] }, 162);
  group.add(spray.mesh);

  // Parrots and butterflies.
  const parrots = new Herd(flyer({ size: 0.4, body: '#e8302a', wing: '#2a6ad8', beat: 3.5 }), 12, circleMover(-400, -20, 70, 24, 10, terrain), [], 350);
  const macaws = ['#e8302a', '#2a9ad8', '#f2c230', '#2fa84a'];
  for (let i = 0; i < 12; i++) {
    parrots.tint(i, 0, macaws[i % 4]);
    parrots.tint(i, 1, macaws[i % 4]);
  }
  const butterflies = new Herd(flyer({ size: 0.07, body: '#2a2a2a', wing: '#ffffff', beat: 6 }), 30, circleMover(-330, 40, 30, 1.6, 1.2, terrain, { wobble: 2 }), [], 120);
  for (let i = 0; i < 30; i++) for (const p of [3, 4, 5, 6]) butterflies.tint(i, p, ['#ff8a2a', '#3ac8ff', '#f2e04a', '#e84ad8'][i % 4]);
  group.add(parrots.group, butterflies.group);
  lights.add({ position: new THREE.Vector3(t.x, 2, t.z), color: '#5affd8', intensity: 14, range: 10 });

  return {
    id: 'jungle',
    group,
    update(view) {
      parrots.update(view.time, view.camera.position);
      butterflies.update(view.time, view.camera.position);
      spray.update(view.time);
      fall.update(view.time);
      canoe.position.y = JUNGLE.riverLevel + 0.15 + Math.sin(view.time * 0.9) * 0.05;
      canoe.rotation.z = Math.sin(view.time * 0.7) * 0.04;
    },
  };
}

/** The Lost Temple: a stepped pyramid with a hidden chamber, stone heads and ruins. */
function buildTemple(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm, lights } = ctx;
  const t = JUNGLE.temple;
  const tierH = t.height / t.tiers;
  const shrink = 2.2;
  // Ground tier: four thick walls around a chamber, with a passage in from the east.
  const s0 = t.base;
  const wall = 10;
  const pass = 2.6;
  const piece = (x: number, z: number, w: number, d: number, y0: number, h: number, color = MOSS) => {
    b.add(box(w, h, d, 3), zm.mossy, placement(x, y0 + h / 2, z), color);
    boxCollider(physics, IDENTITY, { x, y: y0 + h / 2, z }, { x: w, y: h, z: d });
  };
  piece(t.x, t.z - s0 / 2 + wall / 2, s0, wall, 0, tierH);
  piece(t.x, t.z + s0 / 2 - wall / 2, s0, wall, 0, tierH);
  piece(t.x - s0 / 2 + wall / 2, t.z, wall, s0 - 2 * wall, 0, tierH);
  const eastLen = (s0 - 2 * wall - pass) / 2;
  piece(t.x + s0 / 2 - wall / 2, t.z - pass / 2 - eastLen / 2, wall, eastLen, 0, tierH);
  piece(t.x + s0 / 2 - wall / 2, t.z + pass / 2 + eastLen / 2, wall, eastLen, 0, tierH);
  piece(t.x, t.z, s0 - 2 * wall, s0 - 2 * wall, tierH - 0.4, 0.4, '#6a7058');
  for (let k = 1; k < t.tiers; k++) {
    const s = s0 - 2 * shrink * k;
    piece(t.x, t.z, s, s, k * tierH, tierH, k % 2 ? STONE : MOSS);
  }
  // Stairs up the south face.
  const run = shrink * t.tiers;
  const steps = Math.ceil(t.height / 0.4);
  for (let k = 0; k < steps; k++) {
    const y = ((k + 1) / steps) * t.height;
    const z = t.z + s0 / 2 - (k + 0.5) * (run / steps);
    piece(t.x, z, 6, run / steps + 0.02, y - t.height / steps, t.height / steps, '#9a9a84');
  }
  // The shrine on top, with a carved face on each side.
  const top = t.height;
  piece(t.x, t.z, 7, 7, top, 5, STONE);
  b.add(new THREE.ConeGeometry(4, 6, 4).rotateY(Math.PI / 4).translate(0, top + 8, 0), zm.mossy, placement(t.x, 0, t.z), MOSS);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const fx = t.x + Math.sin(a) * 3.55;
    const fz = t.z + Math.cos(a) * 3.55;
    b.add(box(2.6, 0.5, 0.3), zm.mossy, placement(fx, top + 3.4, fz, a), '#5a6048');
    b.add(box(0.6, 0.3, 0.3), zm.mossy, placement(fx, top + 2.4, fz, a), '#5a6048');
  }
  // Inside the hidden chamber: a glowing idol on an altar.
  b.add(box(2, 1, 1.2, 1), zm.mossy, placement(t.x - 1, 0.5, t.z), STONE);
  b.add(new THREE.OctahedronGeometry(0.45, 0), zm.glow, placement(t.x - 1, 1.6, t.z), '#2affb0');
  lights.add({ position: new THREE.Vector3(t.x, 2, t.z), color: '#3affc0', intensity: 10, range: 9 });
  // Great stone heads and fallen columns around the courtyard.
  const rng = mulberry32(163);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    const x = t.x + Math.cos(a) * 28;
    const z = t.z + Math.sin(a) * 24;
    b.add(new THREE.SphereGeometry(2.4, 14, 12).scale(1, 1.3, 1), zm.mossy, placement(x, 2.6, z), STONE);
    b.add(box(3, 0.6, 0.6), zm.mossy, placement(x + Math.cos(a) * 2.2, 3.2, z + Math.sin(a) * 2.2, -a + Math.PI / 2), '#5a6048');
    cylinderCollider(physics, x, 0, z, 2.4, 5.5);
  }
  for (let i = 0; i < 8; i++) {
    const x = t.x - 30 + rng() * 60;
    const z = t.z + (rng() < 0.5 ? -26 : 27) + (rng() - 0.5) * 4;
    const up = rng() < 0.4;
    if (up) {
      b.add(new THREE.CylinderGeometry(0.9, 1, 6, 12).translate(0, 3, 0), zm.mossy, placement(x, 0, z), STONE);
      cylinderCollider(physics, x, 0, z, 1, 6);
    } else b.add(new THREE.CylinderGeometry(0.9, 0.9, 5, 12).rotateZ(Math.PI / 2), zm.mossy, placement(x, 0.8, z, rng() * 3), MOSS);
  }
}

/** A curtain of falling water, its texture streaming downward. */
function waterfall(): { mesh: THREE.Mesh; update(t: number): void } {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(164);
  ctx.fillStyle = 'rgba(200,230,240,0.6)';
  ctx.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + rng() * 0.6})`;
    ctx.fillRect(rng() * 64, rng() * 256, 1 + rng() * 2, 10 + rng() * 40);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  const height = JUNGLE.plateau - 1.3 - JUNGLE.riverLevel;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(10, height, 1, 1),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.85, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false }),
  );
  mesh.rotation.y = Math.PI / 2;
  return {
    mesh,
    update(t) {
      tex.offset.y = t * 1.2;
    },
  };
}
