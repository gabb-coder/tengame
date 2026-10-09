import * as THREE from 'three';
import { CYBERPUNK } from '../../../../shared/zones/cyberpunk.ts';
import { boxCollider } from '../town/colliders.ts';
import { box, flatRect, IDENTITY, MeshBuilder, placement } from '../town/meshBuilder.ts';
import { ChunkedBuilder, cylinderCollider, mulberry32, type ZoneContent, type ZoneContext } from './kit.ts';

const NEON = ['#ff2a8a', '#2af0ff', '#b44aff', '#ffe02a', '#2aff8a', '#ff6a2a'];
const SIGN_WORDS = ['NEON', 'RAMEN', 'HOTEL', '24/7', 'CYBER', 'BAR', 'SUSHI', 'ARCADE', 'NOODLES', 'KARAOKE', 'CLINIC', 'DATA', 'PIXEL', 'VOLT', 'ZENITH', 'OPEN'];
const CURB = 0.15;

/** Neon Spire: a megacity of towers, neon and rain, built upward. */
export function buildCyberpunk(ctx: ZoneContext): ZoneContent {
  const { physics, m, zm, lights } = ctx;
  const group = new THREE.Group();
  group.name = 'zone-cyberpunk';
  const b = new ChunkedBuilder();
  const facade = facadeMaterial();
  const signs = new MeshBuilder();
  const signMat = neonSignMaterial();
  const rng = mulberry32(111);
  const h = CYBERPUNK.helix;
  const billboards: THREE.Mesh[] = [];
  const screen = new Billboard();

  for (const [minX, minZ, maxX, maxZ] of CYBERPUNK.blocks) {
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const helixBlock = Math.abs(cx - h.x) < 5 && Math.abs(cz - h.z) < 5;
    const marketBlock = Math.abs(cx - CYBERPUNK.market.x) < 5 && Math.abs(cz - CYBERPUNK.market.z) < 5;
    const zenith = Math.abs(cx - CYBERPUNK.zenith.x) < 5 && Math.abs(cz - CYBERPUNK.zenith.z) < 5;
    // Sidewalk slab (the Helix plaza is level with the street so cars can drive in).
    if (!helixBlock) {
      b.add(box(maxX - minX, CURB, maxZ - minZ, 3), zm.roads.cobble, placement(cx, CURB / 2, cz), '#6a6a72');
      boxCollider(physics, IDENTITY, { x: cx, y: CURB / 2, z: cz }, { x: maxX - minX, y: CURB, z: maxZ - minZ });
    } else {
      b.add(flatRect(minX, minZ, maxX, maxZ, 0.02, 3), zm.roads.asphalt, IDENTITY, '#3a3a40', { castShadow: false });
    }
    if (helixBlock) continue;
    if (marketBlock) {
      buildMarket(ctx, b, signs, cx, cz);
      continue;
    }
    // Towers: one giant, or a few of varying heights.
    const towers = zenith ? [{ x: cx, z: cz, w: 40, d: 40, hgt: 240 }] : layoutTowers(minX + 6, minZ + 6, maxX - 6, maxZ - 6, rng);
    for (const t of towers) {
      tower(b, facade, physics, t.x, t.z, t.w, t.d, t.hgt, rng, zm);
      // Neon signs down the corners, facing the streets.
      const count = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < count; k++) {
        const side = Math.floor(rng() * 4);
        const [nx, nz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][side];
        const along = (rng() - 0.5) * (side < 2 ? t.d : t.w) * 0.7;
        const y = 6 + rng() * Math.min(60, t.hgt - 12);
        const vertical = rng() < 0.5;
        const [sw, sh] = vertical ? [2.2, 7] : [7, 2.4];
        const x = t.x + (nx * t.w) / 2 + nx * 0.3 + (side >= 2 ? along : 0);
        const z = t.z + (nz * t.d) / 2 + nz * 0.3 + (side < 2 ? along : 0);
        signs.add(signPlane(Math.floor(rng() * SIGN_WORDS.length), sw, sh, vertical), signMat, placement(x, y, z, Math.atan2(nx, nz)));
      }
      // Some towers carry a giant animated billboard.
      if (t.hgt > 70 && billboards.length < 8 && rng() < 0.6) {
        const bb = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(t.w, 22) * 0.9, 12), screen.material);
        const side = rng() < 0.5 ? 1 : -1;
        bb.position.set(t.x, 30 + rng() * (t.hgt - 50), t.z + (side * t.d) / 2 + side * 0.4);
        bb.rotation.y = side > 0 ? 0 : Math.PI;
        group.add(bb);
        billboards.push(bb);
      }
    }
    // Street furniture on the sidewalk: neon lamps and vending machines.
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = cx + dx * ((maxX - minX) / 2 - 1.5);
      const z = cz + dz * ((maxZ - minZ) / 2 - 1.5);
      b.add(new THREE.CylinderGeometry(0.08, 0.12, 7, 8).translate(0, 3.5, 0), m.darkMetal, placement(x, CURB, z));
      b.add(box(0.25, 2.2, 0.25), zm.glow, placement(x, CURB + 6.2, z), NEON[Math.floor(rng() * NEON.length)]);
      cylinderCollider(physics, x, CURB, z, 0.15, 7);
    }
    const vx = minX + 4 + rng() * (maxX - minX - 8);
    b.add(box(1.2, 2, 0.9, 1), zm.paint, placement(vx, CURB + 1, minZ + 1.6), '#20242a');
    b.add(box(1, 1.3, 0.05), zm.glow, placement(vx, CURB + 1.2, minZ + 1.13), NEON[Math.floor(rng() * NEON.length)]);
  }

  buildHelix(ctx, b, signs, signMat);
  const train = buildMonorail(ctx, b);
  const traffic = new FlyingTraffic();

  group.add(b.build('cyberpunk'), signs.build('cyber-signs'), train.group, traffic.mesh);
  for (const [i, c] of NEON.entries()) {
    lights.add({ position: new THREE.Vector3(260 + i * 60, 8, -100 + (i % 3) * 100), color: c, intensity: 30, range: 26 });
  }
  return {
    id: 'cyberpunk',
    group,
    update(view) {
      facade.userData.time.value = view.time;
      signMat.userData.time.value = view.time;
      screen.update(view.dt);
      train.update(view.time);
      traffic.update(view.time);
    },
  };
}

