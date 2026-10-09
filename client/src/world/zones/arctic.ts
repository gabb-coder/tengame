import * as THREE from 'three';
import { smoothstep } from '../../../../shared/noise.ts';
import { ARCTIC } from '../../../../shared/zones/arctic.ts';
import { boxCollider } from '../town/colliders.ts';
import { box, placement } from '../town/meshBuilder.ts';
import { TRIGGERS_BY_ID } from '../../../../shared/activities.ts';
import { game, onTrigger } from '../../game/link.ts';
import { buttonActivity } from './buttons.ts';
import { grazer, Herd, loopMover, penguin, runner } from './creatures.ts';
import { ChunkedBuilder, compose, conifer, cylinderCollider, instanced, mulberry32, Placement, rockGeometry, type ZoneContent, type ZoneContext } from './kit.ts';
import { lineActivities, loopCurve, TransitLine, type VehicleState } from './transit.ts';

/** Frostfang Tundra: snowy forest, glaciers, igloos, the outpost, and the aurora. */
export function buildArctic(ctx: ZoneContext): ZoneContent {
  const { physics, zm, m, terrain, lights } = ctx;
  const group = new THREE.Group();
  group.name = 'zone-arctic';
  const b = new ChunkedBuilder();
  const place = new Placement('arctic');
  const lake = ARCTIC.lake;
  place.avoid({ type: 'circle', x: lake.x, z: lake.z, r: lake.r + 8 });
  place.avoid({ type: 'circle', x: ARCTIC.camp.x, z: ARCTIC.camp.z, r: 44 });
  // The dog sled trail.
  const trail = ARCTIC.sledTrail.map(([x, z]) => ({ x, y: 0, z }));
  place.avoid({ type: 'path', path: [...trail, trail[0]], width: 12 });

  // Snow-laden spruce forest.
  const tree = conifer(true);
  const trees = place.scatter(420, { minX: -598, maxX: -210, minZ: -598, maxZ: -210 }, 2.2, 61, (x, z) => terrain.heightAt(x, z) < 22);
  const items = trees.map((t) => {
    const h = 7 + t.rng() * 9;
    return { matrix: compose(t.x, terrain.heightAt(t.x, t.z) - 0.2, t.z, t.rng() * 6, new THREE.Vector3(h * 0.55, h, h * 0.55)), h };
  });
  group.add(instanced(tree.trunk, m.bark, items.map((i) => ({ matrix: i.matrix }))));
  group.add(instanced(tree.crown, m.foliage, items.map((i) => ({ matrix: i.matrix, color: '#2f4f3c' }))));
  group.add(instanced(tree.snow!, zm.snow, items.map((i) => ({ matrix: i.matrix, color: '#ffffff' }))));
  for (const t of trees) cylinderCollider(physics, t.x, terrain.heightAt(t.x, t.z) - 0.5, t.z, 0.3, 6);

  // Snow-capped boulders.
  const rock = rockGeometry(7, 1, 0.45);
  const rocks = place.scatter(70, { minX: -598, maxX: -210, minZ: -598, maxZ: -210 }, 2, 62);
  group.add(
    instanced(
      rock,
      zm.rock,
      rocks.map((r) => ({ matrix: compose(r.x, terrain.heightAt(r.x, r.z), r.z, r.rng() * 6, 1 + r.rng() * 2.2), color: '#c8ccd2' })),
    ),
  );

  // Glaciers: great blue ice shelves on the mountains along the world's edge.
  const rng = mulberry32(64);
  for (let i = 0; i < 46; i++) {
    const along = -600 + rng() * 400;
    const out = -605 - rng() * 70;
    const [x, z] = i % 2 ? [out, along - 190] : [along - 190, out];
    if (x > -200 || z > -200) continue;
    const s = 10 + rng() * 22;
    const g = rockGeometry(100 + i, 1, 0.6);
    b.add(g, zm.glacier, compose(x, terrain.heightAt(x, z) - s * 0.2, z, rng() * 6, new THREE.Vector3(s * (1 + rng()), s * (0.6 + rng() * 0.6), s * (1 + rng()))), '#ffffff', { castShadow: false });
  }
  // Ice blocks frozen into the lake, and an ice-fishing hut.
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    const r = 15 + rng() * (lake.r - 22);
    const x = lake.x + Math.cos(a) * r;
    const z = lake.z + Math.sin(a) * r;
    const s = 1 + rng() * 2.5;
    const g = rockGeometry(200 + i, 0, 0.5);
    b.add(g, zm.glacier, compose(x, 0, z, rng() * 6, new THREE.Vector3(s * 1.4, s, s * 1.2)), '#ffffff');
    cylinderCollider(physics, x, 0, z, s, s);
  }
  const hut = { x: lake.x + 18, z: lake.z - 14 };
  b.add(box(3, 2.4, 2.6, 1), zm.planks, placement(hut.x, 1.2, hut.z, 0.4), '#8e3b2a');
  b.add(box(3.4, 0.2, 3.2, 1), zm.snow, placement(hut.x, 2.55, hut.z, 0.4), '#ffffff');
  boxCollider(physics, placement(hut.x, 0, hut.z, 0.4), { x: 0, y: 1.2, z: 0 }, { x: 3, y: 2.4, z: 2.6 });

  // The igloo camp.
  for (const ig of ARCTIC.igloos) buildIgloo(ctx, b, ig.x, ig.z, ig.yaw);
  // Sleds and supply crates around the camp.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5;
    const x = ARCTIC.camp.x + Math.cos(a) * 14;
    const z = ARCTIC.camp.z + Math.sin(a) * 14;
    b.add(box(1.2, 0.2, 2.6, 1), zm.planks, placement(x, 0.35, z, a), '#8a5a32');
    for (const s of [-0.5, 0.5]) b.add(box(0.06, 0.06, 2.8), m.darkMetal, placement(x + Math.cos(a) * s, 0.1, z - Math.sin(a) * s, a));
    b.add(box(0.8, 0.6, 0.8, 1), zm.planks, placement(x, 0.75, z, a), '#6a4a2a');
  }

  // The outpost: radio mast with a red light, fuel drums and a snowcat shed.
  const ox = ARCTIC.x + 175;
  const oz = ARCTIC.outpostZ - 22;
  const base = terrain.heightAt(ox, oz) - 0.2;
  for (let k = 0; k < 4; k++) {
    const y = base + k * 6;
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 6, 4).translate(0, 3, 0), m.darkMetal, placement(ox - 0.6, y, oz - 0.6));
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 6, 4).translate(0, 3, 0), m.darkMetal, placement(ox + 0.6, y, oz - 0.6));
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 6, 4).translate(0, 3, 0), m.darkMetal, placement(ox, y, oz + 0.6));
    b.add(box(1.4, 0.08, 1.4), m.darkMetal, placement(ox, y + 6, oz));
  }
  b.add(new THREE.SphereGeometry(0.35, 10, 8), zm.glow, placement(ox, base + 24.4, oz), '#ff2a1a');
  cylinderCollider(physics, ox, base, oz, 1, 24);
  for (let i = 0; i < 6; i++) {
    const x = ARCTIC.x + 40 + (i % 3) * 1.3;
    const z = ARCTIC.outpostZ - 14 - Math.floor(i / 3) * 1.3;
    b.add(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 12).translate(0, 0.6, 0), zm.paint, placement(x, 0.15, z), i % 2 ? '#b8452e' : '#2e5a8a');
    cylinderCollider(physics, x, 0, z, 0.5, 1.3);
  }

  buildCampLife(ctx, b);
  const observatoryDome = buildObservatory(ctx, b);
  group.add(observatoryDome);

  // Campfire warmth is on the shared fires; here, just a lamp on the observatory door.
  lights.add({ position: new THREE.Vector3(ARCTIC.observatory.x, 3, ARCTIC.observatory.z + 12), color: '#ffd9a0', intensity: 12, range: 14, active: () => true });

  // Wildlife: a reindeer herd and a penguin colony by the lake.
  const reindeer = new Herd(
    grazer('reindeer', '#7a5a42'),
    7,
    loopMover(
      [
        [-300, -250],
        [-260, -300],
        [-330, -350],
        [-380, -300],
        [-360, -250],
      ],
      1.1,
      terrain,
      { spacing: 6, spread: 3 },
    ),
  );
  const penguins = new Herd(
    penguin(),
    12,
    loopMover(
      [
        [lake.x - 30, lake.z + lake.r + 6],
        [lake.x + 10, lake.z + lake.r + 4],
        [lake.x + 30, lake.z + lake.r - 10],
        [lake.x - 10, lake.z + lake.r - 6],
      ],
      0.45,
      terrain,
      { spacing: 2.2, spread: 0.8 },
    ),
  );
  group.add(reindeer.group, penguins.group);

  const aurora = new Aurora();
  group.add(aurora.mesh);

  const sleds = buildSleds(ctx);
  group.add(sleds.group);
  const flare = buildFlare(ctx, b);
  group.add(flare.group, b.build('arctic'));

  return {
    id: 'arctic',
    group,
    update(view) {
      reindeer.update(view.clock, view.camera.position);
      penguins.update(view.clock, view.camera.position);
      aurora.update(view.time, view.night);
      observatoryDome.rotation.y = view.clock * 0.02;
      sleds.update(view.clock, view.camera.position);
      flare.update(view.dt);
    },
  };
}

