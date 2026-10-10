import * as THREE from 'three';
import { SEA_LEVEL } from '../../../../shared/world.ts';
import { OCEAN } from '../../../../shared/zones/ocean.ts';
import { generateWorld } from '../../../../shared/world.ts';
import { boxCollider } from '../town/colliders.ts';
import { box, IDENTITY, placement } from '../town/meshBuilder.ts';
import { circleMover, flyer, Herd, jellyfish, type Mover, type Species, swimmer } from './creatures.ts';
import { ChunkedBuilder, compose, cylinderCollider, hull, instanced, mergeAll, mulberry32, palms, Placement, Puffs, rockGeometry, type ZoneContent, type ZoneContext } from './kit.ts';
import type { Mount } from '../../game/activities.ts';
import { worldSeconds } from '../../game/clock.ts';
import { game, onTrigger } from '../../game/link.ts';
import { AVATAR } from '../../player/character.ts';
import { ballistic, buttonActivity } from './buttons.ts';
import { lineActivities, loopCurve, TransitLine, type VehicleState } from './transit.ts';

const CORAL = ['#e8604a', '#f2a03a', '#d84a8a', '#9a5ad8', '#3ac8b0', '#f0e060', '#ff7a8a'];
const GLOW = ['#38f0ff', '#7a5cff', '#3aff9a', '#ff4ad8'];

