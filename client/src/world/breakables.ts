import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SMASH_REPAIR_SECONDS } from '../../../shared/protocol.ts';
import type { Target } from '../game/impacts.ts';
import { game } from '../game/link.ts';
import { effects } from './particles.ts';
import { box } from './town/meshBuilder.ts';
import type { TownMaterials } from './town/materials.ts';
import { ARM_LENGTH, LAMP_HEIGHT } from './town/props.ts';

export type BreakableKind = 'lamp' | 'hydrant' | 'mailbox' | 'bin' | 'fence' | 'hedge';

/** A street thing a car can knock over: what it is, and where (its base on the ground). */
export interface Placement {
  /** The same in every player's game, e.g. `lamp:12`, `bin:h7:1`, `fence:h3:0:2`. */
  id: string;
  kind: BreakableKind;
  matrix: THREE.Matrix4;
  /** For the parts painted per thing (a mailbox in its house's door color, a bin, a hedge). */
  color?: THREE.ColorRepresentation;
}

/** Street things, gathered while the town is built; `Breakables` draws them. */
export const breakablePlacements: Placement[] = [];

/** One drawn part of a kind of thing: its shape (around its base) and paint. */
interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Painted per thing (the placement's color), rather than one color for all. */
  tinted?: boolean;
  /** What it looks like once broken off, if different (a lamp's glass, unlit). */
  broken?: THREE.Material;
}

/** How a kind of thing looks and behaves when a car hits it. */
interface Kind {
  parts: Part[];
  /** Solid while standing (a car slower than `minSpeed` stops against it): a post `radius` wide, `height` tall. */
  solid: boolean;
  radius: number;
  height: number;
  minSpeed: number;
  mass: number;
  harm: number;
  /** Knocked off as one piece: a box this big (half sizes) around this point above its base, this heavy (kg). Null: crushed flat. */
  debris: { half: THREE.Vector3; center: THREE.Vector3; mass: number } | null;
  sound: 'clang' | 'crunch';
  /** Little bits that fly off (splinters, leaves). */
  bits?: THREE.Color[];
}

interface Item {
  placement: Placement;
  kind: Kind;
  /** Which copy in the kind's instanced parts. */
  index: number;
  base: THREE.Vector3;
  collider: RAPIER.Collider | null;
  broken: boolean;
  /** When it's put back (seconds, on our clock). */
  repairAt: number;
}

interface Debris {
  id: string;
  body: RAPIER.RigidBody;
  mesh: THREE.Group;
}

/** At most this many broken-off pieces lie about at once (the oldest are cleared away). */
const MAX_DEBRIS = 50;
/** Pieces this far from the camera are cleared away. */
const DEBRIS_RANGE = 160;
/** Things aren't put back while the camera is this close (no popping back in front of you). */
const REPAIR_UNSEEN = 45;
/** How long a knocked-off hydrant gushes (s). */
const GUSH_SECONDS = 25;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const WATER = new THREE.Color('#d8f0ff');