/** The camp's odds and ends: snowmen, tents, a rack of drying fish, skis, and kennels. */
function buildCampLife(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm, m, terrain } = ctx;
  const ground = (x: number, z: number) => terrain.heightAt(x, z);
  const cp = ARCTIC.camp;
  // Snowmen with coal eyes, a carrot nose and a scarf.
  const coal = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
  for (const [x, z, s] of [[cp.x + 18, cp.z + 10, 1], [cp.x - 22, cp.z + 16, 0.8], [ARCTIC.lake.x + 40, ARCTIC.lake.z - 40, 1.2]] as const) {
    const y = ground(x, z);
    b.add(new THREE.SphereGeometry(0.75 * s, 16, 12), zm.snow, placement(x, y + 0.6 * s, z), '#ffffff');
    b.add(new THREE.SphereGeometry(0.55 * s, 16, 12), zm.snow, placement(x, y + 1.5 * s, z), '#ffffff');
    b.add(new THREE.SphereGeometry(0.38 * s, 14, 10), zm.snow, placement(x, y + 2.2 * s, z), '#ffffff');
    for (const ex of [-0.13, 0.13]) b.add(new THREE.SphereGeometry(0.05 * s, 6, 4), coal, placement(x + ex * s, y + 2.3 * s, z + 0.33 * s));
    for (const by of [1.4, 1.65]) b.add(new THREE.SphereGeometry(0.06 * s, 6, 4), coal, placement(x, y + by * s, z + 0.52 * s));
    b.add(new THREE.ConeGeometry(0.06 * s, 0.35 * s, 8).rotateX(Math.PI / 2), zm.paint, placement(x, y + 2.22 * s, z + 0.5 * s), '#f07a1a');
    b.add(new THREE.TorusGeometry(0.4 * s, 0.08 * s, 6, 16).rotateX(Math.PI / 2), m.fabric, placement(x, y + 1.88 * s, z), '#c8302a');
    b.add(new THREE.CylinderGeometry(0.02, 0.02, 1.2 * s, 5).rotateZ(1.1), m.bark, placement(x + 0.7 * s, y + 1.6 * s, z));
    b.add(new THREE.CylinderGeometry(0.02, 0.02, 1.2 * s, 5).rotateZ(-1.1), m.bark, placement(x - 0.7 * s, y + 1.6 * s, z));
    cylinderCollider(physics, x, y, z, 0.7 * s, 2.5 * s);
  }
  // Canvas tents round the edge of the camp.
  for (let i = 0; i < 3; i++) {
    const a = 3.6 + i * 0.5;
    const x = cp.x + Math.cos(a) * 30;
    const z = cp.z + Math.sin(a) * 30;
    const y = ground(x, z);
    b.add(new THREE.ConeGeometry(1.8, 2.2, 4).rotateY(Math.PI / 4).scale(1, 1, 1.6).translate(0, 1.1, 0), zm.paint, placement(x, y, z, -a), ['#d8501a', '#2a6ad8', '#e8c040'][i]);
    cylinderCollider(physics, x, y, z, 1.6, 2.2);
  }
  // A rack of fish drying in the cold, and skis stood in the snow.
  const rx = cp.x + 12;
  const rz = cp.z - 16;
  const ry = ground(rx, rz);
  for (const s of [-1.4, 1.4]) b.add(box(0.1, 1.9, 0.1), zm.planks, placement(rx + s, ry + 0.95, rz), '#6a4a2a');
  b.add(box(3, 0.08, 0.08), zm.planks, placement(rx, ry + 1.85, rz), '#6a4a2a');
  for (let k = 0; k < 7; k++) b.add(new THREE.ConeGeometry(0.08, 0.5, 6).rotateX(Math.PI), zm.paint, placement(rx - 1.2 + k * 0.4, ry + 1.5, rz), '#b8a080');
  for (let k = 0; k < 4; k++) b.add(box(0.08, 1.8, 0.02), zm.paint, placement(cp.x - 12 + k * 0.25, ground(cp.x - 12, cp.z - 18) + 0.85, cp.z - 18, 0, 0.1), ['#c8302a', '#2a6ad8', '#e8e8e8', '#2a2a2a'][k]);
}

