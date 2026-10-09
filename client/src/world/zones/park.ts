import * as THREE from 'three';
import { TRIGGERS_BY_ID } from '../../../../shared/activities.ts';
import { CURB_HEIGHT, generateTown, PARK_FOUNTAIN } from '../../../../shared/town.ts';
import { lampPositions } from '../town/roads.ts';
import { game, onTrigger } from '../../game/link.ts';
import { boxCollider } from '../town/colliders.ts';
import { box, IDENTITY, placement } from '../town/meshBuilder.ts';
import { benchSeats, buttonActivity, zoneSeats } from './buttons.ts';
import { fireworks } from './fireworks.ts';
import { ChunkedBuilder, cylinderCollider, lathe, mulberry32, type ZoneContent, type ZoneContext } from './kit.ts';

const Y = CURB_HEIGHT;
const STONE = '#d8d2c4';

/**
 * Town Park's extras: a fountain, benches round it, flower beds, and a fireworks launcher
 * anyone can light for the whole room.
 */
export function buildPark(ctx: ZoneContext): ZoneContent {
  const { physics, zm, m } = ctx;
  const group = new THREE.Group();
  group.name = 'park';
  const b = new ChunkedBuilder();
  const f = PARK_FOUNTAIN;

  // The fountain: a round basin, a pedestal with two bowls, and jets of water.
  b.add(lathe([[f.r - 0.35, 0], [f.r, 0], [f.r + 0.1, 0.5], [f.r - 0.05, 0.6], [f.r - 0.4, 0.6], [f.r - 0.45, 0.05]], 40), zm.marble, placement(f.x, Y, f.z), STONE);
  b.add(new THREE.CircleGeometry(f.r - 0.4, 40).rotateX(-Math.PI / 2), zm.water, placement(f.x, Y + 0.42, f.z));
  b.add(lathe([[0.55, 0], [0.4, 0.4], [0.32, 1.4], [1.3, 1.5], [1.35, 1.7], [0.3, 1.7], [0.22, 2.6], [0.75, 2.7], [0.78, 2.85], [0.15, 2.85], [0.12, 3.4], [0.2, 3.55], [0, 3.6]], 24), zm.marble, placement(f.x, Y, f.z), '#e8e2d4');
  for (const [r, y] of [[1.25, 1.62], [0.7, 2.78]]) b.add(new THREE.CircleGeometry(r, 24).rotateX(-Math.PI / 2), zm.water, placement(f.x, Y + y, f.z));
  // The rim stops you walking in, but you can hop over it.
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    boxCollider(physics, placement(f.x + Math.cos(a) * (f.r - 0.15), Y, f.z + Math.sin(a) * (f.r - 0.15), -a + Math.PI / 2), { x: 0, y: 0.3, z: 0 }, { x: 1.15, y: 0.6, z: 0.35 });
  }
  cylinderCollider(physics, f.x, Y, f.z, 0.55, 3.6);
  const jets = new FountainJets(f.x, Y, f.z);
  group.add(jets.mesh);

  // Benches facing the fountain, and flower beds between them.
  const rng = mulberry32(201);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const x = f.x + Math.cos(a) * 7.5;
    const z = f.z + Math.sin(a) * 7.5;
    const yaw = Math.atan2(f.x - x, f.z - z);
    bench(b, ctx, x, z, yaw);
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    zoneSeats.push(...benchSeats(`park/bench${k}`, { x: x - side.x * 0.55, z: z - side.z * 0.55 }, { x: x + side.x * 0.55, z: z + side.z * 0.55 }, Y + 0.5, Y, yaw, 'park bench'));
    const ba = a + Math.PI / 4;
    const bx = f.x + Math.cos(ba) * 8;
    const bz = f.z + Math.sin(ba) * 8;
    b.add(new THREE.CylinderGeometry(1.3, 1.4, 0.35, 16).translate(0, 0.17, 0), zm.castle, placement(bx, Y, bz), '#b8b0a2');
    b.add(new THREE.CylinderGeometry(1.2, 1.2, 0.05, 16), zm.paint, placement(bx, Y + 0.36, bz), '#4a3a2a');
    for (let i = 0; i < 14; i++) {
      const fa = rng() * Math.PI * 2;
      const fr = rng() * 1.05;
      b.add(new THREE.SphereGeometry(0.11, 6, 4), zm.paint, placement(bx + Math.cos(fa) * fr, Y + 0.48 + rng() * 0.12, bz + Math.sin(fa) * fr), ['#e8304a', '#f2c230', '#f07ad8', '#ffffff', '#9a5af0'][i % 5]);
    }
    cylinderCollider(physics, bx, Y, bz, 1.4, 0.35);
  }

  // The fireworks launcher: a rack of mortar tubes.
  const fw = TRIGGERS_BY_ID.get('town/fireworks')!;
  const rackZ = fw.z + 1.6;
  b.add(box(1.6, 0.5, 1.0, 1), zm.planks, placement(fw.x, Y + 0.25, rackZ), '#7a5432');
  for (let i = 0; i < 6; i++) b.add(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 10, 1, true).translate(0, 0.3, 0), zm.paint, placement(fw.x - 0.6 + (i % 3) * 0.6, Y + 0.5, rackZ - 0.25 + Math.floor(i / 3) * 0.5), ['#c8302a', '#2e5a8a', '#f2c230'][i % 3]);
  boxCollider(physics, IDENTITY, { x: fw.x, y: Y + 0.4, z: rackZ }, { x: 1.6, y: 0.8, z: 1.0 });
  game.activities.add(buttonActivity('town/fireworks'));
  onTrigger('town/fireworks', () => fireworks.show(new THREE.Vector3(fw.x, Y + 1, rackZ), 16, 50));

  const swings = buildPlayground(ctx, b);
  group.add(swings.group);
  buildPicnicTables(ctx, b);
  buildStreetFurniture(ctx, b);

  group.add(b.build('park'));
  return {
    id: 'town',
    group,
    update(view) {
      jets.update(view.time);
      swings.update(view.time);
    },
  };
}