/** Bakes a color into every vertex (for materials that take per-piece colors), white by default. */
function painted(g: THREE.BufferGeometry, color: THREE.ColorRepresentation = '#ffffff'): THREE.BufferGeometry {
  const geometry = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geometry.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Several shapes as one. */
function merged(...parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  for (const p of list) for (const name of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(name)) p.deleteAttribute(name);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const size = list[0].getAttribute(name).itemSize;
    const total = list.reduce((n, p) => n + p.getAttribute(name).count, 0);
    const data = new Float32Array(total * size);
    let at = 0;
    for (const p of list) {
      data.set(p.getAttribute(name).array as Float32Array, at);
      at += p.getAttribute(name).count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  return out;
}

function kinds(m: TownMaterials): Record<BreakableKind, Kind> {
  const unlit = new THREE.MeshStandardMaterial({ color: '#8a8a80', roughness: 0.4 });
  const picket = (x: number) => box(0.08, 0.95, 0.03).translate(x, 0.475, 0.035);
  return {
    lamp: {
      parts: [
        { geometry: new THREE.CylinderGeometry(0.07, 0.11, LAMP_HEIGHT, 8).translate(0, LAMP_HEIGHT / 2, 0), material: m.darkMetal },
        { geometry: new THREE.CylinderGeometry(0.04, 0.05, ARM_LENGTH, 6).rotateX(Math.PI / 2).translate(0, LAMP_HEIGHT - 0.1, ARM_LENGTH / 2), material: m.darkMetal },
        { geometry: new THREE.BoxGeometry(0.35, 0.12, 0.6).translate(0, LAMP_HEIGHT - 0.2, ARM_LENGTH), material: m.lampGlow, broken: unlit },
      ],
      solid: true,
      radius: 0.15,
      height: LAMP_HEIGHT,
      // Snaps off at its base if hit at more than about 25 km/h.
      minSpeed: 7,
      mass: 350,
      harm: 0.25,
      debris: { half: new THREE.Vector3(0.12, LAMP_HEIGHT / 2, 0.12), center: new THREE.Vector3(0, LAMP_HEIGHT / 2, 0), mass: 120 },
      sound: 'clang',
      bits: [new THREE.Color('#fff2c0'), new THREE.Color('#cfd6dc')],
    },
    hydrant: {
      parts: [
        {
          geometry: painted(
            merged(
              new THREE.CylinderGeometry(0.13, 0.16, 0.7, 10).translate(0, 0.35, 0),
              new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.7, 0),
              new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8).rotateZ(Math.PI / 2).translate(0, 0.45, 0),
            ),
            '#d0302a',
          ),
          material: m.lacquer,
        },
      ],
      solid: true,
      radius: 0.2,
      height: 0.85,
      minSpeed: 3.5,
      mass: 150,
      harm: 0.15,
      debris: { half: new THREE.Vector3(0.17, 0.4, 0.17), center: new THREE.Vector3(0, 0.4, 0), mass: 60 },
      sound: 'clang',
    },
    mailbox: {
      parts: [
        { geometry: box(0.08, 1.05, 0.08).translate(0, 0.52, 0), material: m.darkMetal },
        { geometry: painted(new THREE.CapsuleGeometry(0.17, 0.32, 4, 10).rotateX(Math.PI / 2).translate(0, 1.15, 0)), material: m.door, tinted: true },
      ],
      solid: false,
      radius: 0.25,
      height: 1.35,
      minSpeed: 0.3,
      mass: 15,
      harm: 0.03,
      debris: { half: new THREE.Vector3(0.18, 0.66, 0.26), center: new THREE.Vector3(0, 0.66, 0), mass: 10 },
      sound: 'crunch',
    },
    bin: {
      parts: [
        { geometry: painted(box(0.55, 0.95, 0.6, 1).translate(0, 0.48, 0)), material: m.lacquer, tinted: true },
        { geometry: painted(box(0.6, 0.06, 0.66).translate(0, 0.98, 0), '#1e2a22'), material: m.lacquer },
      ],
      solid: false,
      radius: 0.35,
      height: 1.05,
      minSpeed: 0.3,
      mass: 25,
      harm: 0.02,
      debris: { half: new THREE.Vector3(0.3, 0.5, 0.33), center: new THREE.Vector3(0, 0.5, 0), mass: 15 },
      sound: 'crunch',
      bits: [new THREE.Color('#d8d0b0'), new THREE.Color('#8a7a5a'), new THREE.Color('#f0f0f0')],
    },
    // A metre of white picket fence (stretched a little to fit its run).
    fence: {
      parts: [
        {
          geometry: painted(merged(box(1, 0.08, 0.04).translate(0, 0.45, 0), box(1, 0.08, 0.04).translate(0, 0.8, 0), picket(-0.39), picket(-0.17), picket(0.05), picket(0.27)), '#f6f4ee'),
          material: m.lacquer,
        },
      ],
      solid: false,
      radius: 0.55,
      height: 1,
      minSpeed: 0.3,
      mass: 18,
      harm: 0.02,
      debris: { half: new THREE.Vector3(0.5, 0.48, 0.06), center: new THREE.Vector3(0, 0.48, 0), mass: 8 },
      sound: 'crunch',
      bits: [new THREE.Color('#f6f4ee'), new THREE.Color('#e0dcd0')],
    },
    // A metre of clipped hedge: crushed flat, in a burst of leaves.
    hedge: {
      parts: [{ geometry: painted(box(1, 0.9, 0.7, 1).translate(0, 0.45, 0)), material: m.hedge, tinted: true }],
      solid: false,
      radius: 0.6,
      height: 0.9,
      minSpeed: 0.3,
      mass: 90,
      harm: 0.02,
      debris: null,
      sound: 'crunch',
      bits: [new THREE.Color('#3f6a2e'), new THREE.Color('#5a8a3a'), new THREE.Color('#2e4e22')],
    },
  };
}