/** Dog sleds: two teams of six huskies pulling a sled round the lake, from the igloo camp. */
function buildSleds(ctx: ZoneContext): { group: THREE.Group; update(t: number, camera: THREE.Vector3): void } {
  const { zm, m, terrain } = ctx;
  const ground = (x: number, z: number) => terrain.heightAt(x, z);
  // Points every few meters so the sled hugs the snow.
  const rough = loopCurve(ARCTIC.sledTrail.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 160; i++) {
    const p = rough.getPointAt(i / 160);
    pts.push(p.setY(ground(p.x, p.z)));
  }
  const curve = loopCurve(pts);
  const [sx, sz] = ARCTIC.sledTrail[0];
  const board = new THREE.Vector3(sx + 2.6, ground(sx + 2.6, sz), sz - 1.5);
  const line = new TransitLine(curve, [{ name: 'Igloo Camp', at: 0, dwell: 12, board, exit: board }], 8, 2);
  const group = new THREE.Group();
  const sleds: THREE.Group[] = [];
  const wood = new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 0.8 });
  const blanket = new THREE.MeshStandardMaterial({ color: '#b8302a', roughness: 1 });
  for (let v = 0; v < line.vehicles; v++) {
    const sled = new THREE.Group();
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      sled.add(mesh);
    };
    for (const x of [-0.45, 0.45]) add(box(0.06, 0.06, 2.9), m.darkMetal, x, 0.05, -0.1);
    for (const z of [-1.1, -0.2, 0.7]) for (const x of [-0.45, 0.45]) add(box(0.05, 0.35, 0.05), wood, x, 0.22, z);
    add(box(1, 0.06, 2.2), wood, 0, 0.4, -0.1);
    add(box(0.9, 0.25, 1.4), blanket, 0, 0.55, 0.1);
    add(box(0.05, 0.4, 1.6), wood, -0.48, 0.65, 0.1);
    add(box(0.05, 0.4, 1.6), wood, 0.48, 0.65, 0.1);
    for (const x of [-0.42, 0.42]) add(box(0.05, 0.9, 0.05), wood, x, 0.85, -1.15);
    add(box(0.9, 0.05, 0.05), wood, 0, 1.3, -1.15);
    // The front curls up.
    add(new THREE.TorusGeometry(0.3, 0.03, 6, 10, Math.PI / 2).rotateY(Math.PI / 2), m.darkMetal, 0.45, 0.35, 1.35);
    add(new THREE.TorusGeometry(0.3, 0.03, 6, 10, Math.PI / 2).rotateY(Math.PI / 2), m.darkMetal, -0.45, 0.35, 1.35);
    group.add(sled);
    sleds.push(sled);
  }
  // Six dogs per sled, in pairs ahead of it on a gangline.
  const state = { position: new THREE.Vector3(), yaw: 0, pitch: 0, stopped: null, next: line.stops[0], wait: 0, vehicle: 0 } as VehicleState;
  const furs = ['#e8e4dc', '#5a5a5e', '#8a6a4a', '#d8d0c4', '#3a3a3e', '#c8b8a0'];
  const dogs = new Herd(runner('husky', '#e8e4dc'), 12, (i, t, out) => {
    const pair = Math.floor((i % 6) / 2);
    const side = i % 2 ? 1 : -1;
    line.state(t, Math.floor(i / 6), -(2.4 + pair * 1.4), state);
    out.x = state.position.x + Math.cos(state.yaw) * side * 0.38;
    out.z = state.position.z - Math.sin(state.yaw) * side * 0.38;
    out.y = ground(out.x, out.z);
    out.yaw = state.yaw;
    out.pitch = 0;
    out.roll = 0;
    return true;
  });
  for (let i = 0; i < 12; i++) for (let p = 0; p < 6; p++) dogs.tint(i, p, furs[i % furs.length]);
  group.add(dogs.group);
  const lines = sleds.map(() => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 4 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: '#3a2a1a' }));
    l.frustumCulled = false;
    group.add(l);
    return l;
  });
  const matrix = (s: VehicleState) => {
    const y = ground(s.position.x, s.position.z);
    return new THREE.Matrix4().makeRotationY(s.yaw).setPosition(s.position.x, y, s.position.z);
  };
  game.activities.add(
    ...lineActivities(
      line,
      {
        name: 'dog sled',
        verb: 'Ride the dog sled',
        seats: [new THREE.Vector3(0, 0.72, -0.15)],
        pose: 'sit',
        reach: 3.5,
        hopOff: (s) => {
          const x = s.position.x + Math.cos(s.yaw) * 1.6;
          const z = s.position.z - Math.sin(s.yaw) * 1.6;
          return new THREE.Vector3(x, ground(x, z) + 0.1, z);
        },
      },
      matrix,
    ),
  );
  const p = new THREE.Vector3();
  return {
    group,
    update(t, camera) {
      sleds.forEach((sled, v) => {
        line.state(t, v, 0, state);
        sled.visible = lines[v].visible = state.position.distanceTo(camera) < 300;
        sled.matrixAutoUpdate = false;
        sled.matrix.copy(matrix(state));
        sled.matrixWorldNeedsUpdate = true;
        // The gangline from the sled's nose to the lead dogs.
        const pos = lines[v].geometry.attributes.position as THREE.BufferAttribute;
        for (let k = 0; k < 4; k++) {
          line.state(t, v, k === 0 ? -1.4 : -(2.4 + (k - 1) * 1.4), state);
          p.set(state.position.x, ground(state.position.x, state.position.z) + 0.45, state.position.z);
          pos.setXYZ(k, p.x, p.y, p.z);
        }
        pos.needsUpdate = true;
      });
      dogs.update(t, camera);
    },
  };
}

