import * as THREE from 'three';
import { SPACE } from '../../../../shared/zones/space.ts';
import { boxCollider } from '../town/colliders.ts';
import { box, IDENTITY, placement } from '../town/meshBuilder.ts';
import { game } from '../../game/link.ts';
import { jetpack } from '../../player/acts.ts';
import { circleMover, Herd, jellyfish } from './creatures.ts';
import { ChunkedBuilder, compose, cylinderCollider, instanced, mulberry32, Placement, rockGeometry, type ZoneContent, type ZoneContext } from './kit.ts';

const HULL = '#e8ecf0';
const ACCENT = '#d8602a';
/** One launch every this many seconds, at the same moment for everyone. */
const LAUNCH_EVERY = 240;

/** Outpost Nova: an alien world with a research base and a rocket that really flies. */
export function buildSpace(ctx: ZoneContext): ZoneContent {
  const { physics, zm, m, terrain, lights } = ctx;
  const group = new THREE.Group();
  group.name = 'zone-space';
  const b = new ChunkedBuilder();
  const place = new Placement('space');
  const ground = (x: number, z: number) => terrain.heightAt(x, z);
  const area = { minX: 205, maxX: 598, minZ: -598, maxZ: -205 };

  buildHabitat(ctx, b);
  buildDock(ctx, b);
  const dishes = buildArray(ctx, b);

  // Solar farm: rows of tilted panels.
  const s = SPACE.solar;
  const panels: { matrix: THREE.Matrix4 }[] = [];
  for (let r = -3; r <= 3; r++) {
    for (let c = -4; c <= 4; c++) {
      const x = s.x + c * 5;
      const z = s.z + r * 6;
      if (Math.hypot(x - s.x, z - s.z) > 27) continue;
      panels.push({ matrix: compose(x, 1.2, z, 0, 1, -0.5) });
      b.add(box(0.15, 1.2, 0.15), m.steel, placement(x, 0.6, z));
    }
  }
  const panelMat = new THREE.MeshStandardMaterial({ color: '#1a2a5a', roughness: 0.2, metalness: 0.6 });
  group.add(instanced(new THREE.BoxGeometry(4.2, 0.08, 2.4), panelMat, panels));

  // Crystals: glowing clusters, a few of them towering spires.
  const crystalColors = ['#3af0ff', '#d84aff', '#5aff9a'];
  const crystalMats = crystalColors.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.3, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true }),
  );
  const shard = new THREE.OctahedronGeometry(1, 0).scale(0.35, 1.6, 0.35).translate(0, 1.2, 0);
  const crystalItems: { matrix: THREE.Matrix4 }[][] = crystalColors.map(() => []);
  const clusters = place.scatter(70, area, 4, 101);
  clusters.forEach((c, k) => {
    const y = ground(c.x, c.z);
    const big = k < 7;
    const n = big ? 7 : 4 + Math.floor(c.rng() * 4);
    for (let i = 0; i < n; i++) {
      const s = (big ? 5 + c.rng() * 7 : 0.6 + c.rng() * 1.3) * (i === 0 ? 1.3 : 0.8);
      const tilt = i === 0 ? 0 : 0.3 + c.rng() * 0.5;
      crystalItems[k % 3].push({ matrix: compose(c.x + (c.rng() - 0.5) * s, y - 0.2, c.z + (c.rng() - 0.5) * s, c.rng() * 6, s, tilt, tilt * 0.5) });
    }
    if (big) {
      cylinderCollider(physics, c.x, y, c.z, 3, 12);
      lights.add({ position: new THREE.Vector3(c.x, y + 4, c.z), color: crystalColors[k % 3], intensity: 20, range: 22 });
    } else cylinderCollider(physics, c.x, y, c.z, 0.8, 2);
  });
  crystalMats.forEach((mat, k) => group.add(instanced(shard, mat, crystalItems[k], { castShadow: false })));

  // Alien plants: stalks with glowing bulbs.
  const stalk = new THREE.CylinderGeometry(0.05, 0.12, 1, 6).translate(0, 0.5, 0);
  const bulb = new THREE.SphereGeometry(0.3, 10, 8).translate(0, 1.05, 0);
  const plants = place.scatter(260, area, 1.2, 102);
  const plantItems = plants.map((p) => ({ matrix: compose(p.x, ground(p.x, p.z), p.z, p.rng() * 6, 1 + p.rng() * 2.5, (p.rng() - 0.5) * 0.4) }));
  group.add(instanced(stalk, zm.paint, plantItems.map((p) => ({ ...p, color: '#4a3a6a' })), { castShadow: false, detail: 220 }));
  group.add(instanced(bulb, new THREE.MeshBasicMaterial({ color: '#ffffff' }), plantItems.map((p, i) => ({ ...p, color: ['#ff6ad8', '#6affe8', '#ffd84a'][i % 3] })), { castShadow: false, detail: 220 }));

  // Moon rocks.
  const rocks = place.scatter(140, area, 2, 103);
  group.add(instanced(rockGeometry(104, 1, 0.55), zm.darkRock, rocks.map((r) => ({ matrix: compose(r.x, ground(r.x, r.z), r.z, r.rng() * 6, 0.6 + r.rng() * 2.4), color: '#8a7a90' }))));

  // Rovers parked by the habitat.
  for (let i = 0; i < 2; i++) {
    const x = SPACE.habitat.x - 30 + i * 6;
    const z = SPACE.habitat.z + 30;
    b.add(box(2.4, 1, 3.6, 1), zm.paint, placement(x, 1.1, z, 0.3), HULL);
    b.add(box(1.8, 0.8, 1.4), zm.glass, placement(x, 1.9, z + 0.5, 0.3));
    for (const wx of [-1.3, 1.3]) for (const wz of [-1.2, 0, 1.2]) b.add(new THREE.CylinderGeometry(0.45, 0.45, 0.35, 12).rotateZ(Math.PI / 2), m.darkMetal, placement(x, 0.45, z, 0.3).multiply(placement(wx, 0, wz)));
    boxCollider(physics, placement(x, 0, z, 0.3), { x: 0, y: 1, z: 0 }, { x: 2.8, y: 2, z: 3.8 });
  }

  const rocket = buildLaunchPad(ctx, b);
  group.add(b.build('space'), rocket.group, ...dishes);

  // The sky: a ringed giant planet and two moons, and an asteroid belt overhead.
  const sky = buildSky();
  group.add(sky.group);
  const belt = buildBelt();
  group.add(belt);

  // Floating glowing creatures drifting over the plains.
  const floaters = new Herd(jellyfish('#ffffff'), 8, circleMover(420, -380, 90, 26, 2.2, terrain), Array(8).fill(4), 500);
  for (let i = 0; i < 8; i++) for (let p = 0; p < 2; p++) floaters.tint(i, p, ['#7affff', '#ff8af0'][i % 2]);
  group.add(floaters.group);

  // The jetpack rack by the habitat's door.
  const rack = SPACE.jetpacks;
  b.add(box(3.2, 0.12, 0.5), m.steel, placement(rack.x, 2.1, rack.z));
  for (const x of [-1.5, 1.5]) b.add(box(0.12, 2.2, 0.12), m.steel, placement(rack.x + x, 1.1, rack.z));
  b.add(box(3.4, 0.08, 1.2), zm.glow, placement(rack.x, 0.04, rack.z + 0.4), '#ffb02a', { castShadow: false });
  for (let k = 0; k < 4; k++) {
    const pack = jetpack().object;
    pack.position.set(rack.x - 1.05 + k * 0.7, 1.65, rack.z + 0.25);
    pack.rotation.y = Math.PI;
    group.add(pack);
  }
  boxCollider(physics, IDENTITY, { x: rack.x, y: 1.1, z: rack.z }, { x: 3.4, y: 2.2, z: 0.5 });
  game.activities.add({
    position: new THREE.Vector3(rack.x, 0, rack.z + 1.2),
    reach: 2.4,
    prompt: () => {
      if (!game.player.onFoot) return null;
      return game.hasJetpack() ? { action: 'Give back the jetpack' } : { action: 'Borrow a jetpack', detail: 'hold Space to fly' };
    },
    use: () => {
      const on = !game.hasJetpack();
      game.wearJetpack(on);
      game.playOnce('pickup');
      if (on) game.notice('Jetpack on! Hold Space to fly. It refuels when you land.');
    },
  });

  return {
    id: 'space',
    group,
    update(view) {
      floaters.update(view.clock, view.camera.position);
      belt.rotation.y = view.time * 0.004;
      sky.update(view.camera.position, view.time);
      rocket.update(view.clock, view.dt);
      dishes.forEach((d, i) => (d.rotation.y = Math.sin(view.time * 0.05 + i) * 0.6));
    },
  };
}