/** A playground in the south of the park: swings that sway, a slide and a sandpit. */
function buildPlayground(ctx: ZoneContext, b: ChunkedBuilder): { group: THREE.Group; update(t: number): void } {
  const { physics, zm, m } = ctx;
  // Soft rubber ground under it all.
  b.add(box(30, 0.04, 12), zm.paint, placement(0, Y + 0.02, 34), '#8a4a3a', { castShadow: false });
  // The swing set: an A-frame each end and a bar across.
  const sx = -9;
  const sz = 34;
  for (const end of [-1, 1]) {
    for (const lean of [-1, 1]) b.add(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 8).rotateX(lean * 0.3), zm.paint, placement(sx + end * 2.6, Y + 1.33, sz + lean * 0.42), '#2e5a8a');
    cylinderCollider(physics, sx + end * 2.6, Y, sz, 0.3, 2.7);
  }
  b.add(new THREE.CylinderGeometry(0.06, 0.06, 5.4, 8).rotateZ(Math.PI / 2), zm.paint, placement(sx, Y + 2.65, sz), '#e8b030');
  const group = new THREE.Group();
  const swings: THREE.Group[] = [];
  for (const x of [-1.2, 1.2]) {
    const swing = new THREE.Group();
    swing.position.set(sx + x, Y + 2.6, sz);
    for (const side of [-0.25, 0.25]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.1, 4).translate(0, -1.05, 0), m.steel);
      chain.position.x = side;
      swing.add(chain);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.25), new THREE.MeshStandardMaterial({ color: '#c8302a', roughness: 0.6 }));
    seat.position.y = -2.1;
    seat.castShadow = true;
    swing.add(seat);
    group.add(swing);
    swings.push(swing);
    // You can sit on a swing (and it sways with you).
    zoneSeats.push({ id: `park/swing${x}`, position: new THREE.Vector3(sx + x, Y + 0.55, sz), yaw: 0, floorY: Y, label: 'swing' });
  }
  // A slide: a ladder up to a platform, and the chute down.
  const lx = 9;
  b.add(box(1.2, 0.1, 1.2), zm.paint, placement(lx, Y + 1.8, sz - 1.2), '#2fa86a');
  for (const [x, z] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) b.add(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6).translate(0, 0.9, 0), m.steel, placement(lx + x, Y, sz - 1.2 + z));
  for (let k = 0; k < 6; k++) b.add(box(0.8, 0.04, 0.06), m.steel, placement(lx, Y + 0.3 + k * 0.28, sz - 2.0));
  b.add(box(0.8, 0.06, 3.4), zm.paint, placement(lx, Y + 1.0, sz + 1.0, 0, 0.55), '#f2c230');
  for (const side of [-0.42, 0.42]) b.add(box(0.05, 0.25, 3.4), zm.paint, placement(lx + side, Y + 1.12, sz + 1.0, 0, 0.55), '#f2c230');
  boxCollider(physics, IDENTITY, { x: lx, y: Y + 0.9, z: sz - 1.2 }, { x: 1.2, y: 1.8, z: 1.2 });
  // A sandpit with a bucket.
  b.add(box(4, 0.25, 4, 1), zm.planks, placement(0, Y + 0.12, sz), '#a07850');
  b.add(box(3.6, 0.04, 3.6, 2), zm.sand, placement(0, Y + 0.24, sz), '#f0dcb0', { castShadow: false });
  b.add(new THREE.CylinderGeometry(0.12, 0.09, 0.2, 10).translate(0, 0.1, 0), zm.paint, placement(0.6, Y + 0.25, sz - 0.4), '#e8402a');
  return {
    group,
    update(t) {
      swings.forEach((s, i) => (s.rotation.x = Math.sin(t * 1.9 + i * 1.3) * 0.32));
    },
  };
}