/** The signal flare by the outpost's mast: it soars up and hangs there, burning red. */
function buildFlare(ctx: ZoneContext, b: ChunkedBuilder): { group: THREE.Group; update(dt: number): void } {
  const { zm, m, terrain } = ctx;
  const f = TRIGGERS_BY_ID.get('arctic/flare')!;
  const y0 = terrain.heightAt(f.x, f.z);
  const post = { x: f.x - 1.4, z: f.z - 1.2 };
  b.add(box(0.5, 1.1, 0.5, 1), zm.paint, placement(post.x, y0 + 0.55, post.z), '#c8302a');
  b.add(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 10, 1, true).rotateX(0.2).translate(0, 1.4, 0), m.darkMetal, placement(post.x, y0, post.z));
  const group = new THREE.Group();
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,120,90,0.6)');
    grad.addColorStop(1, 'rgba(255,40,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff5a3a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flare.scale.setScalar(9);
  const light = new THREE.PointLight('#ff3a1a', 0, 260, 1.1);
  flare.add(light);
  flare.visible = false;
  group.add(flare);
  const trail = new Float32Array(40 * 3);
  const trailLine = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(trail, 3)), new THREE.LineBasicMaterial({ color: '#ffd0b0', transparent: true, opacity: 0.5 }));
  trailLine.frustumCulled = false;
  trailLine.visible = false;
  group.add(trailLine);
  let t = -1;
  game.activities.add(buttonActivity('arctic/flare'));
  onTrigger('arctic/flare', () => {
    t = 0;
    for (let k = 0; k < 40; k++) trail.set([post.x, y0 + 1.5, post.z], k * 3);
    game.sounds?.flare(new THREE.Vector3(post.x, y0 + 1.5, post.z));
  });
  return {
    group,
    update(dt) {
      if (t < 0) return;
      t += dt;
      // Up in 2.5 s, then drifting down slowly while it burns.
      const h = t < 2.5 ? 75 * (1 - (1 - t / 2.5) ** 2) : 75 - (t - 2.5) * 2.2;
      flare.position.set(post.x + t * 1.2, y0 + 1.5 + h, post.z + t * 0.6);
      flare.visible = true;
      const burn = t < 2.5 ? 0.4 : Math.max(0, 1 - (t - 12) / 2);
      flare.scale.setScalar(4 + 6 * burn + Math.sin(t * 30) * 0.5);
      light.intensity = burn * 6000;
      trailLine.visible = t < 6;
      for (let k = 39; k > 0; k--) trail.copyWithin(k * 3, (k - 1) * 3, k * 3);
      trail.set([flare.position.x, flare.position.y, flare.position.z], 0);
      trailLine.geometry.attributes.position.needsUpdate = true;
      if (t > 14) {
        t = -1;
        flare.visible = false;
        trailLine.visible = false;
        trail.fill(0);
      }
    },
  };
}