/** Coral Bay: the harbor above, and the reefs, ruins and tunnel below the waves. */
export function buildOcean(ctx: ZoneContext): ZoneContent {
  const { physics, zm, m, terrain, lights } = ctx;
  const group = new THREE.Group();
  group.name = 'zone-ocean';
  const b = new ChunkedBuilder();
  const rng = mulberry32(91);
  const place = new Placement('ocean');
  const bed = (x: number, z: number) => terrain.heightAt(x, z);
  let night = 0;

  // --- The harbor -------------------------------------------------------------------
  const p = OCEAN.pier;
  const pierLen = p.z1 - p.z0;
  b.add(box(p.width, 0.3, pierLen, 1), zm.planks, placement(p.x, p.y, (p.z0 + p.z1) / 2), '#9a7852');
  boxCollider(physics, IDENTITY, { x: p.x, y: p.y, z: (p.z0 + p.z1) / 2 }, { x: p.width, y: 0.3, z: pierLen });
  for (let z = p.z0; z <= p.z1; z += 5) {
    for (const s of [-1, 1]) {
      const x = p.x + s * (p.width / 2 - 0.2);
      const ground = bed(x, z);
      b.add(new THREE.CylinderGeometry(0.2, 0.22, p.y - ground + 0.2, 8).translate(0, (p.y - ground + 0.2) / 2, 0), zm.planks, placement(x, ground, z), '#5a4630');
      // Bollards and rails.
      if (z % 10 === 6 || z === p.z0) b.add(new THREE.CylinderGeometry(0.18, 0.22, 0.6, 10), m.darkMetal, placement(x, p.y + 0.45, z));
    }
  }
  for (const s of [-1, 1]) {
    b.add(box(0.1, 0.1, pierLen), zm.planks, placement(p.x + s * (p.width / 2 - 0.1), p.y + 1.05, (p.z0 + p.z1) / 2), '#7a5a3a');
    boxCollider(physics, IDENTITY, { x: p.x + s * (p.width / 2 - 0.1), y: p.y + 0.7, z: (p.z0 + p.z1) / 2 }, { x: 0.15, y: 0.8, z: pierLen });
  }
  // Crates, nets and a lamp at the end of the pier.
  for (let i = 0; i < 5; i++) b.add(box(0.9, 0.9, 0.9, 1), zm.planks, placement(p.x - 1.2 + (i % 2) * 0.5, p.y + 0.6 + Math.floor(i / 3) * 0.9, p.z0 + 8 + i * 1.1, i * 0.4), '#8a6a44');
  b.add(new THREE.CylinderGeometry(0.08, 0.1, 4, 8).translate(0, 2, 0), m.darkMetal, placement(p.x, p.y, p.z1 - 1));
  b.add(new THREE.SphereGeometry(0.3, 10, 8), m.lampGlow, placement(p.x, p.y + 4.1, p.z1 - 1));
  lights.add({ position: new THREE.Vector3(p.x, p.y + 4, p.z1 - 1), color: '#ffd7a0', intensity: 14, range: 16, active: () => night > 0.3 });

  // Boats moored along the pier, and a galleon riding at anchor.
  const boats: { object: THREE.Object3D; y: number; phase: number }[] = [];
  const boatColors = ['#2e5a8a', '#b8452e', '#2f6b35', '#e8e2d0'];
  for (let i = 0; i < 4; i++) {
    const boat = fishingBoat(zm, m, boatColors[i]);
    const side = i % 2 ? 1 : -1;
    boat.position.set(p.x + side * (p.width / 2 + 2.4), SEA_LEVEL + 0.2, p.z0 + 22 + i * 13);
    boat.rotation.y = side > 0 ? 0.05 : Math.PI + 0.05;
    group.add(boat);
    boats.push({ object: boat, y: boat.position.y, phase: i * 1.3 });
  }
  const galleon = buildGalleon(zm);
  galleon.position.set(OCEAN.galleon.x, SEA_LEVEL + 0.6, OCEAN.galleon.z);
  galleon.rotation.y = OCEAN.galleon.yaw;
  group.add(galleon);
  boats.push({ object: galleon, y: galleon.position.y, phase: 0.4 });
  cylinderCollider(physics, OCEAN.galleon.x, -8, OCEAN.galleon.z, 5, 14);

  // Buoys marking the channel.
  const buoys: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const buoy = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.6, 12), new THREE.MeshStandardMaterial({ color: i % 2 ? '#c8302a' : '#2f8a3a', roughness: 0.5 }));
    buoy.position.set(380 + (i % 2) * 24, SEA_LEVEL + 0.4, 300 + Math.floor(i / 2) * 26);
    buoy.castShadow = true;
    group.add(buoy);
    buoys.push(buoy);
  }

  // The lighthouse on its rocky cape, with a beam that sweeps the sea at night.
  const lh = OCEAN.lighthouse;
  const towerH = 24;
  for (let k = 0; k < 6; k++) {
    const r0 = 3.6 - (k / 6) * 1.2;
    const r1 = 3.6 - ((k + 1) / 6) * 1.2;
    b.add(new THREE.CylinderGeometry(r1, r0, towerH / 6, 20).translate(0, (k + 0.5) * (towerH / 6), 0), zm.paint, placement(lh.x, lh.y, lh.z), k % 2 ? '#c8302a' : '#f2efe8');
  }
  cylinderCollider(physics, lh.x, lh.y, lh.z, 3.6, towerH);
  b.add(new THREE.CylinderGeometry(3.2, 3.2, 0.3, 20), m.darkMetal, placement(lh.x, lh.y + towerH + 0.15, lh.z));
  b.add(new THREE.TorusGeometry(3.1, 0.05, 4, 24).rotateX(Math.PI / 2), m.darkMetal, placement(lh.x, lh.y + towerH + 1.2, lh.z));
  b.add(new THREE.CylinderGeometry(1.8, 1.8, 2.6, 16, 1, true), zm.glass, placement(lh.x, lh.y + towerH + 1.6, lh.z));
  b.add(new THREE.SphereGeometry(0.8, 12, 8), m.lampGlow, placement(lh.x, lh.y + towerH + 1.5, lh.z));
  b.add(new THREE.ConeGeometry(2.2, 2, 16), m.darkMetal, placement(lh.x, lh.y + towerH + 3.9, lh.z));
  b.add(box(1.4, 2.4, 0.2), m.door, placement(lh.x, lh.y + 1.2, lh.z + 3.6), '#2e4a7a');
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(9, 90, 24, 1, true).translate(0, -45, 0).rotateZ(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#fff2c0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.set(lh.x, lh.y + towerH + 1.5, lh.z);
  group.add(beam);
  lights.add({ position: new THREE.Vector3(lh.x, lh.y + towerH + 1.5, lh.z), color: '#fff0c0', intensity: 40, range: 30, active: () => night > 0.3 });
  const capeRocks = rockGeometry(92, 1, 0.5);
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2;
    const r = 8 + rng() * 20;
    const x = lh.x + Math.cos(a) * r;
    const z = lh.z + Math.sin(a) * r;
    const s = 1.5 + rng() * 3;
    b.add(capeRocks, zm.rock, compose(x, bed(x, z) - s * 0.3, z, rng() * 6, s), '#8a8680');
  }

  // The beach: umbrellas, towels and palms.
  const umbrellaColors = ['#e8402a', '#2e8ad8', '#f2c230', '#2fa86a'];
  for (let i = 0; i < 10; i++) {
    const x = 245 + i * 17 + rng() * 6;
    const z = 266 + rng() * 10;
    if (Math.abs(x - p.x) < 8 || bed(x, z) < SEA_LEVEL + 0.2) continue;
    const y = bed(x, z);
    b.add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6).translate(0, 1.3, 0), m.steel, placement(x, y, z));
    b.add(new THREE.ConeGeometry(1.8, 0.7, 12, 1, true).translate(0, 2.6, 0), zm.paint, placement(x, y, z), umbrellaColors[i % 4]);
    b.add(box(0.9, 0.05, 1.9), m.fabric, placement(x + 1.4, y + 0.04, z + 0.4, 0.2), umbrellaColors[(i + 1) % 4], { castShadow: false });
  }
  const beachPalms = place.scatter(26, { minX: 215, maxX: 470, minZ: 252, maxZ: 280 }, 3, 93, (x, z) => bed(x, z) > SEA_LEVEL + 0.4);
  group.add(palms(beachPalms.map((s) => ({ x: s.x, y: bed(s.x, s.z), z: s.z, height: 7 + s.rng() * 4, yaw: s.rng() * 6 })), ctx, zm.fronds, 94));

  // --- Under the sea -----------------------------------------------------------------
  buildTunnel(ctx, b);
  buildDome(ctx, b);
  buildWreck(ctx, b);
  buildRuins(ctx, b);

  // Coral reefs.
  const corals = coralShapes();
  const coralMat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const coralItems: { matrix: THREE.Matrix4; color: string }[][] = corals.map(() => []);
  const glowItems: { matrix: THREE.Matrix4; color: string }[] = [];
  const addCoral = (x: number, z: number, s: number) => {
    const y = bed(x, z);
    if (y > SEA_LEVEL - 1.5 || !place.free(x, z, s, true)) return;
    const k = Math.floor(rng() * corals.length);
    coralItems[k].push({ matrix: compose(x, y - 0.1, z, rng() * 6, s), color: CORAL[Math.floor(rng() * CORAL.length)] });
    // Glowing polyps, brighter in the dark deep.
    if (rng() < 0.35) glowItems.push({ matrix: compose(x + (rng() - 0.5) * s, y + 0.2 * s, z + (rng() - 0.5) * s, 0, 0.12 + rng() * 0.12), color: GLOW[Math.floor(rng() * GLOW.length)] });
  };
  for (const reef of OCEAN.reefs) {
    for (let i = 0; i < 140; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * reef.r;
      addCoral(reef.x + Math.cos(a) * r, reef.z + Math.sin(a) * r, 0.6 + rng() * 1.4);
    }
  }
  for (let i = 0; i < 380; i++) addCoral(220 + rng() * 380, 290 + rng() * 310, 0.5 + rng() * 1.2);
  corals.forEach((g, k) => group.add(instanced(g, coralMat, coralItems[k], { castShadow: false, detail: 160 })));
  group.add(instanced(new THREE.SphereGeometry(1, 8, 6), glowMat, glowItems, { castShadow: false, detail: 160 }));
  const seaRocks = rockGeometry(95, 1, 0.5);
  const rocks: { matrix: THREE.Matrix4; color: string }[] = [];
  for (let i = 0; i < 120; i++) {
    const x = 230 + rng() * 380;
    const z = 290 + rng() * 310;
    const y = bed(x, z);
    if (y > SEA_LEVEL - 1 || !place.free(x, z, 3, true)) continue;
    place.claim(x, z, 2);
    rocks.push({ matrix: compose(x, y, z, rng() * 6, 0.8 + rng() * 2.6), color: '#6a7270' });
  }
  group.add(instanced(seaRocks, zm.rock, rocks));

  // The kelp forest, swaying.
  const kelp = kelpMaterial();
  const kelpItems: { matrix: THREE.Matrix4; color: string }[] = [];
  const k = OCEAN.kelp;
  for (let i = 0; i < 170; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * k.r;
    const x = k.x + Math.cos(a) * r;
    const z = k.z + Math.sin(a) * r;
    if (!place.free(x, z, 0.5, true)) continue;
    const y = bed(x, z);
    const h = Math.max(2, SEA_LEVEL - y - 0.5) * (0.6 + rng() * 0.4);
    kelpItems.push({ matrix: compose(x, y, z, rng() * 6, new THREE.Vector3(1, h, 1)), color: rng() < 0.5 ? '#5a7a2a' : '#6a6a28' });
  }
  group.add(instanced(kelpBlade(), kelp.material, kelpItems, { castShadow: false, detail: 200 }));


  // --- Sea life --------------------------------------------------------------------
  const schools = [
    { x: 360, z: 330, y: -5, r: 18 },
    { x: 300, z: 540, y: -9, r: 22 },
    { x: 525, z: 420, y: -9, r: 20 },
    { x: 440, z: 520, y: -12, r: 26 },
    { x: 330, z: 420, y: -6, r: 16 },
    { x: 560, z: 300, y: -7, r: 18 },
  ];
  const fishColors = ['#f2a03a', '#3a8ad8', '#f0e060', '#e8604a', '#c0c8d0', '#3ac8b0'];
  const fish = new Herd(swimmer('fish', '#ffffff'), 180, schoolMover(schools, 180), [], 180);
  for (let i = 0; i < 180; i++) for (let pp = 0; pp < 3; pp++) fish.tint(i, pp, fishColors[i % schools.length]);
  const sharks = new Herd(swimmer('shark', '#6a7880'), 2, circleMover(470, 470, 60, -10, 4, null, { absolute: true }), [], 260);
  const mantas = new Herd(swimmer('manta', '#3a4048'), 3, circleMover(420, 380, 45, -8, 3, null, { absolute: true }), [], 260);
  const turtles = new Herd(swimmer('turtle', '#5a6a3a'), 4, circleMover(340, 380, 30, -4, 1.4, null, { absolute: true }), [], 220);
  const whaleSwim = breaching(circleMover(540, 540, 80, -14, 3, null, { absolute: true }));
  const whale = new Herd(swimmer('whale', '#3e4c5a'), 1, whaleSwim, [], 400);
  const whaleSplash = new Puffs(16, '#f4f8fa', 0.6, { x: 0, y: SEA_LEVEL, z: 0, spread: 3, rise: 3, grow: 1.2, life: 2.2, size: 1.4, wind: [0, 0] }, 95);
  group.add(whaleSplash.mesh);
  let splashedAt = -Infinity;
  const jellies = new Herd(jellyfish('#ffffff'), 36, jellyMover(OCEAN.ruins.x + 60, OCEAN.ruins.z - 10, 70), [], 220);
  for (let i = 0; i < 36; i++) for (let pp = 0; pp < 2; pp++) jellies.tint(i, pp, GLOW[i % GLOW.length]);
  const gulls = new Herd(flyer({ size: 0.45, body: '#f2f2ee', wing: '#c8ccd0', beat: 2.2 }), 8, circleMover(330, 280, 45, 22, 8, terrain), [], 400);
  group.add(fish.group, sharks.group, mantas.group, turtles.group, whale.group, jellies.group, gulls.group);

  const crabs = buildBeachLife(ctx, b);
  group.add(crabs.group);
  const ferries = buildFerries(ctx);
  group.add(ferries.group);
  const cannon = buildCannon(ctx, b);
  group.add(cannon.group, b.build('ocean'));
  // The foghorn on the lighthouse.
  game.activities.add(buttonActivity('ocean/horn'));
  onTrigger('ocean/horn', () => game.sounds?.horn(new THREE.Vector3(lh.x, lh.y + towerH, lh.z)));

  return {
    id: 'ocean',
    group,
    update(view) {
      night = view.night;
      const t = view.clock;
      const cam = view.camera.position;
      for (const herd of [fish, sharks, mantas, turtles, whale, jellies, gulls]) herd.update(t, cam);
      ferries.update(t, cam);
      crabs.update(t, cam);
      cannon.update(view.dt);
      // The whale breaks the surface now and then, with a great splash.
      const breach = t % BREACH_EVERY;
      if (breach > 2.2 && breach < 2.6 && t - splashedAt > 5) {
        splashedAt = t;
        const at = new THREE.Vector3();
        whaleSwim.last(at);
        whaleSplash.mesh.position.set(at.x, 0, at.z);
        if (cam.distanceTo(at) < 300) game.sounds?.splash(at, 3);
      }
      whaleSplash.mesh.visible = t - splashedAt < 4;
      if (whaleSplash.mesh.visible) whaleSplash.update(t - splashedAt + 0.01);
      for (const boat of boats) {
        boat.object.position.y = boat.y + Math.sin(t * 0.9 + boat.phase) * 0.12;
        boat.object.rotation.z = Math.sin(t * 0.7 + boat.phase) * 0.03;
        boat.object.rotation.x = Math.sin(t * 0.5 + boat.phase * 2) * 0.015;
      }
      buoys.forEach((buoy, i) => {
        buoy.position.y = SEA_LEVEL + 0.4 + Math.sin(t * 1.4 + i) * 0.15;
        buoy.rotation.z = Math.sin(t * 1.1 + i) * 0.1;
      });
      beam.rotation.y = t * 0.8;
      (beam.material as THREE.MeshBasicMaterial).opacity = 0.16 * Math.max(0, (night - 0.3) / 0.7);
      beam.visible = night > 0.3;
      kelp.time.value = t;
    },
  };
}

