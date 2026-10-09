import * as THREE from 'three';
import { PREHISTORIC } from '../../../../shared/zones/prehistoric.ts';
import { boxCollider } from '../town/colliders.ts';
import { box, placement } from '../town/meshBuilder.ts';
import { zoneAt } from '../../../../shared/world.ts';
import type { Mount } from '../../game/activities.ts';
import { worldSeconds } from '../../game/clock.ts';
import { game } from '../../game/link.ts';
import { ceratopsian, circleMover, flyer, Herd, loopMover, mammoth, type Mover, type Placement as Pose, sauropod, theropod } from './creatures.ts';
import { ChunkedBuilder, compose, cylinderCollider, fern, instanced, mergeAll, mulberry32, palms, Placement, Puffs, rockGeometry, type ZoneContent, type ZoneContext } from './kit.ts';
import { ribbon } from './roads.ts';

/** One eruption every this many seconds, at the same moment for everyone. */
export const ERUPT_EVERY = 180;
export const ERUPTION = 14;

/** The Primeval Valley: volcano, cave, springs, fossils, and the creatures of the past. */
export function buildPrehistoric(ctx: ZoneContext): ZoneContent {
  const { physics, zm, m, terrain, lights } = ctx;
  const group = new THREE.Group();
  group.name = 'zone-prehistoric';
  const b = new ChunkedBuilder();
  const ground = (x: number, z: number) => terrain.heightAt(x, z);
  const place = new Placement('prehistoric');
  const v = PREHISTORIC.volcano;
  place.avoid({ type: 'circle', x: PREHISTORIC.cave.x, z: PREHISTORIC.cave.z, r: PREHISTORIC.cave.r + 6 });
  for (const g of PREHISTORIC.geysers) place.avoid({ type: 'circle', x: g.x, z: g.z, r: 4 });
  place.avoid({ type: 'circle', x: -404, z: 392, r: 4 });
  const area = { minX: -598, maxX: -205, minZ: 205, maxZ: 598 };

  // Lava flows: glowing rivers running down the volcano's outer flanks.
  const flows: THREE.BufferGeometry[] = [];
  // Most run down the far side; two pour toward the valley, where you can see them.
  for (const angle of [2.0, 2.45, 2.9, 1.6, -0.75, 0.15]) {
    const path: { x: number; y: number; z: number }[] = [];
    let x = v.x + Math.cos(angle) * (v.crater + 1);
    let z = v.z + Math.sin(angle) * (v.crater + 1);
    for (let i = 0; i < 160; i++) {
      path.push({ x, y: 0, z });
      // Follow the steepest way down, nudged outward so flows don't pool.
      const e = 2;
      const gx = ground(x + e, z) - ground(x - e, z);
      const gz = ground(x, z + e) - ground(x, z - e);
      const len = Math.hypot(gx, gz) || 1;
      x += (-gx / len) * 2 + Math.cos(angle) * 0.6;
      z += (-gz / len) * 2 + Math.sin(angle) * 0.6;
      if (ground(x, z) < 8) break;
    }
    flows.push(ribbon(path, 5, 0.25, ground));
  }
  for (const g of flows) b.add(g, zm.lava, new THREE.Matrix4(), undefined, { castShadow: false });
  lights.add({ position: new THREE.Vector3(v.x, v.lava + 6, v.z), color: '#ff6a20', intensity: 200, range: 90 });

  buildCave(ctx, b);
  buildFossil(ctx, b);

  // Plants of the age: tree ferns, cycads, araucaria pines, ferns and horsetails.
  const fernGeo = fern(121);
  const fernSpots = place.scatter(380, area, 1.6, 122, (x, z) => ground(x, z) < 25);
  group.add(instanced(fernGeo, zm.fronds, fernSpots.map((s) => ({ matrix: compose(s.x, ground(s.x, s.z) - 0.1, s.z, s.rng() * 6, 1.2 + s.rng() * 1.8), color: s.rng() < 0.5 ? '#4a6a2a' : '#5a7a30' })), { castShadow: false, detail: 180 }));
  const cycads = place.scatter(70, area, 3, 123, (x, z) => ground(x, z) < 20);
  group.add(palms(cycads.map((s) => ({ x: s.x, y: ground(s.x, s.z), z: s.z, height: 4 + s.rng() * 5, yaw: s.rng() * 6 })), ctx, zm.fronds, 124));
  const pines = place.scatter(90, area, 4, 125, (x, z) => ground(x, z) < 30);
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, 1, 7).translate(0, 0.5, 0);
  const tiers = mergeAll([0.62, 0.74, 0.86, 0.96].map((y, i) => new THREE.CylinderGeometry(0.06, 0.32 - i * 0.05, 0.05, 9).translate(0, y, 0)));
  const pineItems = pines.map((s) => ({ matrix: compose(s.x, ground(s.x, s.z) - 0.2, s.z, s.rng() * 6, new THREE.Vector3(14, 16 + s.rng() * 10, 14)) }));
  group.add(instanced(trunk, m.bark, pineItems.map((p) => ({ matrix: p.matrix.clone().multiply(new THREE.Matrix4().makeScale(0.12, 1, 0.12)) }))));
  group.add(instanced(tiers, m.foliage, pineItems.map((p) => ({ ...p, color: '#2f4a28' }))));
  for (const s of pines) cylinderCollider(physics, s.x, ground(s.x, s.z), s.z, 0.6, 8);
  const horsetail = mergeAll(Array.from({ length: 6 }, (_, k) => new THREE.CylinderGeometry(0.03, 0.05, 1, 5).translate(Math.cos(k) * 0.3, 0.5, Math.sin(k * 1.7) * 0.3)));
  const tails = place.scatter(120, area, 1, 126, (x, z) => ground(x, z) < 6);
  group.add(instanced(horsetail, m.foliage, tails.map((s) => ({ matrix: compose(s.x, ground(s.x, s.z), s.z, 0, new THREE.Vector3(1, 2 + s.rng() * 2, 1)), color: '#6a8a3a' })), { castShadow: false, detail: 160 }));
  const boulders = place.scatter(70, area, 2.5, 127);
  group.add(instanced(rockGeometry(128, 1, 0.5), zm.darkRock, boulders.map((s) => ({ matrix: compose(s.x, ground(s.x, s.z), s.z, s.rng() * 6, 1 + s.rng() * 3), color: '#7a6a60' }))));
  for (const s of boulders) cylinderCollider(physics, s.x, ground(s.x, s.z), s.z, 1.2, 2);

  group.add(b.build('prehistoric'));

  // Smoke from the crater, steam from the springs, and lava bombs when it erupts.
  const smoke = new Puffs(60, '#5a5450', 0.42, { x: v.x, y: v.lava + 4, z: v.z, spread: 12, rise: 5, grow: 2, life: 34, size: 6, wind: [0.9, 0.35] }, 129);
  const steam = PREHISTORIC.springs.map((s, i) => new Puffs(10, '#f2f2f2', 0.35, { x: s.x, y: PREHISTORIC.springLevel, z: s.z, spread: s.r * 0.4, rise: 1.2, grow: 0.5, life: 7, size: 0.8 }, 130 + i));
  group.add(smoke.mesh, ...steam.map((s) => s.mesh));
  const bombs = new LavaBombs(v.x, v.lava + 2, v.z);
  group.add(bombs.mesh);
  // A red glow over the crater, lighting the smoke from below; strongest at night.
  const glowMat = new THREE.SpriteMaterial({ map: softDot(), color: '#ff5a1a', transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(90, 70, 1);
  glow.position.set(v.x, v.lava + 12, v.z);
  group.add(glow);

  // The beasts. The long-necks carry riders; the big hunter chases anyone who comes too near.
  const sauropods = new Herd(sauropod(), 4, loopMover([[-420, 330], [-452, 382], [-422, 432], [-382, 420], [-392, 352]], 1.4, terrain, { spacing: 16, spread: 6 }), [1, 0.9, 1.1, 0.7]);
  const saddles = buildSaddles(ctx, sauropods);
  group.add(saddles.group);
  const rex = new Rex(loopMover([[-240, 380], [-220, 452], [-262, 484], [-302, 440], [-282, 382]], 3.4, terrain), ground);
  const geysers = buildGeysers(ctx, b);
  group.add(geysers.group);
  buildNest(ctx, b);
  const herds = [
    sauropods,
    new Herd(theropod(), 1, rex.mover, [1.15]),
    new Herd(theropod('#4a6a52', '#9aa080'), 4, loopMover([[-230, 300], [-262, 352], [-322, 352], [-302, 290]], 7, terrain, { spacing: 3, spread: 2 }), [0.32, 0.3, 0.34, 0.31], 260),
    new Herd(ceratopsian(), 3, loopMover([[-470, 250], [-502, 302], [-462, 332], [-430, 282]], 1.2, terrain, { spacing: 10, spread: 4 })),
    new Herd(mammoth(), 4, loopMover([[-560, 230], [-582, 300], [-542, 342], [-520, 262]], 1.1, terrain, { spacing: 9, spread: 5 }), [1, 1.1, 0.8, 0.6]),
    new Herd(flyer({ size: 2.4, body: '#7a5a42', wing: '#8a6a4a', beat: 0.6, long: true }), 6, circleMover(v.x + 40, v.z - 40, 80, 125, 13, null, { absolute: true }), [], 600),
  ];
  group.add(...herds.map((h) => h.group));

  return {
    id: 'prehistoric',
    group,
    update(view) {
      const t = view.time;
      rex.update(view.dt, view.clock);
      for (const h of herds) h.update(view.clock, view.camera.position);
      saddles.update(view.clock);
      geysers.update(view.clock, view.dt);
      const phase = view.clock % ERUPT_EVERY;
      const erupting = phase < ERUPTION;
      smoke.update(t, erupting ? 1.6 : 1);
      for (const s of steam) s.update(t);
      bombs.update(view.dt, erupting);
      zm.lava.emissiveIntensity = (erupting ? 3.6 : 2.4) + Math.sin(t * 1.3) * 0.25;
      glowMat.opacity = (0.12 + view.night * 0.45) * (erupting ? 1.6 : 1) * (0.9 + 0.1 * Math.sin(t * 2.1));
    },
  };
}

/**
 * The T. rex: it roams its loop, but if you come close it roars and gives chase. Catch
 * someone on foot and it sends them flying. (Each player sees their own chase.)
 */
class Rex {
  readonly mover: Mover;
  private mode: 'roam' | 'chase' | 'return' = 'roam';
  private pos = new THREE.Vector3();
  private yaw = 0;
  private timer = 0;
  private cooldown = 0;
  private roam: Pose = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(
    private loop: Mover,
    private ground: (x: number, z: number) => number,
  ) {
    this.mover = (i, t, out) => {
      if (this.mode === 'roam') return loop(i, t, out);
      out.x = this.pos.x;
      out.z = this.pos.z;
      out.y = ground(out.x, out.z);
      out.yaw = this.yaw;
      out.pitch = 0;
      out.roll = 0;
      return true;
    };
  }

  update(dt: number, clock: number): void {
    this.cooldown -= dt;
    const me = game.player.position;
    this.loop(0, clock, this.roam);
    if (this.mode === 'roam') {
      this.pos.set(this.roam.x, this.roam.y, this.roam.z);
      this.yaw = this.roam.yaw;
      const near = Math.hypot(me.x - this.pos.x, me.z - this.pos.z) < 42;
      if (near && this.cooldown <= 0 && zoneAt(me.x, me.z) === 'prehistoric' && me.y < this.pos.y + 6) {
        this.mode = 'chase';
        this.timer = 16;
        game.sounds?.roar(this.pos);
        game.notice('The T. rex has seen you. RUN!');
      }
      return;
    }
    // Chase the player, or head back to where it should be on its loop.
    const target = this.mode === 'chase' ? me : new THREE.Vector3(this.roam.x, 0, this.roam.z);
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * Math.min(1, dt * 3);
    const speed = this.mode === 'chase' ? 8.2 : 5;
    const step = Math.min(d, speed * dt);
    this.pos.x += Math.sin(this.yaw) * step;
    this.pos.z += Math.cos(this.yaw) * step;
    this.timer -= dt;
    if (this.mode === 'chase') {
      if (d < 3.4 && game.player.onFoot) {
        game.launch({ x: (dx / d) * 9, y: 8, z: (dz / d) * 9 });
        game.playOnce('hit');
        game.sounds?.roar(this.pos);
        game.notice('CHOMP! The T. rex sent you flying. It’s lost interest… for now.');
        this.mode = 'return';
        this.cooldown = 45;
      } else if (this.timer <= 0 || d > 90 || zoneAt(me.x, me.z) !== 'prehistoric') {
        this.mode = 'return';
        this.cooldown = 30;
      }
    } else if (d < 1) this.mode = 'roam';
  }
}

/** Saddles on the long-necks' backs, and the "climb on" spot beside each. */
function buildSaddles(ctx: ZoneContext, herd: Herd): { group: THREE.Group; update(clock: number): void } {
  const { zm, terrain } = ctx;
  const group = new THREE.Group();
  const saddles: THREE.Group[] = [];
  const blanket = new THREE.MeshStandardMaterial({ color: '#a83a2a', roughness: 1 });
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const where = (i: number, t: number) => {
    const { scale } = herd.placementOf(i, t, pose);
    return { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, scale };
  };
  for (let i = 0; i < 4; i++) {
    const saddle = new THREE.Group();
    const cloth = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 16, 1, true, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1.2, 1, 1), blanket);
    cloth.material = new THREE.MeshStandardMaterial({ color: '#a83a2a', roughness: 1, side: THREE.DoubleSide });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.25, 1), zm.planks);
    seat.position.y = 0.1;
    const rail = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 6, 12, Math.PI).rotateY(Math.PI / 2), zm.planks);
    rail.position.set(0, 0.25, 0.45);
    saddle.add(cloth, seat, rail);
    group.add(saddle);
    saddles.push(saddle);
    // Climb up from beside it.
    const at = new THREE.Vector3();
    game.activities.add({
      get position() {
        const p = where(i, worldSeconds());
        return at.set(p.x, p.y, p.z);
      },
      reach: 5,
      prompt: () => (game.player.onFoot && !game.riding() ? { action: 'Climb onto the Brachiosaurus' } : null),
      use: () => {
        const mount: Mount = {
          position: new THREE.Vector3(),
          yaw: 0,
          pose: 'sit',
          label: 'Brachiosaurus',
          ride: true,
          update: () => {
            const p = where(i, worldSeconds());
            mount.position.set(p.x + Math.sin(p.yaw) * 0.4 * p.scale, p.y + 7.55 * p.scale, p.z + Math.cos(p.yaw) * 0.4 * p.scale);
            mount.yaw = p.yaw;
          },
          exit: () => {
            const p = where(i, worldSeconds());
            const x = p.x + Math.cos(p.yaw) * 3.4 * p.scale;
            const z = p.z - Math.sin(p.yaw) * 3.4 * p.scale;
            return new THREE.Vector3(x, terrain.heightAt(x, z) + 0.1, z);
          },
        };
        game.ride(mount);
      },
    });
  }
  return {
    group,
    update(clock) {
      saddles.forEach((saddle, i) => {
        const p = where(i, clock);
        saddle.position.set(p.x + Math.sin(p.yaw) * 0.4 * p.scale, p.y + 7.25 * p.scale, p.z + Math.cos(p.yaw) * 0.4 * p.scale);
        saddle.rotation.y = p.yaw;
        saddle.scale.setScalar(Math.max(0.8, p.scale));
      });
    },
  };
}