/** A snow-block dome with an entrance tunnel, hollow inside, with a fur rug. */
function buildIgloo(ctx: ZoneContext, b: ChunkedBuilder, x: number, z: number, yaw: number): void {
  const { physics, zm, m } = ctx;
  const r = 3.4;
  const M = placement(x, 0, z, yaw);
  // The dome shell, open at the doorway (local +Z).
  const shell = new THREE.SphereGeometry(r, 20, 10, Math.PI / 2 + 0.38, Math.PI * 2 - 0.76, 0, Math.PI / 2);
  b.add(shell, zm.snow, M, '#f4f8fb');
  b.add(new THREE.SphereGeometry(r - 0.3, 20, 10, Math.PI / 2 + 0.38, Math.PI * 2 - 0.76, 0, Math.PI / 2).scale(-1, 1, 1), zm.snow, M, '#dfe9f0');
  // Block joints: rings around the dome.
  for (let k = 1; k < 5; k++) {
    const a = (k / 5) * (Math.PI / 2);
    b.add(new THREE.TorusGeometry(Math.cos(a) * r + 0.02, 0.04, 4, 32, Math.PI * 2 - 0.76).rotateX(Math.PI / 2).rotateY(-Math.PI / 2 + 0.38), zm.snow, M.clone().multiply(placement(0, Math.sin(a) * r, 0)), '#cfdce6', { castShadow: false });
  }
  // Entrance tunnel.
  const tunnel = new THREE.CylinderGeometry(1.2, 1.2, 2.4, 14, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
  b.add(tunnel, zm.snow, M.clone().multiply(placement(0, 0, r - 0.2)), '#f4f8fb');
  // A fur rug and a lantern inside.
  b.add(new THREE.CircleGeometry(1.6, 16).rotateX(-Math.PI / 2), m.fabric, M.clone().multiply(placement(0, 0.03, -0.5)), '#8a6a4a', { castShadow: false });
  ctx.lights.add({ position: new THREE.Vector3(x, 1.4, z), color: '#ffb870', intensity: 6, range: 6, flicker: true });
  // Colliders: wall blocks around the ring, leaving the door; a cap on top.
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.5) continue;
    boxCollider(physics, M.clone().multiply(placement(Math.cos(a) * (r - 0.3), 0, Math.sin(a) * (r - 0.3), -a + Math.PI / 2)), { x: 0, y: 1.3, z: 0 }, { x: 1.6, y: 2.6, z: 0.5 });
  }
  boxCollider(physics, M, { x: 0, y: r - 0.4, z: 0 }, { x: r, y: 0.6, z: r });
}