/** The beach: a lifeguard tower, sandcastles, surfboards, starfish and scuttling crabs. */
function buildBeachLife(ctx: ZoneContext, b: ChunkedBuilder): Herd {
  const { physics, zm, m, terrain } = ctx;
  const ground = (x: number, z: number) => terrain.heightAt(x, z);
  // The lifeguard's tower, looking out to sea.
  const lx = 286;
  const lz = 259.5;
  const ly = ground(lx, lz);
  for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) b.add(box(0.12, 2.4, 0.12), zm.planks, placement(lx + x, ly + 1.2, lz + z), '#e8e2d0');
  b.add(box(2.2, 0.12, 2.2), zm.planks, placement(lx, ly + 2.4, lz), '#e8e2d0');
  b.add(box(2, 1.4, 2, 1), zm.paint, placement(lx, ly + 3.2, lz), '#c8302a');
  b.add(box(2.4, 0.1, 2.4), zm.paint, placement(lx, ly + 3.95, lz), '#f4f0e8');
  b.add(box(1.4, 0.6, 0.05), zm.glass, placement(lx, ly + 3.3, lz + 1.02));
  b.add(box(0.8, 0.08, 1.6), zm.planks, placement(lx, ly + 1.2, lz - 1.8, 0, -0.9), '#e8e2d0');
  cylinderCollider(physics, lx, ly, lz, 1.3, 4);
  // Sandcastles with flags, and surfboards stuck in the sand.
  for (const [x, z] of [[262, 261], [372, 262], [436, 261]] as const) {
    const y = ground(x, z);
    b.add(new THREE.CylinderGeometry(0.7, 0.85, 0.5, 12).translate(0, 0.25, 0), zm.sand, placement(x, y, z), '#e8d0a0');
    for (const [dx, dz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) b.add(new THREE.CylinderGeometry(0.2, 0.24, 0.8, 8).translate(0, 0.4, 0), zm.sand, placement(x + dx, y, z + dz), '#e8d0a0');
    b.add(new THREE.ConeGeometry(0.35, 0.6, 8).translate(0, 0.8, 0), zm.sand, placement(x, y + 0.3, z), '#e8d0a0');
    b.add(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4).translate(0, 1.3, 0), m.darkMetal, placement(x, y + 0.3, z));
    b.add(box(0.25, 0.15, 0.01), zm.paint, placement(x + 0.13, y + 1.85, z), '#c8302a');
  }
  const boards = ['#2e8ad8', '#f2c230', '#e8402a', '#2fa86a', '#f07ad8'];
  boards.forEach((color, i) => {
    const x = 318 + i * 1.1;
    const z = 258;
    b.add(new THREE.CapsuleGeometry(0.28, 1.8, 4, 10).scale(1, 1, 0.12), zm.paint, placement(x, ground(x, z) + 1.0, z, 0.2, 0.15 - i * 0.05), color);
  });
  // Starfish on the wet sand.
  const rng = mulberry32(97);
  const star = new THREE.CylinderGeometry(0.18, 0.18, 0.04, 5);
  for (let i = 0; i < 16; i++) {
    const x = 230 + rng() * 220;
    const z = 263 + rng() * 3;
    const y = ground(x, z);
    if (y < SEA_LEVEL - 0.2) continue;
    b.add(star, zm.paint, placement(x, y + 0.02, z, rng() * 6), ['#f07a3a', '#e8402a', '#c86ad8'][i % 3], { castShadow: false });
  }
  // Crabs scuttling sideways along the water's edge.
  const crab: Species = {
    parts: [
      { parent: -1, offset: [0, 0.12, 0], geometry: new THREE.SphereGeometry(0.16, 10, 6).scale(1.3, 0.55, 1), color: '#d84a2a' },
      { parent: 0, offset: [0.18, 0, 0.14], geometry: new THREE.SphereGeometry(0.06, 8, 6).scale(1.4, 0.8, 1), color: '#d84a2a' },
      { parent: 0, offset: [-0.18, 0, 0.14], geometry: new THREE.SphereGeometry(0.06, 8, 6).scale(1.4, 0.8, 1), color: '#d84a2a' },
    ],
    stride: 0.3,
    pose(phase, t, i, out) {
      out[0] = [0, 0, Math.sin(phase * Math.PI * 4) * 0.12];
      out[1] = [0, Math.sin(t * 3 + i) * 0.3, 0];
      out[2] = [0, -Math.sin(t * 3 + i) * 0.3, 0];
    },
  };
  const crabs = new Herd(crab, 10, (i, t, out) => {
    const base = 236 + i * 21;
    out.x = base + Math.sin(t * 0.25 + i) * 6;
    out.z = 265 + Math.sin(i * 1.7) * 1.2;
    out.y = Math.max(ground(out.x, out.z), SEA_LEVEL);
    // Crabs walk sideways: face across their path.
    out.yaw = Math.cos(t * 0.25 + i) > 0 ? 0 : Math.PI;
    out.pitch = 0;
    out.roll = 0;
    return true;
  }, [], 120);
  crabs.hittable('crab', { radius: 0.25, height: 0.25, mass: 2 }, physics, terrain);
  return crabs;
}