/** The habitat: glass-topped domes joined by tubes, with a control room inside. */
function buildHabitat(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm, m, lights } = ctx;
  const domes = SPACE.domes;
  const [main] = domes;
  for (const [i, d] of domes.entries()) {
    // White lower walls, glass upper dome.
    b.add(new THREE.CylinderGeometry(d.r, d.r, 3, 32, 1, true).translate(0, 1.5, 0), zm.paint, placement(d.x, 0, d.z), HULL);
    b.add(new THREE.SphereGeometry(d.r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), i === 0 ? zm.glass : zm.paint, placement(d.x, 3, d.z), HULL, { castShadow: i !== 0 });
    for (let k = 0; k < 6; k++) b.add(new THREE.TorusGeometry(d.r, 0.15, 5, 24, Math.PI).rotateY((k / 6) * Math.PI), m.steel, placement(d.x, 3, d.z));
    b.add(new THREE.TorusGeometry(d.r, 0.3, 6, 40).rotateX(Math.PI / 2), zm.paint, placement(d.x, 3, d.z), ACCENT);
    if (i === 0) continue;
    cylinderCollider(physics, d.x, 0, d.z, d.r, 3 + d.r * 0.8);
    // A tube to the main dome.
    const dx = main.x - d.x;
    const dz = main.z - d.z;
    const len = Math.hypot(dx, dz) - main.r - d.r + 1;
    const mid = { x: d.x + (dx / Math.hypot(dx, dz)) * (d.r + len / 2), z: d.z + (dz / Math.hypot(dx, dz)) * (d.r + len / 2) };
    const yaw = Math.atan2(dx, dz);
    b.add(new THREE.CylinderGeometry(1.6, 1.6, len, 16).rotateX(Math.PI / 2), zm.paint, placement(mid.x, 1.8, mid.z, yaw), HULL);
    boxCollider(physics, placement(mid.x, 0, mid.z, yaw), { x: 0, y: 1.8, z: 0 }, { x: 3.2, y: 3.6, z: len });
  }
  // The main dome is open on its south side, so you can drive in.
  const entry = Math.PI / 2;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - entry), Math.cos(a - entry))) < 0.3) continue;
    boxCollider(physics, placement(main.x + Math.cos(a) * main.r, 0, main.z + Math.sin(a) * main.r, -a + Math.PI / 2), { x: 0, y: 4, z: 0 }, { x: 4.4, y: 8, z: 0.4 });
  }
  b.add(box(5, 4, 0.3), zm.paint, placement(main.x, 2, main.z + main.r + 0.05), '#1a1e24');
  // Inside: a ring of consoles with glowing screens, a hologram table, and hydroponics.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    if (Math.abs(Math.atan2(Math.sin(a - entry), Math.cos(a - entry))) < 0.5) continue;
    const x = main.x + Math.cos(a) * (main.r - 3);
    const z = main.z + Math.sin(a) * (main.r - 3);
    const yaw = Math.atan2(main.x - x, main.z - z);
    b.add(box(2.4, 1, 1, 1), zm.paint, placement(x, 0.5, z, yaw), '#3a4250');
    b.add(box(2.2, 1.2, 0.08), zm.glow, placement(x, 1.7, z, yaw, -0.2).multiply(placement(0, 0, -0.3)), ['#3af0ff', '#5aff9a', '#ffb84a'][k % 3]);
    boxCollider(physics, placement(x, 0, z, yaw), { x: 0, y: 0.6, z: 0 }, { x: 2.4, y: 1.2, z: 1 });
  }
  b.add(new THREE.CylinderGeometry(2, 2.2, 1, 24), zm.paint, placement(main.x, 0.5, main.z), '#3a4250');
  b.add(new THREE.SphereGeometry(1.1, 20, 14), zm.glow, placement(main.x, 2.6, main.z), '#3a9aff');
  cylinderCollider(physics, main.x, 0, main.z, 2.2, 1.2);
  for (let r = -1; r <= 1; r += 2) {
    b.add(box(1.2, 0.6, 8, 1), zm.paint, placement(main.x + r * 7, 0.3, main.z - 2), '#e8ecf0');
    for (let k = 0; k < 6; k++) b.add(new THREE.SphereGeometry(0.4, 8, 6), m.foliage, placement(main.x + r * 7, 0.85, main.z - 5 + k * 1.2), '#4a9a3a');
  }
  b.add(new THREE.CylinderGeometry(main.r - 0.3, main.r - 0.3, 0.05, 40), zm.paint, placement(main.x, 0.03, main.z), '#c8ccd2', { castShadow: false });
  lights.add({ position: new THREE.Vector3(main.x, 9, main.z), color: '#d8eaff', intensity: 40, range: 24 });
}