/** Picnic tables on the park's grass, with benches either side to sit on. */
function buildPicnicTables(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, m } = ctx;
  for (const [x, z, yaw] of [[32, 12, 0], [32, -12, 0.3], [-32, 14, -0.2], [-31, -14, 0]] as const) {
    const M = placement(x, Y, z, yaw);
    b.add(box(0.9, 0.06, 2, 1), m.furnitureWood, M.clone().multiply(placement(0, 0.75, 0)), '#9a6a3a');
    for (const side of [-1, 1]) {
      b.add(box(0.3, 0.05, 2, 1), m.furnitureWood, M.clone().multiply(placement(side * 0.75, 0.45, 0)), '#9a6a3a');
      b.add(box(0.06, 0.75, 0.06), m.furnitureWood, M.clone().multiply(placement(side * 0.3, 0.37, 0)), '#6a4a2a');
      const sx = x + Math.cos(yaw) * side * 0.75;
      const sz = z - Math.sin(yaw) * side * 0.75;
      const along = { x: Math.sin(yaw), z: Math.cos(yaw) };
      zoneSeats.push(...benchSeats(`park/picnic${x}${z}${side}`, { x: sx - along.x * 0.6, z: sz - along.z * 0.6 }, { x: sx + along.x * 0.6, z: sz + along.z * 0.6 }, Y + 0.5, Y, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), 'picnic bench'));
    }
    boxCollider(physics, M, { x: 0, y: 0.4, z: 0 }, { x: 1.8, y: 0.8, z: 2 });
  }
}