/** How often the whale leaps out of the sea (seconds on the shared clock). */
const BREACH_EVERY = 75;

/** Wraps a whale's swimming so every so often it surges up and leaps clear of the water. */
function breaching(swim: Mover): Mover & { last(out: THREE.Vector3): void } {
  const last = new THREE.Vector3();
  const mover = ((i, t, out) => {
    swim(i, t, out);
    const phase = t % BREACH_EVERY;
    if (phase < 6) {
      // Up from the deep, out into the air nose first, and back down.
      const k = phase / 6;
      const rise = Math.sin(k * Math.PI);
      out.y = -14 + rise * 22;
      out.pitch = -Math.cos(k * Math.PI) * 0.9;
    }
    last.set(out.x, out.y, out.z);
    return true;
  }) as Mover & { last(out: THREE.Vector3): void };
  mover.last = (out) => out.copy(last);
  return mover;
}

/** The glass-bottom boats: round the bay from the end of the pier, past the reef and the lighthouse. */
function buildFerries(ctx: ZoneContext): { group: THREE.Group; update(t: number, camera: THREE.Vector3): void } {
  const { zm, m } = ctx;
  const p = OCEAN.pier;
  const y = SEA_LEVEL + 0.2;
  const curve = loopCurve(OCEAN.ferry.map(([x, z]) => new THREE.Vector3(x, y, z)));
  const dock = new THREE.Vector3(p.x, p.y + 0.15, p.z1 - 0.6);
  const line = new TransitLine(curve, [{ name: 'The Pier', at: 0, dwell: 14, board: dock, exit: dock }], 7, 2);
  const group = new THREE.Group();
  const boats: THREE.Group[] = [];
  for (let v = 0; v < line.vehicles; v++) {
    const boat = new THREE.Group();
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, x = 0, yy = 0, z = 0) => {
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(x, yy, z);
      mesh.castShadow = true;
      boat.add(mesh);
      return mesh;
    };
    add(hull(13, 4.6, 1.5), new THREE.MeshStandardMaterial({ color: v ? '#2e7ab8' : '#e8b030', roughness: 0.5 }));
    add(box(4, 0.1, 11), zm.planks, 0, -0.05, 0);
    // The glass floor: you can see the fish below.
    const glass = add(box(1.6, 0.06, 6), zm.glass, 0, 0, 0);
    glass.castShadow = false;
    for (const [x, z] of [[-1.8, -4], [1.8, -4], [-1.8, 4], [1.8, 4]]) add(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6).translate(0, 1.2, 0), m.steel, x, 0, z);
    add(box(4.2, 0.12, 9.4), new THREE.MeshStandardMaterial({ color: '#f4f0e8', roughness: 0.7 }), 0, 2.45, 0);
    for (const x of [-1.5, 1.5]) add(box(0.5, 0.42, 9), zm.planks, x, 0.2, 0);
    add(box(1, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: '#f4f0e8', roughness: 0.7 }), 0, 0.6, 5);
    group.add(boat);
    boats.push(boat);
  }
  const seats: THREE.Vector3[] = [];
  const facing: number[] = [];
  for (const x of [-1.5, 1.5]) {
    for (const z of [-3.6, -1.8, 0, 1.8, 3.6]) {
      seats.push(new THREE.Vector3(x, 0.5, z));
      facing.push(x < 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }
  const bob = (t: number, v: number) => Math.sin(t * 0.9 + v * 2) * 0.12;
  const matrix = (s: VehicleState, t: number, v: number) =>
    new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.sin(t * 0.5 + v) * 0.015, s.yaw, Math.sin(t * 0.7 + v) * 0.03, 'YXZ')).setPosition(s.position.x, s.position.y + bob(t, v), s.position.z);
  game.activities.add(
    ...lineActivities(
      line,
      {
        name: 'glass-bottom boat',
        verb: 'Board the glass-bottom boat',
        seats,
        facing,
        pose: 'sit',
        reach: 4,
        // Jump overboard whenever you like: into the sea beside the boat.
        hopOff: (s) => new THREE.Vector3(s.position.x + Math.cos(s.yaw) * 3.4, SEA_LEVEL - 0.6, s.position.z - Math.sin(s.yaw) * 3.4),
        sound: (at) => game.sounds?.ding(at),
      },
      (s) => matrix(s, worldSeconds(), s.vehicle),
    ),
  );
  const state = { position: new THREE.Vector3(), yaw: 0, pitch: 0, stopped: null, next: line.stops[0], wait: 0, vehicle: 0 } as VehicleState;
  return {
    group,
    update(t, camera) {
      boats.forEach((boat, v) => {
        line.state(t, v, 0, state);
        boat.visible = state.position.distanceTo(camera) < 400;
        boat.matrixAutoUpdate = false;
        boat.matrix.copy(matrix(state, t, v));
        boat.matrixWorldNeedsUpdate = true;
      });
    },
  };
}