/**
 * Street lamps, fire hydrants, mailboxes, bins, picket fences and hedges that a car can
 * knock flying (and a hydrant gushes water). Each kind is drawn all at once; a smashed
 * one is hidden and a loose copy tumbles away with real physics. What's smashed is the
 * same for every player, and put back a few minutes later.
 */
export class Breakables {
  readonly group = new THREE.Group();
  private kinds: Record<BreakableKind, Kind>;
  private meshes = new Map<Kind, THREE.InstancedMesh[]>();
  private items: Item[] = [];
  private byId = new Map<string, Item>();
  private debris: Debris[] = [];
  private gushers: { at: THREE.Vector3; left: number; sound: number }[] = [];
  private tints = new Map<string, THREE.Material>();
  private time = 0;

  constructor(
    private physics: RAPIER.World,
    m: TownMaterials,
  ) {
    this.group.name = 'breakables';
    this.kinds = kinds(m);
    const counts = new Map<Kind, number>();
    for (const p of breakablePlacements) counts.set(this.kinds[p.kind], (counts.get(this.kinds[p.kind]) ?? 0) + 1);
    for (const [kind, count] of counts) {
      const meshes = kind.parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        return mesh;
      });
      this.meshes.set(kind, meshes);
    }
    const next = new Map<Kind, number>();
    const color = new THREE.Color();
    for (const placement of breakablePlacements) {
      const kind = this.kinds[placement.kind];
      const index = next.get(kind) ?? 0;
      next.set(kind, index + 1);
      const item: Item = { placement, kind, index, base: new THREE.Vector3().setFromMatrixPosition(placement.matrix), collider: null, broken: false, repairAt: 0 };
      kind.parts.forEach((part, k) => {
        const mesh = this.meshes.get(kind)![k];
        mesh.setMatrixAt(index, placement.matrix);
        if (part.tinted) mesh.setColorAt(index, color.set(placement.color ?? '#ffffff'));
      });
      this.stand(item);
      this.items.push(item);
      this.byId.set(placement.id, item);
      const target: Target = {
        at: (out) => (item.broken ? null : out.copy(item.base)),
        radius: kind.radius,
        height: kind.height,
        minSpeed: kind.minSpeed,
        mass: kind.mass,
        harm: kind.harm,
        hit: (car) => this.knock(item, flight(car, kind), true),
      };
      game.impacts.add(target);
    }
    for (const meshes of this.meshes.values()) for (const mesh of meshes) mesh.computeBoundingSphere();
  }

  /** Whether `id` is lying smashed (a broken street lamp gives no light). */
  isBroken(id: string): boolean {
    return this.byId.get(id)?.broken ?? false;
  }

  /** Another player's car smashed `id`, knocking it off at `v` (m/s). */
  smash(id: string, v: THREE.Vector3Like): void {
    const item = this.byId.get(id);
    if (item && !item.broken) this.knock(item, v, false);
  }

  /** Already smashed when we arrived, `ago` seconds ago: just missing until it's put back. */
  alreadySmashed(id: string, ago: number): void {
    const item = this.byId.get(id);
    if (!item || item.broken) return;
    this.hide(item, true);
    item.repairAt = this.time + SMASH_REPAIR_SECONDS - ago;
  }

  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    // Loose pieces follow their bodies; far-off ones are cleared away.
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      const t = d.body.translation();
      if (Math.hypot(t.x - camera.x, t.z - camera.z) > DEBRIS_RANGE || t.y < -50) {
        this.removeDebris(i);
        continue;
      }
      if (d.body.isSleeping()) continue;
      const r = d.body.rotation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    // Knocked-off hydrants gush.
    for (let i = this.gushers.length - 1; i >= 0; i--) {
      const g = this.gushers[i];
      g.left -= dt;
      if (g.left <= 0) {
        this.gushers.splice(i, 1);
        continue;
      }
      const near = g.at.distanceTo(camera) < 150;
      if (!near) continue;
      // A fine jet a few metres high, with mist blowing off its top.
      const strength = Math.min(1, g.left / 4);
      for (let k = 0; k < Math.ceil(dt * 260 * strength); k++) {
        const spread = 0.7;
        effects.water.emit(g.at, { x: (Math.random() - 0.5) * spread, y: (8 + Math.random() * 2.5) * strength, z: (Math.random() - 0.5) * spread }, WATER, 0.04 + Math.random() * 0.04, 1.9, 0.55);
      }
      if (Math.random() < dt * 10 * strength) {
        const top = { x: g.at.x + (Math.random() - 0.5), y: g.at.y + 3.5 * strength, z: g.at.z + (Math.random() - 0.5) };
        effects.smoke.emit(top, { x: (Math.random() - 0.5) * 1.5, y: 0.5, z: (Math.random() - 0.5) * 1.5 }, WATER, 0.6, 1.4, 0.25);
      }
      if ((g.sound -= dt) <= 0) {
        g.sound = 2.8;
        game.sounds?.gush(g.at);
      }
    }
    // Put things back, once nobody's looking.
    for (const item of this.items) {
      if (!item.broken || this.time < item.repairAt) continue;
      if (item.base.distanceTo(camera) < REPAIR_UNSEEN) {
        item.repairAt = this.time + 5;
        continue;
      }
      this.repair(item);
    }
  }

  /** Knocks `item` off at `v` (m/s): hidden, a loose copy flying, bits and noise. */
  private knock(item: Item, v: THREE.Vector3Like, mine: boolean): void {
    const { kind, placement } = item;
    this.hide(item, true);
    item.repairAt = this.time + SMASH_REPAIR_SECONDS;
    if (mine) game.smash(placement.id, v);
    const at = item.base;
    const speed = Math.hypot(v.x, v.z);
    if (kind.sound === 'clang') game.sounds?.clang(at);
    else game.sounds?.crunch(at);
    if (placement.kind === 'hydrant') {
      this.gushers.push({ at: at.clone().setY(at.y + 0.3), left: GUSH_SECONDS, sound: 0 });
      game.sounds?.gush(at);
    }
    if (kind.debris) this.addDebris(item, v);
    // A shower of splinters, leaves or glass.
    if (kind.bits) {
      const count = placement.kind === 'hedge' ? 70 : 24;
      for (let i = 0; i < count; i++) {
        const c = kind.bits[i % kind.bits.length];
        const p = { x: at.x + (Math.random() - 0.5) * kind.radius * 2, y: at.y + Math.random() * kind.height, z: at.z + (Math.random() - 0.5) * kind.radius * 2 };
        const k = 0.4 + Math.random() * 0.8;
        effects.bits.emit(p, { x: v.x * k + (Math.random() - 0.5) * 3, y: 1.5 + Math.random() * 3 + speed * 0.1, z: v.z * k + (Math.random() - 0.5) * 3 }, c, 0.06 + Math.random() * 0.07, 1.2 + Math.random());
      }
    }
  }

  /** A loose copy of `item` with a body of its own, thrown at `v`. */
  private addDebris(item: Item, v: THREE.Vector3Like): void {
    const { kind, placement } = item;
    const d = kind.debris!;
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    placement.matrix.decompose(position, rotation, scale);
    const center = d.center.clone().multiply(scale).applyQuaternion(rotation).add(position);
    const mesh = new THREE.Group();
    kind.parts.forEach((part) => {
      const material = part.broken ?? (part.tinted ? this.tint(part.material, placement.color ?? '#ffffff') : part.material);
      const piece = new THREE.Mesh(part.geometry, material);
      piece.position.copy(d.center).negate().multiply(scale);
      piece.scale.copy(scale);
      piece.castShadow = true;
      mesh.add(piece);
    });
    mesh.position.copy(center);
    mesh.quaternion.copy(rotation);
    this.group.add(mesh);
    // Tall things topple over the way they were pushed; small ones tumble every which way.
    const push = new THREE.Vector3(v.x, 0, v.z);
    const topple = new THREE.Vector3(0, 1, 0).cross(push).normalize().multiplyScalar(placement.kind === 'lamp' ? 1.2 : 2 + Math.random() * 4);
    const spin = placement.kind === 'lamp' ? topple : topple.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6));
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y, center.z)
        .setRotation(rotation)
        .setLinvel(v.x, v.y, v.z)
        .setAngvel(spin)
        .setLinearDamping(0.1)
        .setAngularDamping(0.3),
    );
    const half = d.half.clone().multiply(scale);
    this.physics.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(d.mass).setFriction(0.8).setRestitution(0.15), body);
    this.debris.push({ id: placement.id, body, mesh });
    if (this.debris.length > MAX_DEBRIS) this.removeDebris(0);
  }

  private removeDebris(i: number): void {
    const [d] = this.debris.splice(i, 1);
    this.physics.removeRigidBody(d.body);
    d.mesh.removeFromParent();
  }

  /** Puts `item` back where it was. */
  private repair(item: Item): void {
    for (let i = this.debris.length - 1; i >= 0; i--) if (this.debris[i].id === item.placement.id) this.removeDebris(i);
    this.hide(item, false);
  }

  /** Hides `item` (smashed) or shows it standing again, with its post solid if it has one. */
  private hide(item: Item, broken: boolean): void {
    item.broken = broken;
    const meshes = this.meshes.get(item.kind)!;
    for (const mesh of meshes) {
      mesh.setMatrixAt(item.index, broken ? HIDDEN : item.placement.matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (broken && item.collider) {
      this.physics.removeCollider(item.collider, true);
      item.collider = null;
    } else if (!broken) this.stand(item);
  }

  /** Gives a solid thing (a lamp post, a hydrant) its collider. */
  private stand(item: Item): void {
    const { kind, base } = item;
    if (!kind.solid || item.collider) return;
    item.collider = this.physics.createCollider(RAPIER.ColliderDesc.cylinder(kind.height / 2, kind.radius).setTranslation(base.x, base.y + kind.height / 2, base.z));
  }

  /** `material` painted `color` (for a loose piece, which isn't drawn with the others). */
  private tint(material: THREE.Material, color: THREE.ColorRepresentation): THREE.Material {
    const key = `${material.uuid}:${new THREE.Color(color).getHexString()}`;
    let tinted = this.tints.get(key);
    if (!tinted) {
      tinted = material.clone();
      (tinted as THREE.MeshStandardMaterial).color.set(color);
      this.tints.set(key, tinted);
    }
    return tinted;
  }
}

/** How a thing hit by a car at `car` (m/s) flies off: ahead, a little faster, and up (heavy things less). */
function flight(car: THREE.Vector3, kind: Kind): THREE.Vector3 {
  const speed = Math.hypot(car.x, car.z);
  const heavy = kind.mass > 100;
  const v = new THREE.Vector3(car.x, 0, car.z).multiplyScalar(heavy ? 0.55 : 1.1 + Math.random() * 0.3);
  v.applyAxisAngle(THREE.Object3D.DEFAULT_UP, (Math.random() - 0.5) * 0.5);
  v.y = heavy ? 0.5 + speed * 0.05 : 1.5 + speed * 0.18 + Math.random();
  return v;
}