/** A domed observatory with a telescope poking out of the slit. */
function buildObservatory(ctx: ZoneContext, b: ChunkedBuilder): THREE.Group {
  const { physics, zm, m } = ctx;
  const o = ARCTIC.observatory;
  b.add(new THREE.CylinderGeometry(9, 9.5, 7, 28).translate(0, 3.5, 0), zm.paint, placement(o.x, 0, o.z), '#e8ecf0');
  b.add(box(2.2, 3, 0.3), m.door, placement(o.x, 1.5, o.z + 9.3), '#2e4a7a');
  cylinderCollider(physics, o.x, 0, o.z, 9.5, 7);
  const dome = new THREE.Group();
  dome.position.set(o.x, 7, o.z);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(9, 28, 14, 0.25, Math.PI * 2 - 0.5, 0, Math.PI / 2), zm.metal);
  shell.rotation.y = Math.PI / 2;
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 9, 16), m.steel);
  scope.position.set(0, 4, 3.5);
  scope.rotation.x = 0.7;
  dome.add(shell, scope);
  dome.traverse((o) => (o.castShadow = true));
  return dome;
}

/** Curtains of green and violet light rippling high over the tundra at night. */
class Aurora {
  readonly mesh: THREE.Mesh;
  private uniforms = { uTime: { value: 0 }, uStrength: { value: 0 } };