/** Two to four towers filling a block, with gaps between them. */
function layoutTowers(minX: number, minZ: number, maxX: number, maxZ: number, rng: () => number): { x: number; z: number; w: number; d: number; hgt: number }[] {
  const out = [];
  const splitX = rng() < 0.6;
  const splitZ = rng() < 0.6;
  const xs = splitX ? [[minX, (minX + maxX) / 2 - 2], [(minX + maxX) / 2 + 2, maxX]] : [[minX, maxX]];
  const zs = splitZ ? [[minZ, (minZ + maxZ) / 2 - 2], [(minZ + maxZ) / 2 + 2, maxZ]] : [[minZ, maxZ]];
  for (const [x0, x1] of xs) {
    for (const [z0, z1] of zs) {
      const w = (x1 - x0) * (0.75 + rng() * 0.25);
      const d = (z1 - z0) * (0.75 + rng() * 0.25);
      out.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w, d, hgt: 40 + rng() ** 1.5 * 150 });
    }
  }
  return out;
}

/** A skyscraper: setback tiers, rooftop gear and a blinking beacon. */
function tower(b: ChunkedBuilder, facade: THREE.Material, physics: ZoneContext['physics'], x: number, z: number, w: number, d: number, hgt: number, rng: () => number, zm: ZoneContext['zm']): void {
  let y = CURB;
  let [cw, cd] = [w, d];
  const tiers = hgt > 100 ? 3 : hgt > 60 ? 2 : 1;
  for (let t = 0; t < tiers; t++) {
    const th = (hgt - CURB) * (t === tiers - 1 ? 1 / tiers + 0.05 : 1 / tiers - 0.025);
    b.add(box(cw, th, cd, 1), facade, placement(x, y + th / 2, z), ['#20242c', '#262a34', '#1c2026'][Math.floor(rng() * 3)]);
    // A glowing band at each setback.
    b.add(box(cw + 0.2, 0.4, cd + 0.2), zm.glow, placement(x, y + th, z), NEON[Math.floor(rng() * NEON.length)]);
    y += th;
    cw *= 0.78;
    cd *= 0.78;
  }
  boxCollider(physics, IDENTITY, { x, y: hgt / 2, z }, { x: w, y: hgt, z: d });
  b.add(new THREE.CylinderGeometry(0.15, 0.3, 14, 6).translate(0, 7, 0), zm.paint, placement(x + cw * 0.2, y, z), '#3a3e44');
  b.add(new THREE.SphereGeometry(0.5, 8, 6), zm.glow, placement(x + cw * 0.2, y + 14, z), '#ff2020');
  for (let k = 0; k < 3; k++) b.add(box(2.4, 1.6, 2.4), zm.paint, placement(x - cw * 0.3 + k * 2.8, y + 0.8, z + cd * 0.2), '#4a4e56');
}