/** A harbor cannon on the cape: climb into the barrel and it fires you out over the reef. */
function buildCannon(ctx: ZoneContext, b: ChunkedBuilder): { group: THREE.Group; update(dt: number): void } {
  const { physics, zm, m } = ctx;
  const C = OCEAN.cannon;
  const y = OCEAN.lighthouse.y;
  const yaw = Math.atan2(C.target.x - C.x, C.target.z - C.z);
  const lift = 0.45;
  const M = placement(C.x, y, C.z, yaw);
  // The carriage and its wheels.
  for (const side of [-1, 1]) {
    b.add(box(0.25, 0.9, 2.2, 1), zm.planks, M.clone().multiply(placement(side * 0.55, 0.65, 0)), '#5a3a22');
    for (const wz of [-0.7, 0.8]) b.add(new THREE.CylinderGeometry(0.45, 0.45, 0.16, 14).rotateZ(Math.PI / 2), zm.planks, M.clone().multiply(placement(side * 0.78, 0.45, wz)), '#3a2614');
  }
  boxCollider(physics, M, { x: 0, y: 0.6, z: 0 }, { x: 1.6, y: 1.2, z: 2.4 });
  for (let i = 0; i < 6; i++) b.add(new THREE.SphereGeometry(0.2, 10, 8), m.darkMetal, M.clone().multiply(placement(-1.3 + (i % 3) * 0.42, 0.2 + Math.floor(i / 3) * 0.32, -1.6)));
  const group = new THREE.Group();
  group.position.set(C.x, y + 1.25, C.z);
  group.rotation.set(-lift, yaw, 0, 'YXZ');
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.48, 3.4, 18, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.9), new THREE.MeshStandardMaterial({ color: '#2a2a2e', metalness: 0.8, roughness: 0.45, side: THREE.DoubleSide }));
  const breech = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), barrel.material);
  breech.position.z = -0.8;
  barrel.castShadow = breech.castShadow = true;
  group.add(barrel, breech);
  const smoke = new Puffs(14, '#d8d8d4', 0.7, { x: 0, y: 0, z: 0, spread: 1, rise: 1.2, grow: 1.6, life: 2.5, size: 0.8, wind: [0.4, 0.2] }, 96);
  smoke.mesh.visible = false;
  const muzzle = new THREE.Vector3();
  const muzzlePoint = () => {
    group.updateMatrixWorld(true);
    return muzzle.set(0, 0, 2.6).applyMatrix4(group.matrixWorld);
  };
  let since = Infinity;
  let fuse = -1;
  const target = new THREE.Vector3(C.target.x, SEA_LEVEL, C.target.z);
  const boom = () => {
    since = 0;
    const at = muzzlePoint();
    smoke.mesh.position.copy(at);
    smoke.mesh.visible = true;
    game.sounds?.cannon(at);
  };
  game.activities.add(
    buttonActivity('ocean/cannon', () => {
      if (fuse >= 0) return false;
      fuse = 0;
      const rider: Mount = {
        position: new THREE.Vector3(),
        yaw,
        pose: 'sit',
        label: 'cannon',
        ride: true,
        update: () => rider.position.copy(muzzlePoint()).y -= 0.5,
        blocked: () => 'Three… two… one…',
        done: () => fuse > 1.2,
        exit: () => muzzlePoint().clone(),
        release: () => ballistic(muzzlePoint(), target, 0.5, AVATAR.gravity),
      };
      game.ride(rider);
      return true;
    }),
  );
  onTrigger('ocean/cannon', (_by, mine) => {
    if (!mine) boom();
  });
  return {
    group,
    update(dt) {
      if (fuse >= 0) {
        fuse += dt;
        if (fuse > 1.2 && since > 1) boom();
        if (fuse > 4) fuse = -1;
      }
      since += dt;
      smoke.mesh.visible = since < 2.5;
      if (smoke.mesh.visible) smoke.update(since + 0.01);
    },
  };
}