/** Around town: fire hydrants by the sidewalks, and bus stops with shelters by the park. */
function buildStreetFurniture(ctx: ZoneContext, b: ChunkedBuilder): void {
  const { physics, zm, m } = ctx;
  const town = generateTown();
  const hydrant = new THREE.CylinderGeometry(0.13, 0.16, 0.7, 10).translate(0, 0.35, 0);
  const cap = new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.7, 0);
  const nozzle = new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8).rotateZ(Math.PI / 2).translate(0, 0.45, 0);
  lampPositions(town).forEach((lamp, i) => {
    if (i % 3) return;
    // Along the road from the lamp, toward the curb.
    const along = { x: Math.cos(lamp.yaw), z: -Math.sin(lamp.yaw) };
    const x = lamp.x + along.x * 3;
    const z = lamp.z + along.z * 3;
    for (const g of [hydrant, cap, nozzle]) b.add(g, zm.paint, placement(x, Y, z, lamp.yaw), '#d0302a');
    cylinderCollider(physics, x, Y, z, 0.18, 0.8);
  });
  // Bus stops on the streets either side of the park.
  for (const [x, z, yaw] of [[-20, -46.6, Math.PI], [20, 46.6, 0]] as const) {
    const M = placement(x, Y, z, yaw);
    b.add(box(3.6, 0.08, 1.5), m.darkMetal, M.clone().multiply(placement(0, 2.4, 0)));
    b.add(box(3.6, 2.3, 0.05), zm.glass, M.clone().multiply(placement(0, 1.2, -0.7)));
    for (const side of [-1, 1]) {
      b.add(box(0.05, 2.3, 1.4), zm.glass, M.clone().multiply(placement(side * 1.78, 1.2, 0)));
      b.add(box(0.08, 2.4, 0.08), m.darkMetal, M.clone().multiply(placement(side * 1.78, 1.2, -0.7)));
    }
    // An advert, lit from inside.
    b.add(box(1.2, 1.7, 0.06), zm.glow, M.clone().multiply(placement(1.15, 1.25, -0.66)), ['#2a9ad8', '#e8602a'][x > 0 ? 1 : 0]);
    b.add(box(2, 0.06, 0.45, 1), m.furnitureWood, M.clone().multiply(placement(-0.4, 0.47, -0.4)), '#8a5a32');
    boxCollider(physics, M, { x: 0, y: 1.2, z: -0.7 }, { x: 3.6, y: 2.4, z: 0.1 });
    const back = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const cx = x - back.x * 0.4 - side.x * 0.4;
    const cz = z - back.z * 0.4 - side.z * 0.4;
    zoneSeats.push(...benchSeats(`town/bus${x}`, { x: cx - side.x * 0.7, z: cz - side.z * 0.7 }, { x: cx + side.x * 0.7, z: cz + side.z * 0.7 }, Y + 0.5, Y, yaw, 'bus stop bench'));
    // The stop sign.
    b.add(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6).translate(0, 1.3, 0), m.darkMetal, placement(x + side.x * 2.4, Y, z + side.z * 2.4));
    b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16).rotateX(Math.PI / 2), zm.paint, placement(x + side.x * 2.4, Y + 2.6, z + side.z * 2.4, yaw), '#2a6ad8');
  }
}

/** A wooden park bench on iron legs, facing `yaw`. */
function bench(b: ChunkedBuilder, ctx: ZoneContext, x: number, z: number, yaw: number): void {
  const { m, physics } = ctx;
  const M = placement(x, Y, z, yaw);
  for (let s = 0; s < 3; s++) b.add(box(1.8, 0.05, 0.13, 1), m.furnitureWood, M.clone().multiply(placement(0, 0.45, -0.15 + s * 0.15)), '#8a5a32');
  for (let s = 0; s < 2; s++) b.add(box(1.8, 0.11, 0.04, 1), m.furnitureWood, M.clone().multiply(placement(0, 0.65 + s * 0.17, -0.27, 0, -0.2)), '#8a5a32');
  for (const lx of [-0.8, 0.8]) b.add(box(0.06, 0.45, 0.5), m.darkMetal, M.clone().multiply(placement(lx, 0.22, -0.05)));
  boxCollider(physics, M, { x: 0, y: 0.25, z: -0.05 }, { x: 1.8, y: 0.5, z: 0.5 });
}

/** Arcs of water from the fountain's top and its bowls, as streams of droplets. */
class FountainJets {
  readonly mesh: THREE.InstancedMesh;
  private drops: { a: number; speed: number; up: number; from: number; phase: number }[] = [];
  private m = new THREE.Matrix4();

  constructor(
    private x: number,
    private y: number,
    private z: number,
  ) {
    const material = new THREE.MeshStandardMaterial({ color: '#d8f0ff', roughness: 0.1, transparent: true, opacity: 0.75 });
    const count = 260;
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 5, 4), material, count);
    this.mesh.frustumCulled = false;
    const rng = mulberry32(202);
    for (let i = 0; i < count; i++) {
      const top = i < 100;
      this.drops.push({ a: rng() * Math.PI * 2, speed: top ? 0.6 + rng() * 0.3 : 0.35 + rng() * 0.2, up: top ? 2.6 : 0.6, from: top ? 3.6 : 1.62, phase: rng() });
    }
  }

  update(t: number): void {
    const g = 9.8;
    this.drops.forEach((d, i) => {
      // Each drop flies a short arc, over and over.
      const life = (2 * d.up) / g + 0.35;
      const age = ((t / life + d.phase) % 1) * life;
      const r = (d.from > 3 ? 0.1 : 1.3) + d.speed * age * 1.6;
      const h = d.from + d.up * age - 0.5 * g * age * age;
      if (h < 0.42) {
        this.m.makeScale(0, 0, 0);
      } else this.m.makeTranslation(this.x + Math.cos(d.a) * r, this.y + h, this.z + Math.sin(d.a) * r);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