/** The night market: stalls under lanterns and strings of light. */
function buildMarket(ctx: ZoneContext, b: ChunkedBuilder, signs: MeshBuilder, cx: number, cz: number): void {
  const { physics, zm, m } = ctx;
  const rng = mulberry32(112);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const x = cx - 24 + i * 16;
      const z = cz - 24 + j * 16;
      const c = NEON[(i + j * 2) % NEON.length];
      b.add(box(4, 1, 2.2, 1), zm.paint, placement(x, CURB + 0.5, z), '#2a2e36');
      b.add(box(4.4, 0.12, 3.4), zm.paint, placement(x, CURB + 2.6, z), '#1a1e24');
      b.add(box(4.4, 0.25, 0.1), zm.glow, placement(x, CURB + 2.45, z + 1.7), c);
      for (const px of [-2, 2]) b.add(box(0.1, 2.6, 0.1), m.darkMetal, placement(x + px, CURB + 1.3, z + 1.6));
      for (let k = 0; k < 3; k++) b.add(new THREE.SphereGeometry(0.28, 10, 8), zm.glow, placement(x - 1.4 + k * 1.4, CURB + 2.1, z + 1.9), k % 2 ? '#ff4a3a' : '#ffb03a');
      boxCollider(physics, IDENTITY, { x, y: CURB + 0.5, z }, { x: 4, y: 1, z: 2.2 });
      if (rng() < 0.5) signs.add(signPlane(Math.floor(rng() * SIGN_WORDS.length), 3.6, 1.2, false), neonSignMaterial(), placement(x, CURB + 3.4, z + 1.7));
    }
  }
  // Strings of lights across the market.
  for (let k = 0; k < 6; k++) {
    for (let i = 0; i < 20; i++) {
      const x = cx - 34 + i * 3.6;
      const z = cz - 30 + k * 12;
      b.add(new THREE.SphereGeometry(0.15, 6, 4), zm.glow, placement(x, CURB + 5.5 - Math.sin((i / 19) * Math.PI) * 0.8, z), NEON[(i + k) % NEON.length]);
    }
  }
}