/** Geysers by the hot springs: every so often they blast a column of steam into the sky. */
function buildGeysers(ctx: ZoneContext, b: ChunkedBuilder): { group: THREE.Group; update(clock: number, dt: number): void } {
  const { zm, terrain } = ctx;
  const EVERY = 24;
  const BLOW = 4.5;
  const group = new THREE.Group();
  const columnMat = new THREE.MeshStandardMaterial({ color: '#f4f8fa', transparent: true, opacity: 0.55, roughness: 0.3, depthWrite: false });
  const geysers = PREHISTORIC.geysers.map((g, i) => {
    const y = terrain.heightAt(g.x, g.z);
    // A low mound of mineral crust round the vent.
    b.add(new THREE.CylinderGeometry(0.6, 2.6, 0.7, 18).translate(0, 0.35, 0), zm.sand, placement(g.x, y - 0.2, g.z), '#d8c8a0');
    b.add(new THREE.CircleGeometry(0.5, 14).rotateX(-Math.PI / 2), zm.water, placement(g.x, y + 0.52, g.z));
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 1, 14, 1, true).translate(0, 0.5, 0), columnMat);
    column.position.set(g.x, y + 0.5, g.z);
    column.visible = false;
    const steam = new Puffs(18, '#f6f8fa', 0.5, { x: g.x, y: y + 1, z: g.z, spread: 0.8, rise: 7, grow: 1.4, life: 3, size: 1.2, wind: [0.3, 0.1] }, 140 + i);
    group.add(column, steam.mesh);
    return { x: g.x, y, z: g.z, column, steam, offset: i * 8, blew: -Infinity };
  });
  let launchedAt = -Infinity;
  return {
    group,
    update(clock) {
      const me = game.player.position;
      for (const g of geysers) {
        const phase = (clock + g.offset) % EVERY;
        const blowing = phase < BLOW;
        const k = blowing ? Math.sin((phase / BLOW) * Math.PI) : 0;
        g.column.visible = blowing;
        g.column.scale.set(0.6 + k * 0.5, 0.1 + k * 16, 0.6 + k * 0.5);
        g.steam.mesh.visible = phase < BLOW + 3;
        if (g.steam.mesh.visible) g.steam.update(clock, 0.4 + k);
        if (blowing && clock - g.blew > EVERY / 2) {
          g.blew = clock;
          if (Math.hypot(me.x - g.x, me.z - g.z) < 120) game.sounds?.flare(new THREE.Vector3(g.x, g.y + 2, g.z));
        }
        // Standing on the vent as it blows: up you go.
        if (blowing && phase < BLOW - 1 && game.player.onFoot && clock - launchedAt > 2 && Math.hypot(me.x - g.x, me.z - g.z) < 1.8 && me.y < g.y + 1.5) {
          launchedAt = clock;
          game.launch({ x: (Math.random() - 0.5) * 3, y: 25, z: (Math.random() - 0.5) * 3 });
        }
      }
    },
  };
}