/** The starship on its landing pad. */
function buildDock(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm, m, lights } = ctx;
  const d = SPACE.dock;
  b.add(new THREE.CylinderGeometry(d.r, d.r, 0.4, 40), zm.metal, placement(d.x, 0.1, d.z), '#7a8088', { castShadow: false });
  b.add(new THREE.RingGeometry(d.r - 3, d.r - 2.2, 40).rotateX(-Math.PI / 2), zm.glow, placement(d.x, 0.32, d.z), '#ffb02a');
  // The ship: a long nose, swept wings, glowing engines, standing on landing legs.
  const S = placement(d.x, 3.2, d.z, -0.6);
  const part = (g: THREE.BufferGeometry, mat: THREE.Material, color?: string) => b.add(g, mat, S, color);
  part(new THREE.CapsuleGeometry(2.4, 18, 8, 18).rotateX(Math.PI / 2).scale(1, 0.6, 1), zm.paint, HULL);
  part(new THREE.ConeGeometry(2.3, 6, 18).rotateX(Math.PI / 2).scale(1, 0.6, 1).translate(0, 0, 13), zm.paint, HULL);
  part(new THREE.SphereGeometry(1.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 2.2).translate(0, 0.9, 7), zm.glass);
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 4, 12, -0.3, -6, 0, 0, -8, 0, 0, 4, 0, 0, -8, 12, -0.3, -6], 3));
  wing.computeVertexNormals();
  part(wing, zm.paint, '#c8ced6');
  part(wing.clone().scale(-1, 1, 1), zm.paint, '#c8ced6');
  part(box(0.3, 4, 5).translate(0, 2.5, -8), zm.paint, ACCENT);
  for (const x of [-1.2, 1.2]) {
    part(new THREE.CylinderGeometry(1, 1.2, 2, 16).rotateX(Math.PI / 2).translate(x, 0, -11), m.darkMetal);
    part(new THREE.CircleGeometry(0.9, 16).rotateY(Math.PI).translate(x, 0, -12.05), zm.glow, '#5ab8ff');
  }
  for (const [x, z] of [[-3, 6], [3, 6], [-3, -6], [3, -6]]) part(new THREE.CylinderGeometry(0.15, 0.2, 3.2, 6).translate(x, -1.6, z), m.steel);
  boxCollider(physics, S, { x: 0, y: 0, z: 0 }, { x: 5, y: 3, z: 26 });
  lights.add({ position: new THREE.Vector3(d.x, 2, d.z), color: '#ffb02a', intensity: 15, range: 20 });
}