  constructor() {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const g = new THREE.PlaneGeometry(900, 140, 120, 1);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        // Bend each curtain into a slow S-curve, one behind another.
        pos.setZ(i, Math.sin(x / 140 + k * 1.7) * 70 + k * 80);
        pos.setY(i, pos.getY(i) + 150 + k * 20);
      }
      g.computeVertexNormals();
      parts.push(g);
    }
    const geometry = new THREE.BufferGeometry();
    const merged = parts.map((p) => p.toNonIndexed());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(merged.flatMap((p) => [...(p.attributes.position.array as Float32Array)]), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(merged.flatMap((p) => [...(p.attributes.uv.array as Float32Array)]), 2));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      vertexShader: `varying vec2 vUv; varying vec3 vPos; void main() { vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform float uStrength; varying vec2 vUv; varying vec3 vPos;
        float h(float n) { return fract(sin(n) * 43758.5453); }
        float noise(float x) { float i = floor(x); float f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
        void main() {
          float x = vUv.x * 60.0;
          float rays = noise(x * 3.0 + uTime * 0.6) * 0.6 + noise(x * 11.0 - uTime * 1.3) * 0.4;
          float band = noise(x * 0.5 + uTime * 0.15);
          float v = vUv.y;
          float fade = smoothstep(0.0, 0.15, v) * (1.0 - smoothstep(0.35, 1.0, v));
          vec3 green = vec3(0.15, 1.0, 0.45);
          vec3 violet = vec3(0.6, 0.2, 0.9);
          vec3 color = mix(green, violet, smoothstep(0.3, 0.9, v));
          float a = fade * rays * (0.4 + band) * uStrength;
          gl_FragColor = vec4(color * a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(ARCTIC.x - 40, 0, ARCTIC.z - 120);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(time: number, night: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uStrength.value = smoothstep(night, 0.35, 0.9) * 1.1;
    this.mesh.visible = night > 0.3;
  }
}