/** A nest of sticks with eggs in it, where the long-necks graze. */
function buildNest(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { m, terrain } = ctx;
  const x = -404;
  const z = 392;
  const y = terrain.heightAt(x, z);
  const rng = mulberry32(131);
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2;
    b.add(new THREE.CylinderGeometry(0.05, 0.06, 1.4, 5).rotateZ(Math.PI / 2 - 0.3), m.bark, placement(x + Math.cos(a) * 1.3, y + 0.15 + (k % 3) * 0.08, z + Math.sin(a) * 1.3, -a + rng() * 0.6));
  }
  for (const [ex, ez] of [[-0.4, 0.3], [0.35, 0.2], [0, -0.4]]) b.add(new THREE.SphereGeometry(0.22, 12, 10).scale(0.85, 1.15, 0.85), m.porcelain, placement(x + ex, y + 0.28, z + ez), '#e8dcc0');
}

/** A soft round glow, bright in the middle and fading to nothing. */
function softDot(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/** Glowing rocks hurled from the crater during an eruption. */
class LavaBombs {
  readonly mesh: THREE.InstancedMesh;
  private bombs: { p: THREE.Vector3; v: THREE.Vector3; alive: boolean }[] = [];
  private m = new THREE.Matrix4();
  private rng = mulberry32(131);

  constructor(
    private x: number,
    private y: number,
    private z: number,
  ) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.2, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.8, 0.2), toneMapped: false }), 30);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < 30; i++) this.bombs.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), alive: false });
  }

  update(dt: number, erupting: boolean): void {
    for (const b of this.bombs) {
      if (!b.alive && erupting && this.rng() < dt * 2) {
        const a = this.rng() * Math.PI * 2;
        const out = 8 + this.rng() * 14;
        b.p.set(this.x, this.y, this.z);
        b.v.set(Math.cos(a) * out, 30 + this.rng() * 22, Math.sin(a) * out);
        b.alive = true;
      }
      if (b.alive) {
        b.v.y -= 9.81 * dt;
        b.p.addScaledVector(b.v, dt);
        if (b.p.y < this.y - 60) b.alive = false;
      }
    }
    this.bombs.forEach((b, i) => {
      this.m.makeTranslation(b.p.x, b.p.y, b.p.z);
      if (!b.alive) this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** The Cave of Echoes: a rocky dome you can drive into, with paintings and a fire pit. */
function buildCave(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm, lights } = ctx;
  const c = PREHISTORIC.cave;
  const r = c.r;
  const height = 13;
  // The doorway faces north (-z), toward the trail.
  const door = -Math.PI / 2;
  const gap = 0.42;
  const shell = (radius: number, inner: boolean) => {
    const g = new THREE.SphereGeometry(radius, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const keep: number[] = [];
    const rng = mulberry32(140 + (inner ? 1 : 0));
    const bumps = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      const key = `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
      if (!bumps.has(key)) bumps.set(key, 1 + (rng() - 0.5) * 0.14);
      v.multiplyScalar(bumps.get(key)!);
      v.y *= height / radius;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    // Drop the triangles in the doorway (low and facing north).
    const index = g.index!;
    for (let t = 0; t < index.count; t += 3) {
      const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      const mid = ids.reduce((acc, id) => acc.add(new THREE.Vector3().fromBufferAttribute(pos, id)), new THREE.Vector3()).divideScalar(3);
      const angle = Math.atan2(mid.z, mid.x);
      const inDoor = Math.abs(Math.atan2(Math.sin(angle - door), Math.cos(angle - door))) < gap && mid.y < 8;
      if (!inDoor) keep.push(...(inner ? [ids[0], ids[2], ids[1]] : ids));
    }
    g.setIndex(keep);
    g.computeVertexNormals();
    return g;
  };
  b.add(shell(r, false), zm.rock, placement(c.x, -0.5, c.z), '#8a7a68');
  b.add(shell(r - 1.2, true), zm.rock, placement(c.x, -0.5, c.z), '#5a4a3e');
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - door), Math.cos(a - door))) < gap + 0.05) continue;
    boxCollider(physics, placement(c.x + Math.cos(a) * (r - 0.6), 0, c.z + Math.sin(a) * (r - 0.6), -a + Math.PI / 2), { x: 0, y: 5, z: 0 }, { x: 5, y: 10, z: 1.4 });
  }
  boxCollider(physics, placement(c.x, 0, c.z), { x: 0, y: height - 0.5, z: 0 }, { x: r * 1.2, y: 1, z: r * 1.2 });
  // Stalagmites and hanging stalactites.
  const rng = mulberry32(141);
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const d = 6 + rng() * (r - 9);
    if (Math.abs(Math.atan2(Math.sin(a - door), Math.cos(a - door))) < 0.6) continue;
    const x = c.x + Math.cos(a) * d;
    const z = c.z + Math.sin(a) * d;
    const h = 1 + rng() * 3;
    b.add(new THREE.ConeGeometry(0.4 + h * 0.15, h, 7).translate(0, h / 2, 0), zm.rock, placement(x, 0, z), '#7a6a58');
    b.add(new THREE.ConeGeometry(0.3, 1.5 + rng() * 2, 6).rotateX(Math.PI), zm.rock, placement(x, height - 2.2 - rng(), z), '#6a5a4a');
    cylinderCollider(physics, x, 0, z, 0.4, h);
  }
  // Paintings of hunters and beasts on the back wall.
  const art = new THREE.PlaneGeometry(14, 5).rotateX(0.15).rotateY(Math.PI);
  art.userData.keepUv = true;
  b.add(art, new THREE.MeshStandardMaterial({ map: cavePainting(), transparent: true, roughness: 1, depthWrite: false }), placement(c.x, 4, c.z + r - 2.6), undefined, { castShadow: false });
  lights.add({ position: new THREE.Vector3(c.x, 3, c.z + 4), color: '#ff9a4a', intensity: 22, range: 20, flicker: true });
}

/** Ochre and charcoal figures on a transparent background. */
function cavePainting(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = 'rgba(140,50,20,0.85)';
  ctx.fillStyle = 'rgba(140,50,20,0.85)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  // A mammoth.
  ctx.beginPath();
  ctx.ellipse(120, 90, 55, 35, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const x of [85, 105, 135, 155]) {
    ctx.beginPath();
    ctx.moveTo(x, 110);
    ctx.lineTo(x, 150);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(170, 80);
  ctx.quadraticCurveTo(200, 110, 185, 150);
  ctx.stroke();
  // Hunters with spears.
  ctx.strokeStyle = 'rgba(30,20,15,0.85)';
  for (const x of [280, 330, 380]) {
    ctx.beginPath();
    ctx.arc(x, 70, 8, 0, Math.PI * 2);
    ctx.moveTo(x, 78);
    ctx.lineTo(x, 115);
    ctx.lineTo(x - 12, 145);
    ctx.moveTo(x, 115);
    ctx.lineTo(x + 12, 145);
    ctx.moveTo(x - 15, 90);
    ctx.lineTo(x + 15, 90);
    ctx.moveTo(x + 15, 90);
    ctx.lineTo(x - 30, 50);
    ctx.stroke();
  }
  // Hand prints and a sun.
  ctx.fillStyle = 'rgba(180,90,30,0.7)';
  for (const [x, y] of [
    [450, 60],
    [470, 120],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
    for (let f = 0; f < 5; f++) ctx.fillRect(x - 12 + f * 6, y - 30, 4, 18);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The bones of a giant, half buried in the Fossil Field. */
function buildFossil(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { zm, physics } = ctx;
  const f = PREHISTORIC.fossils;
  const bone = '#e8dcc0';
  const M = placement(f.x, 0, f.z, 0.7);
  b.add(new THREE.CylinderGeometry(0.4, 0.6, 26, 10).rotateX(Math.PI / 2).translate(0, 1.6, 0), zm.paint, M, bone);
  for (let k = 0; k < 9; k++) {
    const z = -6 + k * 1.6;
    const s = 1 - Math.abs(k - 3) * 0.1;
    b.add(new THREE.TorusGeometry(3.4 * s, 0.22, 6, 14, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI / 2 * 0).translate(0, 1.6, z), zm.paint, M, bone);
  }
  b.add(box(2.2, 1.8, 4.2), zm.paint, M.clone().multiply(placement(0, 1.6, 15)), bone);
  b.add(box(1.6, 0.5, 3.4), zm.paint, M.clone().multiply(placement(0, 0.6, 15.5, 0, 0.3)), bone);
  for (let k = 0; k < 8; k++) b.add(new THREE.ConeGeometry(0.12, 0.6, 5).rotateX(Math.PI), zm.paint, M.clone().multiply(placement(-0.6 + (k % 4) * 0.4, 0.6, 14.2 + Math.floor(k / 4) * 1.5)), '#f2ead6');
  boxCollider(physics, M, { x: 0, y: 2, z: 2 }, { x: 7, y: 4, z: 28 });
}