/** The Deep Space Array: radio dishes that slowly track the sky. */
function buildArray(ctx: ZoneContext, b: ChunkedBuilder): THREE.Group[] {
  const { physics, zm, m } = ctx;
  const a = SPACE.array;
  const dishes: THREE.Group[] = [];
  for (let k = 0; k < 3; k++) {
    const x = a.x + (k - 1) * 20;
    const z = a.z + (k === 1 ? -8 : 6);
    b.add(new THREE.CylinderGeometry(1.2, 2, 8, 12).translate(0, 4, 0), zm.paint, placement(x, 0, z), HULL);
    cylinderCollider(physics, x, 0, z, 2, 8);
    const dish = new THREE.Group();
    dish.position.set(x, 9, z);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(9, 28, 10, 0, Math.PI * 2, 0, 0.75).scale(1, 0.55, 1).rotateX(Math.PI).rotateX(-0.9), zm.paint);
    bowl.material = new THREE.MeshStandardMaterial({ color: '#eef0f2', roughness: 0.4, side: THREE.DoubleSide });
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 6).rotateX(0.65).translate(0, 2.4, 3), m.steel);
    dish.add(bowl, feed);
    dish.traverse((o) => (o.castShadow = true));
    dishes.push(dish);
  }
  return dishes;
}