/** Fish in schools: each school circles its spot; fish keep their place in it. */
function schoolMover(schools: { x: number; z: number; y: number; r: number }[], count: number): Mover {
  const offsets = Array.from({ length: count }, (_, i) => {
    const rng = mulberry32(i + 7);
    return new THREE.Vector3((rng() - 0.5) * 6, (rng() - 0.5) * 3, (rng() - 0.5) * 6);
  });
  return (i, t, out) => {
    const s = schools[i % schools.length];
    const a = t * 0.12 * (i % 2 ? 1 : 1) + (i % schools.length);
    const o = offsets[i];
    out.x = s.x + Math.cos(a) * s.r + o.x + Math.sin(t * 0.8 + i) * 0.4;
    out.z = s.z + Math.sin(a) * s.r + o.z;
    out.y = s.y + o.y + Math.sin(t * 0.6 + i) * 0.3;
    out.yaw = Math.atan2(-Math.sin(a), Math.cos(a));
    out.pitch = 0;
    out.roll = 0;
    return true;
  };
}

/** Jellyfish drifting slowly up and down. */
function jellyMover(x: number, z: number, r: number): Mover {
  return (i, t, out) => {
    const rng = mulberry32(i * 13 + 1);
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * r;
    out.x = x + Math.cos(a) * d + Math.sin(t * 0.05 + i) * 6;
    out.z = z + Math.sin(a) * d + Math.cos(t * 0.04 + i) * 6;
    out.y = -6 - rng() * 10 + Math.sin(t * 0.3 + i) * 1.5;
    out.yaw = 0;
    out.pitch = 0;
    out.roll = 0;
    return true;
  };
}

/** A small fishing boat: hull, wheelhouse and mast. */
function fishingBoat(zm: ZoneContext['zm'], m: ZoneContext['m'], color: string): THREE.Group {
  const g = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(hull(8, 2.8, 1.4), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  add(box(2.6, 0.1, 7.2), zm.planks, 0, -0.1, -0.2);
  add(box(1.6, 1.5, 1.8), new THREE.MeshStandardMaterial({ color: '#f2efe8', roughness: 0.6 }), 0, 0.75, -1.2);
  add(new THREE.CylinderGeometry(0.06, 0.08, 5, 6), m.darkMetal, 0, 2.5, 1.2);
  return g;
}

/** A three-masted sailing ship. */
function buildGalleon(zm: ZoneContext['zm']): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.8 });
  const sail = new THREE.MeshStandardMaterial({ color: '#efe6d0', roughness: 0.9, side: THREE.DoubleSide });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, rx = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(hull(34, 9, 6), wood);
  add(box(8.4, 0.2, 31), zm.planks, 0, 0.1, -0.5);
  add(box(8, 3.2, 7), wood, 0, 1.6, -12.5);
  add(box(7, 1.6, 5), wood, 0, 0.8, 11);
  add(new THREE.CylinderGeometry(0.2, 0.2, 9, 6).rotateX(Math.PI / 2 - 0.3), wood, 0, 2.5, 19);
  for (const [z, h] of [
    [8, 20],
    [-1, 24],
    [-9, 18],
  ]) {
    add(new THREE.CylinderGeometry(0.28, 0.38, h, 8).translate(0, h / 2, 0), wood, 0, 0, z);
    for (let k = 0; k < 2; k++) {
      const y = h * (0.35 + k * 0.35);
      const w = 12 - k * 3;
      add(new THREE.CylinderGeometry(0.12, 0.12, w, 6).rotateZ(Math.PI / 2), wood, 0, y + 3, z);
      // Billowing sail: a curved panel.
      const panel = new THREE.PlaneGeometry(w - 1, 5.5, 8, 4);
      const pos = panel.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.cos((pos.getX(i) / (w - 1)) * Math.PI) * 1.2);
      panel.computeVertexNormals();
      add(panel, sail, 0, y, z + 0.5);
    }
  }
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshStandardMaterial({ color: '#1d3c8a', side: THREE.DoubleSide }));
  flag.position.set(1.3, 24.5, -1);
  flag.rotation.y = Math.PI / 2;
  g.add(flag);
  return g;
}