/** The Helix Tower: a spiral ramp you can drive up, to a ring deck high over the city. */
function buildHelix(ctx: ZoneContext, b: ChunkedBuilder, signs: MeshBuilder, signMat: THREE.Material): void {
  const { physics, zm } = ctx;
  const h = CYBERPUNK.helix;
  const core = h.inner - 0.3;
  b.add(new THREE.CylinderGeometry(core, core, 130, 32).translate(0, 65, 0), zm.paint, placement(h.x, 0, h.z), '#20242c');
  for (let y = 4; y < 130; y += 3.4) b.add(new THREE.CylinderGeometry(core + 0.05, core + 0.05, 1.2, 32, 1, true), zm.paint, placement(h.x, y, h.z), '#3a4656');
  cylinderCollider(physics, h.x, 0, h.z, core, 130);
  for (let y = 20; y < 130; y += 20) b.add(new THREE.TorusGeometry(core + 0.15, 0.25, 6, 40).rotateX(Math.PI / 2), zm.glow, placement(h.x, y, h.z), NEON[(y / 20) % NEON.length]);
  b.add(new THREE.ConeGeometry(core, 18, 32).translate(0, 139, 0), zm.paint, placement(h.x, 0, h.z), '#2a2e36');
  b.add(new THREE.SphereGeometry(1, 10, 8), zm.glow, placement(h.x, 149, h.z), '#ff2a8a');
  signs.add(signPlane(14, 8, 26, true), signMat, placement(h.x, 80, h.z + core + 0.4));

  // The ramp: segments climbing clockwise (seen from above), entered heading north.
  const R = (h.inner + h.outer) / 2;
  const width = h.outer - h.inner;
  const steps = 48 * h.turns;
  const rise = h.rise;
  const top = rise * h.turns;
  const thick = 0.5;
  for (let k = 0; k < steps; k++) {
    const a0 = -(k / 48) * Math.PI * 2;
    const a1 = -((k + 1) / 48) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const y0 = (k / steps) * top;
    const y1 = ((k + 1) / steps) * top;
    const chord = 2 * R * Math.sin(Math.PI / 48) + 0.08;
    const x = h.x + R * Math.cos(am);
    const z = h.z + R * Math.sin(am);
    // Direction of travel: clockwise, so the tangent is (sin a, -cos a).
    const yaw = Math.atan2(Math.sin(am), -Math.cos(am));
    const pitch = -Math.atan2(y1 - y0, chord);
    const M = placement(x, (y0 + y1) / 2 - thick / 2, z, yaw, pitch);
    b.add(box(width, thick, chord, 2), zm.roads.asphalt, M, '#5a5a62');
    boxCollider(physics, M, { x: 0, y: 0, z: 0 }, { x: width, y: thick, z: chord });
    // Guard rail on the outer edge, with a neon strip.
    const outside = -1;
    b.add(box(0.3, 1.1, chord), zm.paint, M.clone().multiply(placement(outside * (width / 2 - 0.15), 0.8, 0)), '#3a3e46');
    b.add(box(0.32, 0.12, chord), zm.glow, M.clone().multiply(placement(outside * (width / 2 - 0.15), 1.3, 0)), NEON[k % 2 ? 0 : 1]);
    boxCollider(physics, M, { x: outside * (width / 2 - 0.15), y: 0.8, z: 0 }, { x: 0.3, y: 1.6, z: chord });
    // Support pillars every quarter turn, just outside the ramp so they never block the
    // lane below (and none in the way in, on the south-east side).
    const approach = Math.cos(am) > 0 && Math.sin(am) > -0.1;
    if (k % 12 === 6 && y0 > 4 && !approach) {
      const px = h.x + (h.outer + 0.9) * Math.cos(am);
      const pz = h.z + (h.outer + 0.9) * Math.sin(am);
      b.add(new THREE.CylinderGeometry(0.6, 0.6, y0, 10).translate(0, y0 / 2, 0), zm.paint, placement(px, 0, pz), '#3a3e46');
      b.add(box(2.2, 0.4, 0.6), zm.paint, placement(px, y0 - 0.5, pz, -am), '#3a3e46');
      cylinderCollider(physics, px, 0, pz, 0.6, y0);
    }
  }
  // The deck at the top: it carries on round from where the ramp arrives, stopping short
  // of the last stretch of ramp below it (so cars coming up don't hit their heads). The
  // rail has a gap on the west side for daredevils.
  const deckEnd = 1.5;
  for (let k = 0; k < 48; k++) {
    const a = -((k + 0.5) / 48) * Math.PI * 2;
    if (a < -Math.PI * 2 + deckEnd) {
      // A barrier where the deck ends.
      const end = -Math.PI * 2 + deckEnd;
      const E = placement(h.x + R * Math.cos(end), top, h.z + R * Math.sin(end), Math.atan2(Math.sin(end), -Math.cos(end)));
      b.add(box(width, 1.2, 0.4), zm.paint, E.clone().multiply(placement(0, 0.6, 0)), '#ffd02a');
      boxCollider(physics, E, { x: 0, y: 0.6, z: 0 }, { x: width, y: 1.2, z: 0.4 });
      break;
    }
    const x = h.x + R * Math.cos(a);
    const z = h.z + R * Math.sin(a);
    const chord = 2 * R * Math.sin(Math.PI / 48) + 0.08;
    const M = placement(x, top - thick / 2, z, Math.atan2(Math.sin(a), -Math.cos(a)));
    b.add(box(width, thick, chord, 2), zm.roads.asphalt, M, '#4a4a52');
    boxCollider(physics, M, { x: 0, y: 0, z: 0 }, { x: width, y: thick, z: chord });
    if (Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < 0.25) continue;
    b.add(box(0.3, 1.1, chord), zm.paint, M.clone().multiply(placement(-(width / 2 - 0.15), 0.8, 0)), '#3a3e46');
    boxCollider(physics, M, { x: -(width / 2 - 0.15), y: 0.8, z: 0 }, { x: 0.3, y: 1.6, z: chord });
  }
  b.add(new THREE.TorusGeometry(h.outer, 0.2, 6, 64).rotateX(Math.PI / 2), zm.glow, placement(h.x, top + 1.4, h.z), '#2af0ff');
  // Ground: an arrow showing the way in.
  b.add(box(1.2, 0.03, 8), zm.glow, placement(h.x + R, 0.04, h.z + h.outer + 6), '#2af0ff', { castShadow: false });
}