/** The launch tower and a rocket that lifts off every few minutes. */
function buildLaunchPad(ctx: ZoneContext, b: ChunkedBuilder): { group: THREE.Group; update(clock: number, dt: number): void } {
  const { physics, zm, m, lights } = ctx;
  const p = SPACE.launchPad;
  b.add(new THREE.CylinderGeometry(p.r, p.r + 1, 1.2, 40), zm.metal, placement(p.x, 0.1, p.z), '#8a8e94');
  b.add(box(10, 1.5, 6), m.darkMetal, placement(p.x, 1.4, p.z));
  // The lattice tower beside the rocket.
  const tx = p.x - 9;
  const H = 46;
  for (const [cx, cz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) b.add(box(0.35, H, 0.35), m.darkMetal, placement(tx + cx, H / 2, p.z + cz), '#c8402a');
  for (let y = 3; y < H; y += 3) {
    b.add(box(3.4, 0.2, 0.2), m.darkMetal, placement(tx, y, p.z - 1.5), '#c8402a');
    b.add(box(3.4, 0.2, 0.2), m.darkMetal, placement(tx, y, p.z + 1.5), '#c8402a');
    b.add(box(0.2, 0.2, 3.4), m.darkMetal, placement(tx - 1.5, y, p.z), '#c8402a');
    b.add(box(0.2, 0.2, 3.4), m.darkMetal, placement(tx + 1.5, y, p.z), '#c8402a');
  }
  for (const y of [18, 34]) b.add(box(6, 0.6, 1.4), m.darkMetal, placement(tx + 4, y, p.z), '#8a2a20');
  boxCollider(physics, IDENTITY, { x: tx, y: H / 2, z: p.z }, { x: 3.4, y: H, z: 3.4 });
  boxCollider(physics, IDENTITY, { x: p.x, y: 1, z: p.z }, { x: 10, y: 2, z: 6 });

  // The rocket.
  const group = new THREE.Group();
  const rocket = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.4 });
  const black = new THREE.MeshStandardMaterial({ color: '#202428', roughness: 0.5 });
  const add = (g: THREE.BufferGeometry, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    rocket.add(mesh);
  };
  add(new THREE.CylinderGeometry(2.2, 2.2, 30, 24).translate(0, 17, 0), white);
  add(new THREE.CylinderGeometry(2.21, 2.21, 3, 24).translate(0, 26, 0), black);
  add(new THREE.ConeGeometry(2.2, 7, 24).translate(0, 35.5, 0), white);
  for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.25, 5, 3).translate(0, 4.5, 2.6).rotateY((k / 4) * Math.PI * 2), black);
  add(new THREE.CylinderGeometry(1.4, 2, 2, 16).translate(0, 1, 0), new THREE.MeshStandardMaterial({ color: '#3a3e44', metalness: 0.8, roughness: 0.3 }));
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(1.8, 14, 16, 1, true).rotateX(Math.PI).translate(0, -7, 0),
    new THREE.MeshBasicMaterial({ color: '#ffb050', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  rocket.add(flame);
  rocket.position.set(p.x, 2.2, p.z);
  group.add(rocket);
  cylinderCollider(physics, p.x, 2.2, p.z, 2.4, 40);

  // Exhaust smoke: puffs that billow out from the pad during launch.
  const puffs: THREE.Mesh[] = [];
  const puffMat = new THREE.MeshStandardMaterial({ color: '#d8d4d0', roughness: 1, transparent: true, opacity: 0.7, depthWrite: false });
  for (let i = 0; i < 26; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), puffMat);
    puff.visible = false;
    group.add(puff);
    puffs.push(puff);
  }
  const light = { position: new THREE.Vector3(p.x, 4, p.z), color: '#ffb050', intensity: 0, range: 60, active: () => light.intensity > 0 };
  lights.add(light);
  const rng = mulberry32(105);
  const seeds = puffs.map(() => ({ a: rng() * Math.PI * 2, s: 0.6 + rng() * 0.8, d: rng() }));

  return {
    group,
    update(clock) {
      // Launch time within the cycle: a ten second countdown, then forty seconds of flight.
      const t = (clock % LAUNCH_EVERY) - 10;
      const flying = t > 0 && t < 45;
      const h = flying ? 1.4 * t * t : 0;
      rocket.position.y = 2.2 + h;
      rocket.visible = t < 45 || t > LAUNCH_EVERY - 30;
      const burning = t > -2 && t < 45;
      flame.visible = burning;
      flame.scale.set(1, 0.8 + Math.random() * 0.4 + Math.min(1.5, Math.max(0, t) * 0.1), 1);
      light.intensity = burning ? 120 : 0;
      light.position.set(p.x, rocket.position.y - 4, p.z);
      // Smoke spreads from the pad for the first seconds and lingers.
      puffs.forEach((puff, i) => {
        const age = t - seeds[i].d * 6;
        puff.visible = age > 0 && age < 30;
        if (!puff.visible) return;
        const r = Math.min(30, age * 4) * seeds[i].s;
        puff.position.set(p.x + Math.cos(seeds[i].a) * r, 2 + age * 0.4, p.z + Math.sin(seeds[i].a) * r);
        puff.scale.setScalar(2 + age * 0.5);
      });
      puffMat.opacity = Math.max(0, 0.7 - Math.max(0, t - 15) * 0.03);
    },
  };
}