/** The glass tunnel along the road under the sea. */
function buildTunnel(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm, m, lights } = ctx;
  const road = generateWorld().roads.find((r) => r.name === 'Abyss Tunnel')!;
  const r = 6;
  const shell = new THREE.CylinderGeometry(r, r, 1, 18, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
  const rib = new THREE.TorusGeometry(r + 0.05, 0.14, 6, 18, Math.PI);
  for (let i = 0; i < road.path.length - 1; i++) {
    const a = road.path[i];
    const c = road.path[i + 1];
    if (Math.max(a.y, c.y) > SEA_LEVEL + 0.4) continue;
    const len = Math.hypot(c.x - a.x, c.z - a.z, c.y - a.y);
    const yaw = Math.atan2(c.x - a.x, c.z - a.z);
    const pitch = -Math.atan2(c.y - a.y, Math.hypot(c.x - a.x, c.z - a.z));
    const M = placement((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2, yaw, pitch);
    b.add(shell.clone().scale(1, 1, len + 0.05), zm.glass, M, undefined, { castShadow: false });
    if (i % 3 === 0) {
      b.add(rib, m.steel, M);
      // A strip light along the top.
      b.add(box(0.3, 0.1, 1.2), m.lampGlow, M.clone().multiply(placement(0, r - 0.25, 0)));
    }
    for (const side of [-1, 1]) boxCollider(physics, M, { x: side * (r - 0.1), y: r / 2, z: 0 }, { x: 0.3, y: r, z: len });
    boxCollider(physics, M, { x: 0, y: r, z: 0 }, { x: 2 * r, y: 0.3, z: len });
    if (i % 8 === 0) lights.add({ position: new THREE.Vector3((a.x + c.x) / 2, (a.y + c.y) / 2 + r - 1, (a.z + c.z) / 2), color: '#bfefff', intensity: 14, range: 14 });
  }
}

/** Atlantis Station: a glass dome on the sea floor with a garden plaza inside. */
function buildDome(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm, m, lights } = ctx;
  const d = OCEAN.dome;
  b.add(new THREE.SphereGeometry(d.r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), zm.glass, placement(d.x, d.y, d.z), undefined, { castShadow: false });
  for (let k = 0; k < 8; k++) b.add(new THREE.TorusGeometry(d.r, 0.25, 6, 24, Math.PI).rotateY((k / 8) * Math.PI), m.steel, placement(d.x, d.y, d.z));
  b.add(new THREE.TorusGeometry(d.r, 0.6, 8, 48).rotateX(Math.PI / 2), m.steel, placement(d.x, d.y + 0.3, d.z));
  // Walls you can't drive through, except where the tunnel comes in.
  const entry = Math.atan2(-0.45, -0.82);
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - entry), Math.cos(a - entry))) < 0.28) continue;
    boxCollider(physics, placement(d.x + Math.cos(a) * d.r, d.y, d.z + Math.sin(a) * d.r, -a + Math.PI / 2), { x: 0, y: 6, z: 0 }, { x: 6.4, y: 12, z: 0.5 });
  }
  // The plaza: paving, a fountain with a statue, planters and benches.
  b.add(new THREE.CircleGeometry(d.r - 0.5, 40).rotateX(-Math.PI / 2), zm.roads.sandstone, placement(d.x, d.y + 0.04, d.z), undefined, { castShadow: false });
  b.add(new THREE.CylinderGeometry(4, 4.2, 0.8, 24), zm.marble, placement(d.x, d.y + 0.4, d.z), '#e8f0f2');
  b.add(new THREE.CircleGeometry(3.7, 24).rotateX(-Math.PI / 2), zm.water, placement(d.x, d.y + 0.75, d.z));
  b.add(new THREE.CylinderGeometry(0.5, 0.7, 3, 12), zm.marble, placement(d.x, d.y + 2, d.z), '#e8f0f2');
  b.add(new THREE.TorusKnotGeometry(0.9, 0.25, 64, 8), m.brass, placement(d.x, d.y + 4.4, d.z));
  cylinderCollider(physics, d.x, d.y, d.z, 4.2, 4);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    const x = d.x + Math.cos(a) * 14;
    const z = d.z + Math.sin(a) * 14;
    b.add(new THREE.CylinderGeometry(1.4, 1.2, 0.9, 16), zm.marble, placement(x, d.y + 0.45, z), '#dfe8ea');
    b.add(new THREE.SphereGeometry(1.2, 10, 8).scale(1, 0.7, 1), m.hedge, placement(x, d.y + 1.3, z), '#3a8a4a');
    cylinderCollider(physics, x, d.y, z, 1.4, 1.6);
  }
  lights.add({ position: new THREE.Vector3(d.x, d.y + 10, d.z), color: '#d8f4ff', intensity: 60, range: 34 });
}