/** An elevated monorail loop with a train gliding around it. */
function buildMonorail(ctx: ZoneContext, b: ChunkedBuilder): { group: THREE.Group; update(t: number): void } {
  const { physics, zm } = ctx;
  const r = CYBERPUNK.monorail;
  const y = r.height;
  const corners: [number, number][] = [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.maxX, r.maxZ],
    [r.minX, r.maxZ],
  ];
  const streets = (v: number, list: readonly number[]) => list.some((s) => Math.abs(v - s) < 9);
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i];
    const [x1, z1] = corners[(i + 1) % 4];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    b.add(box(1.6, 1.4, len + 1.6, 2), zm.paint, placement((x0 + x1) / 2, y, (z0 + z1) / 2, yaw), '#3a3e46');
    b.add(box(1.7, 0.15, len + 1.7), zm.glow, placement((x0 + x1) / 2, y - 0.75, (z0 + z1) / 2, yaw), '#b44aff');
    for (let s = 0; s <= len; s += 30) {
      const px = x0 + ((x1 - x0) * s) / len;
      const pz = z0 + ((z1 - z0) * s) / len;
      if (streets(px, CYBERPUNK.avenues) || streets(pz, CYBERPUNK.streets)) continue;
      b.add(new THREE.CylinderGeometry(0.8, 1, y, 10).translate(0, y / 2, 0), zm.paint, placement(px, 0, pz), '#2e3238');
      cylinderCollider(physics, px, 0, pz, 1, y - 1);
    }
  }
  const group = new THREE.Group();
  const cars: THREE.Group[] = [];
  const body = new THREE.MeshStandardMaterial({ color: '#e8ecf0', roughness: 0.3, metalness: 0.4 });
  const windows = new THREE.MeshStandardMaterial({ color: '#101820', emissive: '#2af0ff', emissiveIntensity: 0.8 });
  for (let k = 0; k < 4; k++) {
    const car = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 9, 6, 12).rotateX(Math.PI / 2), body);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.9, 9), windows);
    glass.position.y = 0.3;
    shell.castShadow = true;
    car.add(shell, glass);
    group.add(car);
    cars.push(car);
  }
  const perimeter = 2 * (r.maxX - r.minX + r.maxZ - r.minZ);
  const at = (s: number) => {
    s = ((s % perimeter) + perimeter) % perimeter;
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = corners[i];
      const [x1, z1] = corners[(i + 1) % 4];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (s <= len) return { x: x0 + ((x1 - x0) * s) / len, z: z0 + ((z1 - z0) * s) / len, yaw: Math.atan2(x1 - x0, z1 - z0) };
      s -= len;
    }
    return { x: corners[0][0], z: corners[0][1], yaw: 0 };
  };
  return {
    group,
    update(t) {
      cars.forEach((car, k) => {
        const p = at(t * 22 - k * 12.5);
        car.position.set(p.x, y + 2.3, p.z);
        car.rotation.y = p.yaw;
      });
    },
  };
}