/** A ringed gas giant and two moons, hung in the sky of the alien world. */
function buildSky(): { group: THREE.Group; update(camera: THREE.Vector3, time: number): void } {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(106);
  for (let y = 0; y < 256; y += 4) {
    const c = new THREE.Color().setHSL(0.06 + rng() * 0.06, 0.5 + rng() * 0.2, 0.45 + rng() * 0.25);
    ctx.fillStyle = `#${c.getHexString()}`;
    ctx.fillRect(0, y, 16, 4 + rng() * 6);
  }
  const bands = new THREE.CanvasTexture(canvas);
  bands.colorSpace = THREE.SRGBColorSpace;
  const planet = new THREE.Mesh(new THREE.SphereGeometry(160, 48, 32), new THREE.MeshBasicMaterial({ map: bands, fog: false }));
  const ringCanvas = document.createElement('canvas');
  ringCanvas.width = 256;
  ringCanvas.height = 4;
  const rctx = ringCanvas.getContext('2d')!;
  for (let x = 0; x < 256; x++) {
    const a = 0.25 + 0.6 * Math.abs(Math.sin(x * 0.11) * Math.sin(x * 0.037));
    rctx.fillStyle = `rgba(230,210,180,${x < 20 || x > 240 ? 0 : a})`;
    rctx.fillRect(x, 0, 1, 4);
  }
  const ringTex = new THREE.CanvasTexture(ringCanvas);
  const ringGeo = new THREE.RingGeometry(200, 340, 96, 1);
  // Map the ring texture radially.
  const pos = ringGeo.attributes.position;
  const uv = ringGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - 200) / 140, 0.5);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, side: THREE.DoubleSide, fog: false, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2 + 0.35;
  ring.rotation.y = 0.3;
  const giant = new THREE.Group();
  giant.add(planet, ring);
  giant.rotation.z = 0.2;
  const moons = ['#c8c0b8', '#a8b8d8'].map((c, i) => {
    const moon = new THREE.Mesh(new THREE.SphereGeometry(i ? 22 : 36, 24, 16), new THREE.MeshBasicMaterial({ color: c, fog: false }));
    group.add(moon);
    return moon;
  });
  group.add(giant);
  group.renderOrder = -2;
  const dir = new THREE.Vector3(0.55, 0.32, -0.77).normalize();
  return {
    group,
    update(camera, time) {
      // Fixed in the sky: always the same direction, as far away as the stars.
      giant.position.copy(camera).addScaledVector(dir, 1500);
      giant.rotation.y = time * 0.01;
      moons[0].position.copy(camera).add(new THREE.Vector3(-0.3, 0.55, -0.78).normalize().multiplyScalar(1400));
      moons[1].position.copy(camera).add(new THREE.Vector3(0.9, 0.2, -0.38).normalize().multiplyScalar(1400));
    },
  };
}

/** A belt of tumbling asteroids circling high over the outpost. */
function buildBelt(): THREE.Group {
  const rng = mulberry32(107);
  const shapes = [0, 1, 2].map((k) => rockGeometry(108 + k, 1, 0.6));
  const mat = new THREE.MeshStandardMaterial({ color: '#7a6e70', roughness: 0.95, flatShading: true });
  const group = new THREE.Group();
  group.position.set(SPACE.x, SPACE.belt.height, SPACE.z);
  for (const shape of shapes) {
    const items: { matrix: THREE.Matrix4 }[] = [];
    for (let i = 0; i < 90; i++) {
      const a = rng() * Math.PI * 2;
      const r = SPACE.belt.radius + (rng() - 0.5) * 60;
      const s = 1 + rng() ** 3 * 9;
      items.push({ matrix: compose(Math.cos(a) * r, (rng() - 0.5) * 24, Math.sin(a) * r, rng() * 6, s, rng() * 6, rng() * 6) });
    }
    const mesh = new THREE.InstancedMesh(shape, mat, items.length);
    items.forEach((it, i) => mesh.setMatrixAt(i, it.matrix));
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}