/** A sunken sailing ship lying on its side, and its treasure. */
function buildWreck(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { zm, m, terrain, lights, physics } = ctx;
  const w = OCEAN.wreck;
  const y = terrain.heightAt(w.x, w.z);
  const M = placement(w.x, y + 2.2, w.z, w.yaw, 0.08, 0.45);
  b.add(hull(28, 8, 5), zm.planks, M, '#4a3a2a');
  b.add(box(7.4, 0.2, 18), zm.planks, M.clone().multiply(placement(0, 0, -3)), '#3a2e22');
  b.add(new THREE.CylinderGeometry(0.3, 0.35, 16, 8).rotateZ(Math.PI / 2 - 0.2), zm.planks, placement(w.x + 8, y + 1, w.z + 4, w.yaw), '#3a2e22');
  cylinderCollider(physics, w.x, y, w.z, 4, 5);
  const chest = { x: w.x - 6, z: w.z + 5 };
  const cy = terrain.heightAt(chest.x, chest.z);
  b.add(box(1.4, 0.8, 0.9, 1), zm.planks, placement(chest.x, cy + 0.4, chest.z, 0.5), '#6a4422');
  b.add(box(1.42, 0.12, 0.92), m.brass, placement(chest.x, cy + 0.8, chest.z, 0.5));
  for (let i = 0; i < 12; i++) b.add(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 10), m.brass, placement(chest.x + Math.cos(i) * (1 + i * 0.1), cy + 0.05, chest.z + Math.sin(i * 1.3) * 1.2));
  lights.add({ position: new THREE.Vector3(chest.x, cy + 1.5, chest.z), color: '#ffd760', intensity: 8, range: 8 });
}

/** The Sunken City: broken columns, arches, a temple and glowing runes on the sea floor. */
function buildRuins(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { zm, terrain, physics } = ctx;
  const r = OCEAN.ruins;
  const rng = mulberry32(96);
  const algae = '#a8c4b4';
  const ground = (x: number, z: number) => terrain.heightAt(x, z);
  // A temple platform with columns, half of them fallen.
  const ty = ground(r.x, r.z);
  b.add(box(26, 2, 18, 3), zm.marble, placement(r.x, ty + 0.6, r.z), algae);
  boxCollider(physics, IDENTITY, { x: r.x, y: ty + 0.6, z: r.z }, { x: 26, y: 2, z: 18 });
  for (let i = 0; i < 6; i++) {
    for (const zz of [-7, 7]) {
      const x = r.x - 10 + i * 4;
      const z = r.z + zz;
      const fallen = rng() < 0.4;
      const h = fallen ? 2 + rng() * 2 : 9;
      b.add(new THREE.CylinderGeometry(0.7, 0.8, h, 14), zm.marble, placement(x, ty + 1.6 + h / 2, z), algae);
      cylinderCollider(physics, x, ty + 1.6, z, 0.8, h);
      if (fallen) b.add(new THREE.CylinderGeometry(0.7, 0.7, 6, 14).rotateZ(Math.PI / 2), zm.marble, placement(x + 2, ground(x + 2, z + 3) + 0.7, z + 3, rng() * 3), algae);
    }
  }
  // Arches and walls scattered around.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng() * 0.3;
    const d = 26 + rng() * 18;
    const x = r.x + Math.cos(a) * d;
    const z = r.z + Math.sin(a) * d;
    const y = ground(x, z);
    const yaw = rng() * Math.PI;
    for (const s of [-1, 1]) b.add(box(1.5, 7, 1.5, 3), zm.marble, placement(x, y + 3.5, z, yaw).multiply(placement(s * 3, 0, 0)), algae);
    if (rng() < 0.7) b.add(box(7.5, 1.4, 1.6, 3), zm.marble, placement(x, y + 7.3, z, yaw), algae);
    boxCollider(physics, placement(x, y, z, yaw), { x: 0, y: 3.5, z: 0 }, { x: 7.5, y: 7, z: 1.5 });
  }
  // A giant fallen head, and glowing runes on the stones.
  const hx = r.x + 18;
  const hz = r.z + 20;
  b.add(new THREE.SphereGeometry(3.4, 18, 14).scale(1, 1.2, 1), zm.marble, placement(hx, ground(hx, hz) + 2.5, hz, 0.6, 0.4, 0.3), algae);
  b.add(box(3, 0.6, 1.2), zm.marble, placement(hx + 1.5, ground(hx, hz) + 2.0, hz + 2.6, 0.6), '#94b0a2');
  for (let i = 0; i < 18; i++) {
    const x = r.x + (rng() - 0.5) * 70;
    const z = r.z + (rng() - 0.5) * 70;
    b.add(box(0.5, 0.5, 0.05), zm.glow, placement(x, ground(x, z) + 0.6 + rng(), z, rng() * 6), GLOW[i % GLOW.length]);
  }
}

/** Coral shapes: branching, brain, fan and tube. */
function coralShapes(): THREE.BufferGeometry[] {
  const rng = mulberry32(97);
  const branches: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const tilt = 0.2 + rng() * 0.5;
    branches.push(new THREE.CylinderGeometry(0.03, 0.08, 1, 5).translate(0, 0.5, 0).rotateZ(tilt).rotateY(a));
  }
  const brain = new THREE.SphereGeometry(0.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1);
  const fan = new THREE.CircleGeometry(0.8, 16, 0, Math.PI).translate(0, 0.05, 0);
  fan.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(fan.attributes.position.count * 3).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  const tubes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) tubes.push(new THREE.CylinderGeometry(0.12, 0.1, 0.6 + rng() * 0.8, 8, 1, true).translate((rng() - 0.5) * 0.4, 0.4, (rng() - 0.5) * 0.4));
  return [mergeAll(branches), brain, fan, mergeAll(tubes)];
}

/** A strip of kelp, one meter tall (scaled per plant), crossed for volume. */
function kelpBlade(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(0.5, 1, 1, 8).translate(0, 0.5, 0);
  const c = a.clone().rotateY(Math.PI / 2);
  return mergeAll([a, c]);
}

/** Kelp sways in the current, more toward its tip. */
function kelpMaterial(): { material: THREE.MeshStandardMaterial; time: { value: number } } {
  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float id = float(gl_InstanceID);
        float sway = sin(uTime * 0.8 + id * 1.7 + position.y * 2.5) * position.y * position.y * 0.6;
        transformed.x += sway * 0.8;
        transformed.z += cos(uTime * 0.6 + id) * position.y * position.y * 0.15;`,
      );
  };
  return { material, time };
}