/** Flying cars streaming along sky lanes between the towers. */
class FlyingTraffic {
  readonly mesh: THREE.InstancedMesh;
  private lanes: { x: number; z: number; dx: number; dz: number; y: number; speed: number; offset: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor() {
    const rng = mulberry32(113);
    const count = 48;
    const geometry = new THREE.CapsuleGeometry(0.9, 2.6, 4, 8).rotateX(Math.PI / 2).scale(1, 0.55, 1);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.5 });
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.frustumCulled = false;
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const alongX = i % 2 === 0;
      const lane = CYBERPUNK.streets[i % 3] + (rng() - 0.5) * 6;
      const avenue = CYBERPUNK.avenues[i % 3] + (rng() - 0.5) * 6;
      const dir = rng() < 0.5 ? 1 : -1;
      this.lanes.push({
        x: alongX ? 200 : avenue,
        z: alongX ? lane : -200,
        dx: alongX ? dir : 0,
        dz: alongX ? 0 : dir,
        y: 30 + Math.floor(rng() * 4) * 14,
        speed: 18 + rng() * 14,
        offset: rng() * 400,
      });
      this.mesh.setColorAt(i, color.set(NEON[i % NEON.length]));
    }
  }

  update(t: number): void {
    this.lanes.forEach((l, i) => {
      const s = (t * l.speed + l.offset) % 400;
      const along = l.dx > 0 || l.dz > 0 ? s : 400 - s;
      const x = l.dx ? 200 + along : l.x;
      const z = l.dz ? -200 + along : l.z;
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(l.dx, l.dz));
      this.m.compose(new THREE.Vector3(x, l.y + Math.sin(t + i) * 0.5, z), this.q, new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Tower walls covered in windows, a random share of them lit, worked out per pixel from
 * the world position (no textures needed).
 */
function facadeMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.5 });
  const time = { value: 0 };
  mat.userData.time = time;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos; varying vec3 vWNormal; uniform float uTime;
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 an = abs(vWNormal);
        if (an.y < 0.5) {
          vec2 p = an.x > an.z ? vec2(vWPos.z * sign(vWNormal.x), vWPos.y) : vec2(vWPos.x * sign(vWNormal.z), vWPos.y);
          vec2 cellSize = vec2(1.8, 3.4);
          vec2 cell = floor(p / cellSize);
          vec2 f = fract(p / cellSize);
          float win = step(0.08, f.x) * step(f.x, 0.92) * step(0.3, f.y) * step(f.y, 0.88);
          float seed = hash2(cell + vec2(an.x * 13.0, an.z * 29.0));
          float lit = step(0.66, seed);
          // A few windows flicker.
          lit *= 1.0 - step(0.985, seed) * step(0.5, fract(uTime * 0.7 + seed * 10.0));
          vec3 warm = vec3(1.0, 0.78, 0.5);
          vec3 cool = vec3(0.55, 0.85, 1.0);
          vec3 pink = vec3(1.0, 0.4, 0.8);
          vec3 tint = seed > 0.95 ? pink : seed > 0.8 ? cool : warm;
          totalEmissiveRadiance += win * lit * tint * (0.7 + 0.5 * hash2(cell * 0.37));
          // Glass in every window: darker and shinier than the frame around it.
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.05, 0.07), win * 0.85);
        }`,
      );
  };
  return mat;
}

/** Neon signs share one texture with every word on it; they glow and some flicker. */
function neonSignMaterial(): THREE.MeshBasicMaterial {
  if (signMaterialCache) return signMaterialCache;
  const cols = 4;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(10,8,16,0.85)';
  ctx.fillRect(0, 0, 1024, 1024);
  SIGN_WORDS.forEach((word, i) => {
    const cx = (i % cols) * 256;
    const cy = Math.floor(i / cols) * 256;
    const color = NEON[i % NEON.length];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.strokeRect(10, 10, 236, 236);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${word.length > 5 ? 48 : 70}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(word, 128, 128);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, 256, 256);
    ctx.restore();
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6), side: THREE.DoubleSide });
  const time = { value: 0 };
  mat.userData.time = time;
  signMaterialCache = mat;
  return mat;
}
let signMaterialCache: THREE.MeshBasicMaterial | null = null;

/** A sign panel showing word `index` from the shared texture (rotated for vertical signs). */
function signPlane(index: number, w: number, h: number, vertical: boolean): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const u0 = (index % 4) / 4;
  const v0 = 1 - (Math.floor(index / 4) + 1) / 4;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    let [u, v] = [uv.getX(i), uv.getY(i)];
    if (vertical) [u, v] = [1 - v, u];
    uv.setXY(i, u0 + u * 0.25, v0 + v * 0.25);
  }
  return g;
}

/** A giant animated advertisement screen. */
class Billboard {
  readonly material: THREE.MeshBasicMaterial;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private t = 0;
  private since = 0;

  constructor() {
    this.canvas.width = 256;
    this.canvas.height = 128;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, color: new THREE.Color(1.3, 1.3, 1.3), side: THREE.DoubleSide });
    this.draw();
  }

  update(dt: number): void {
    this.t += dt;
    this.since += dt;
    if (this.since < 0.1) return;
    this.since = 0;
    this.draw();
  }

  private draw(): void {
    const { ctx, t } = this;
    const scene = Math.floor(t / 6) % 3;
    const g = ctx.createLinearGradient(0, 0, 256, 128);
    g.addColorStop(0, scene === 0 ? '#ff2a8a' : scene === 1 ? '#2a3aff' : '#1a1a2a');
    g.addColorStop(1, scene === 0 ? '#3a0a5a' : scene === 1 ? '#2af0ff' : '#5a2a8a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (scene === 0) {
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('ZENITH CORP', 128, 52);
      ctx.font = '16px sans-serif';
      ctx.fillText('the future, delivered', 128, 88);
    } else if (scene === 1) {
      // A spinning ring logo.
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 6;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.ellipse(128, 64, 46, 46 * Math.abs(Math.cos(t * 2 + k)), k, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('SYNAPSE+  think faster', 128, 118);
    } else {
      // A waveform equalizer.
      for (let i = 0; i < 24; i++) {
        const h = 20 + Math.abs(Math.sin(t * 3 + i * 0.7) * Math.sin(t * 1.3 + i)) * 80;
        ctx.fillStyle = NEON[i % NEON.length];
        ctx.fillRect(10 + i * 10, 118 - h, 7, h);
      }
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText('RADIO NEON 88.1', 128, 18);
    }
    this.texture.needsUpdate = true;
  }
}
