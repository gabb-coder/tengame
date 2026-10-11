import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { groundUnder, Limp, type Piece } from '../../game/limp.ts';
import { game } from '../../game/link.ts';
import { flingFrom } from '../../player/ragdoll.ts';
import type { Terrain } from '../terrain.ts';

// Animals built from simple shapes and animated procedurally: a creature is a tree of
// parts (body, neck segments, legs...) whose joints swing with its gait. Each part is
// one instanced mesh shared by the whole herd, so a herd costs a handful of draw calls.

export interface Part {
  /** Index of the part this hangs from; -1 for the root (the body). */
  parent: number;
  /** Joint position in the parent's frame. */
  offset: [number, number, number];
  geometry: THREE.BufferGeometry;
  color: string;
  /** Glowing (unlit) instead of shaded. */
  glow?: boolean;
  /** Stays fixed to its parent even when the animal goes limp (antlers, a mane, a beak). */
  rigid?: boolean;
}

export interface Species {
  parts: Part[];
  /**
   * Joint rotations [x, y, z] (radians) for each part. `phase` advances one cycle per
   * stride (or wingbeat); `t` is time in seconds; `i` tells animals apart.
   */
  pose(phase: number, t: number, i: number, out: [number, number, number][]): void;
  /** Meters traveled per gait cycle. */
  stride: number;
}

/** Where an animal is and which way it faces. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Nose up (+) or down (-), for swimmers and flyers. */
  pitch?: number;
  /** Banking in turns. */
  roll?: number;
}

/** Moves animal `i` at time `t`; returns false to hide it. */
export type Mover = (i: number, t: number, out: Placement) => boolean;

/** How big and heavy an animal is to a car (at its modeled size). */
export interface Bulk {
  /** How far it reaches around its feet, and how tall it is (m). */
  radius: number;
  height: number;
  /** kg */
  mass: number;
  /** Too big to knock over: the car bounces off it, and comes off worse. */
  big?: boolean;
}

/**
 * An animal knocked flying: thrown limp, lying where it fell, getting up, going back to its
 * herd. While getting up it blends from how it lay (`lay`, each part) to standing at `rest`.
 */
interface Knocked {
  limp: LimpAnimal | null;
  phase: 'fly' | 'down' | 'up' | 'back';
  t: number;
  yaw: number;
  rest: THREE.Vector3;
  lay: THREE.Matrix4[];
}

/** Seconds an animal lies still before getting up, and takes to get up. */
const LIE_SECONDS = 2.5;
const RISE_SECONDS = 1.2;

/** A piece of a limp animal: the part it moves (small parts fixed to it ride along). */
interface Chunk extends Piece {
  part: number;
}

const v3 = new THREE.Vector3();
const q4 = new THREE.Quaternion();
const s3 = new THREE.Vector3();
const UNIT = new THREE.Vector3(1, 1, 1);

/**
 * An animal gone limp, knocked flying by a car (see Limp): its body, neck, head, legs and
 * tail are pieces joined where each hangs from the next, drawn gently back toward the pose
 * it was in; small parts (antlers, a mane, a beak) ride along on theirs.
 */
class LimpAnimal extends Limp<Chunk> {
  /** For each part: the piece carrying it, and where it sits in that piece's frame. */
  private carriers: { piece: Chunk; offset: THREE.Matrix4 }[] = [];

  /** Builds it from where each part is drawn (`drawn`, world matrices at size `scale`), weighing `mass`, flung at `v`. */
  constructor(physics: RAPIER.World, species: Species, drawn: THREE.Matrix4[], private scale: number, mass: number, v: THREE.Vector3Like) {
    super(physics);
    const boxes = species.parts.map((part) => {
      if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
      return part.geometry.boundingBox!;
    });
    const volumes = boxes.map((box) => {
      const size = box.getSize(v3).multiplyScalar(scale);
      return Math.max(size.x, 0.02) * Math.max(size.y, 0.02) * Math.max(size.z, 0.02);
    });
    const total = volumes.reduce((sum, x) => sum + x, 0);
    const spin = (Math.random() * 2 - 1) * 2;
    const frames: THREE.Matrix4[] = [];
    species.parts.forEach((part, i) => {
      drawn[i].decompose(v3, q4, s3);
      const frame = new THREE.Matrix4().compose(v3, q4, UNIT);
      let carrier: { piece: Chunk; offset: THREE.Matrix4 };
      if (i === 0 || part.rigid) {
        // Fixed to the part it hangs from (or the middle of the body, for the body itself).
        if (i === 0) {
          carrier = { piece: this.addPiece(v3, q4, v, { x: 0, y: spin, z: 0 }, { part: i }), offset: new THREE.Matrix4() };
          frames.push(frame);
        } else {
          const parent = this.carriers[part.parent];
          const index = this.pieces.indexOf(parent.piece);
          carrier = { piece: parent.piece, offset: frames[index].clone().invert().multiply(frame) };
        }
      } else {
        const piece = this.addPiece(v3, q4, v, { x: 0, y: spin, z: 0 }, { part: i });
        frames.push(frame);
        carrier = { piece, offset: new THREE.Matrix4() };
        const parent = this.carriers[part.parent].piece;
        const pr = parent.body.rotation();
        // Measured from the pose it was in: legs and necks swing a fair way, twist a little.
        const f1 = new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w).invert().multiply(q4);
        this.ball(parent, piece, v3.clone(), f1, new THREE.Quaternion(), [[-0.8, 0.8], [-0.4, 0.4], [-0.5, 0.5]], 6);
      }
      this.carriers.push(carrier);
      // Its shape: the part's bounding box, placed on its piece; weight shared out by size.
      const box = boxes[i];
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
      const half = box.getSize(new THREE.Vector3()).multiplyScalar(scale / 2);
      const at = new THREE.Matrix4().makeTranslation(center).premultiply(carrier.offset);
      at.decompose(v3, q4, s3);
      const desc = RAPIER.ColliderDesc.cuboid(Math.max(half.x, 0.015), Math.max(half.y, 0.015), Math.max(half.z, 0.015)).setTranslation(v3.x, v3.y, v3.z).setRotation(q4.clone());
      this.addShape(carrier.piece, desc, Math.max(mass * (volumes[i] / total), mass * 0.03));
    });
  }

  /** Where each part is drawn now (world matrices). */
  pose(out: THREE.Matrix4[]): void {
    const size = v3.set(this.scale, this.scale, this.scale);
    this.carriers.forEach(({ piece, offset }, i) => {
      const t = piece.body.translation();
      const r = piece.body.rotation();
      out[i].compose(s3.set(t.x, t.y, t.z), q4.set(r.x, r.y, r.z, r.w), UNIT).multiply(offset).scale(size);
    });
  }

  /** Which way the body points (yaw, 0 = +Z), lying however it lies. */
  heading(fallback: number): number {
    const r = this.pieces[0].body.rotation();
    const forward = v3.set(0, 0, 1).applyQuaternion(q4.set(r.x, r.y, r.z, r.w));
    return Math.hypot(forward.x, forward.z) > 0.2 ? Math.atan2(forward.x, forward.z) : fallback;
  }
}

const shaded = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.78, metalness: 0 });
const glowing = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });

/** A group of animals of one species, drawn and animated together. */
export class Herd {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[];
  private rot: [number, number, number][];
  private world: THREE.Matrix4[];
  private local = new THREE.Matrix4();
  private joint = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private place: Placement = { x: 0, y: 0, z: 0, yaw: 0 };
  private travelled: number[];
  private last: { x: number; z: number }[];
  /** Where each animal is now, if shown (for cars to run into). */
  private where: THREE.Vector3[];
  private shownNow: boolean[];
  private knocked = new Map<number, Knocked>();
  private clock = NaN;
  /** The height of the ground under a point (set once animals can be knocked over). */
  private ground: (p: THREE.Vector3Like) => number = (p) => p.y;
  private middle = new THREE.Vector3();

  constructor(
    private species: Species,
    private count: number,
    private mover: Mover,
    /** Size of each animal (1 = as modeled). */
    private scales: number[] = [],
    /** Only animated within this distance of the camera. */
    private range = 350,
  ) {
    this.meshes = species.parts.map((p) => {
      const mesh = new THREE.InstancedMesh(p.geometry, p.glow ? glowing : shaded, count);
      const color = new THREE.Color(p.color);
      for (let i = 0; i < count; i++) mesh.setColorAt(i, color);
      mesh.castShadow = !p.glow;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
    this.rot = species.parts.map(() => [0, 0, 0]);
    this.world = species.parts.map(() => new THREE.Matrix4());
    this.travelled = Array.from({ length: count }, (_, i) => i * 3.7);
    this.last = Array.from({ length: count }, () => ({ x: NaN, z: NaN }));
    this.where = Array.from({ length: count }, () => new THREE.Vector3());
    this.shownNow = Array(count).fill(false);
  }

  /**
   * Lets cars run into these animals (`name` tells herds apart, for the other players):
   * small ones get knocked flying, big ones are a wall the car bounces off.
   */
  hittable(name: string, bulk: Bulk, physics: RAPIER.World, terrain: Terrain): void {
    for (let i = 0; i < this.count; i++) {
      const s = this.scales[i] ?? 1;
      const id = `npc:${name}-${i}`;
      const mass = bulk.mass * s ** 3;
      const knock = (v: THREE.Vector3Like) => {
        // Only one we can see (others are where nobody's looking).
        if (this.knocked.has(i) || !this.shownNow[i]) return;
        const drawn = this.meshes.map((mesh) => mesh.getMatrixAt(i, new THREE.Matrix4()));
        const limp = new LimpAnimal(physics, this.species, drawn, s, mass, v);
        this.knocked.set(i, { limp, phase: 'fly', t: 0, yaw: 0, rest: new THREE.Vector3(), lay: drawn });
        game.sounds?.thud(this.where[i], Math.min(1, Math.hypot(v.x, v.y, v.z) / 15));
      };
      this.ground = (p) => groundUnder(physics, p, (x, z) => terrain.heightAt(x, z));
      game.knockables.set(id, knock);
      game.impacts.addMoving({
        at: (out) => (this.shownNow[i] && !this.knocked.has(i) ? out.copy(this.where[i]) : null),
        radius: bulk.radius * s,
        height: bulk.height * s,
        minSpeed: bulk.big ? 0.5 : 1.2,
        mass: bulk.big ? Math.max(mass, 20000) : mass,
        harm: bulk.big ? 0.4 : Math.min(0.2, mass / 2500),
        solid: bulk.big,
        hit: (car) => {
          if (bulk.big) {
            game.sounds?.thud(this.where[i], 1);
            return;
          }
          const v = flingFrom(car).multiplyScalar(Math.min(1, 120 / mass));
          knock(v);
          game.knock(id, v);
        },
      });
    }
  }

  /**
   * A knocked-over animal: thrown limp, lying there, getting up, then rejoining its herd.
   * Returns true if it's been drawn here (limp or getting up); otherwise `place` is where
   * to draw it standing.
   */
  private carry(k: Knocked, place: Placement, dt: number, i: number, camera: THREE.Vector3): boolean {
    k.t += dt;
    const s = this.scales[i] ?? 1;
    if (k.limp) {
      const hard = k.limp.takeImpact();
      const middle = k.limp.hips(this.middle);
      if (hard > 0.25) game.sounds?.thud(middle, hard * 0.5);
      if (k.phase === 'fly' && k.limp.resting) {
        k.phase = 'down';
        k.t = 0;
      }
      k.limp.pose(k.lay);
      this.where[i].copy(middle);
      if (k.phase === 'down' && k.t > LIE_SECONDS) {
        // Up from where it lies, facing the way its body points.
        k.yaw = k.limp.heading(place.yaw);
        k.rest.set(middle.x, 0, middle.z);
        k.rest.y = this.ground(k.rest.setY(middle.y));
        k.limp.dispose();
        k.limp = null;
        k.phase = 'up';
        k.t = 0;
      } else {
        this.draw(i, (middle.x - camera.x) ** 2 + (middle.z - camera.z) ** 2 <= this.range ** 2 ? k.lay : null);
        return true;
      }
    }
    if (k.phase === 'up') {
      // Rolls up and stands: blends from how it lay to standing where it got up.
      const w = THREE.MathUtils.smootherstep(k.t, 0, RISE_SECONDS);
      Object.assign(place, { x: k.rest.x, y: k.rest.y, z: k.rest.z, yaw: k.yaw, pitch: 0, roll: 0 });
      this.where[i].copy(k.rest);
      if (k.t >= RISE_SECONDS) {
        k.phase = 'back';
        k.t = 0;
        return false;
      }
      const near = (k.rest.x - camera.x) ** 2 + (k.rest.z - camera.z) ** 2 <= this.range ** 2;
      if (!near) {
        this.draw(i, null);
        return true;
      }
      this.posed(i, place, s);
      this.world.forEach((standing, p) => {
        k.lay[p].decompose(v3, q4, s3);
        const from = { p: v3.clone(), q: q4.clone() };
        standing.decompose(v3, q4, s3);
        standing.compose(from.p.lerp(v3, w), from.q.slerp(q4, w), s3);
      });
      this.draw(i, this.world);
      return true;
    }
    // Back where the herd would have it, over a few seconds.
    const w = THREE.MathUtils.smoothstep(k.t, 0, 3);
    place.x = THREE.MathUtils.lerp(k.rest.x, place.x, w);
    place.y = THREE.MathUtils.lerp(k.rest.y, place.y, w);
    place.z = THREE.MathUtils.lerp(k.rest.z, place.z, w);
    place.yaw = k.yaw + Math.atan2(Math.sin(place.yaw - k.yaw), Math.cos(place.yaw - k.yaw)) * w;
    if (k.t >= 3) this.knocked.delete(i);
    return false;
  }

  /**
   * Where animal `i` is at time `t`, and how big: for riding one. Returns false if it's
   * hidden. `scale` is the size it's drawn at.
   */
  placementOf(i: number, t: number, out: Placement): { visible: boolean; scale: number } {
    return { visible: this.mover(i, t, out), scale: this.scales[i] ?? 1 };
  }

  /** Tints one animal's part (e.g. a parrot's wings). */
  tint(animal: number, part: number, color: THREE.ColorRepresentation): void {
    this.meshes[part].setColorAt(animal, new THREE.Color(color));
    this.meshes[part].instanceColor!.needsUpdate = true;
  }

  update(t: number, camera: THREE.Vector3): void {
    const { species, place } = this;
    const dt = Number.isNaN(this.clock) ? 0 : Math.min(0.1, Math.max(0, t - this.clock));
    this.clock = t;
    let shown = 0;
    for (let i = 0; i < this.count; i++) {
      const visible = this.mover(i, t, place);
      const knocked = this.knocked.get(i);
      if (knocked && this.carry(knocked, place, dt, i, camera)) {
        if (this.shownNow[i]) shown++;
        this.last[i].x = NaN;
        continue;
      }
      const far = (place.x - camera.x) ** 2 + (place.z - camera.z) ** 2 > this.range ** 2;
      if (!visible || far) {
        this.draw(i, null);
        this.last[i].x = NaN;
        continue;
      }
      shown++;
      this.where[i].set(place.x, place.y, place.z);
      // Gait follows the distance actually covered, so feet don't slide.
      const l = this.last[i];
      if (!Number.isNaN(l.x)) this.travelled[i] += Math.hypot(place.x - l.x, place.z - l.z);
      l.x = place.x;
      l.z = place.z;
      const s = this.scales[i] ?? 1;
      species.pose(this.travelled[i] / (species.stride * s), t, i, this.rot);
      this.posed(i, place, s);
      this.draw(i, this.world);
    }
    // Send the new poses to the GPU, unless they're all still hidden.
    if (shown > 0 || this.group.visible) for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
    this.group.visible = shown > 0;
  }

  /** Works out each part's world matrix (into `world`) for an animal at `place`, size `s`, in the pose in `rot`. */
  private posed(i: number, place: Placement, s: number): void {
    const { species } = this;
    if (this.knocked.get(i)?.phase === 'up') species.pose(this.travelled[i] / (species.stride * s), this.clock, i, this.rot);
    this.e.set(place.pitch ?? 0, place.yaw, place.roll ?? 0, 'YXZ');
    const root = this.local.compose(this.v.set(place.x, place.y, place.z), this.q.setFromEuler(this.e), this.one.set(s, s, s));
    species.parts.forEach((part, p) => {
      const r = this.rot[p];
      this.e.set(r[0], r[1], r[2], 'YXZ');
      const joint = this.joint.compose(this.v.set(...part.offset), this.q.setFromEuler(this.e), this.one.set(1, 1, 1));
      this.world[p].multiplyMatrices(part.parent < 0 ? root : this.world[part.parent], joint);
    });
  }

  /** Draws animal `i` with these part matrices, or hides it (null). */
  private draw(i: number, parts: THREE.Matrix4[] | null): void {
    this.shownNow[i] = parts !== null;
    this.meshes.forEach((mesh, p) => mesh.setMatrixAt(i, parts ? parts[p] : ZERO));
  }
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------------------------------------------------------------------------
// Movers.

/** A closed path through points, walked at `speed`; animals spread out along it. */
export function loopMover(points: [number, number][], speed: number, terrain: Terrain, opts: { spacing?: number; spread?: number; height?: number; bob?: number } = {}): Mover {
  const pts = points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const length = curve.getLength();
  const p = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  return (i, t, out) => {
    const s = (t * speed + i * (opts.spacing ?? 9)) % length;
    curve.getPointAt(((s + length) % length) / length, p);
    curve.getPointAt(((s + 1 + length) % length) / length, ahead);
    // Herd members walk side by side, not in single file.
    const side = ((i % 3) - 1) * (opts.spread ?? 0);
    const dx = ahead.x - p.x;
    const dz = ahead.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    out.x = p.x + (-dz / len) * side;
    out.z = p.z + (dx / len) * side;
    out.yaw = Math.atan2(dx, dz);
    const ground = terrain.heightAt(out.x, out.z);
    out.y = opts.height !== undefined ? Math.max(ground + 2, opts.height) + Math.sin(t * 0.8 + i) * (opts.bob ?? 0) : ground;
    out.pitch = 0;
    out.roll = 0;
    return true;
  };
}

/** Circling flight around (x, z) at `height` above the ground, banking into the turn. */
export function circleMover(x: number, z: number, radius: number, height: number, speed: number, terrain: Terrain | null, opts: { wobble?: number; absolute?: boolean } = {}): Mover {
  return (i, t, out) => {
    const r = radius * (1 + 0.25 * Math.sin(i * 2.1 + t * 0.07));
    const a = (t * speed) / r + i * 2.4;
    const dir = i % 2 ? 1 : -1;
    const ang = a * dir;
    out.x = x + Math.cos(ang) * r + Math.sin(t * 0.3 + i) * (opts.wobble ?? 0);
    out.z = z + Math.sin(ang) * r;
    const base = opts.absolute || !terrain ? 0 : terrain.heightAt(out.x, out.z);
    out.y = base + height + Math.sin(t * 0.5 + i * 1.7) * 3;
    // Heading along the circle.
    out.yaw = Math.atan2(-Math.sin(ang) * dir, Math.cos(ang) * dir);
    out.pitch = Math.cos(t * 0.5 + i * 1.7) * 0.08;
    out.roll = -0.3 * dir;
    return true;
  };
}

// ---------------------------------------------------------------------------
// Shapes for parts.

/** An ellipsoid with radii (x, y, z), centered at (cx, cy, cz). */
export function blob(rx: number, ry: number, rz: number, cx = 0, cy = 0, cz = 0, segments = 14): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, segments, Math.max(6, segments / 2)).scale(rx, ry, rz).translate(cx, cy, cz);
}

/** A tapered tube along +Z (or -Z if `len` is negative), from radius r0 to r1. */
export function tube(r0: number, r1: number, len: number, segments = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, Math.abs(len), segments, 1).rotateX(Math.PI / 2);
  return g.translate(0, 0, len / 2);
}

/** A leg hanging straight down from its joint, tapering from r0 to r1. */
export function leg(r0: number, r1: number, len: number, segments = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r0, r1, len, segments).translate(0, -len / 2, 0);
}

/** A cone pointing along +Z (horns, beaks, teeth). */
export function spike(r: number, len: number, segments = 8): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r, len, segments).rotateX(Math.PI / 2).translate(0, 0, len / 2);
}

/** A flat wing panel reaching out along +X (mirrored for the left wing). */
export function wing(span: number, chord: number, tipChord: number, left = false): THREE.BufferGeometry {
  const s = left ? -1 : 1;
  const shape = [
    [0, chord / 2],
    [s * span, tipChord / 2],
    [s * span * 1.02, -tipChord / 2],
    [s * span * 0.4, -chord * 0.7],
    [0, -chord / 2],
  ];
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  for (let i = 1; i < shape.length - 1; i++) {
    for (const k of [0, i, i + 1]) pos.push(shape[k][0], 0, shape[k][1]);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const sin = Math.sin;

// ---------------------------------------------------------------------------
// Species.

/** Long-necked plant eater (Brachiosaurus-like), about 12 m tall. */
export function sauropod(color = '#6f7a5e'): Species {
  const parts: Part[] = [{ parent: -1, offset: [0, 5.4, 0], geometry: blob(1.7, 2, 3.6), color }];
  // Neck: five segments climbing forward.
  let prev = 0;
  for (let k = 0; k < 5; k++) {
    parts.push({ parent: prev, offset: k === 0 ? [0, 0.9, 2.7] : [0, 0, 1.9], geometry: tube(0.8 - k * 0.1, 0.7 - k * 0.1, 2.1), color });
    prev = parts.length - 1;
  }
  parts.push({ parent: prev, offset: [0, 0, 1.9], geometry: blob(0.38, 0.42, 0.85, 0, 0.1, 0.5), color });
  // Tail: six segments, thinning.
  prev = 0;
  for (let k = 0; k < 6; k++) {
    parts.push({ parent: prev, offset: k === 0 ? [0, 0.3, -3.3] : [0, 0, -1.8], geometry: tube(0.85 - k * 0.13, 0.72 - k * 0.12, -1.95), color });
    prev = parts.length - 1;
  }
  const legStart = parts.length;
  for (const [x, z] of [[1, 2], [-1, 2], [1, -2], [-1, -2]]) parts.push({ parent: 0, offset: [x, -0.8, z], geometry: leg(0.62, 0.5, 4.7), color });
  return {
    parts,
    stride: 4.2,
    pose(phase, t, i, out) {
      const a = phase * Math.PI * 2;
      for (let k = 1; k <= 5; k++) out[k] = [k === 1 ? -0.95 : 0.1, sin(t * 0.4 + i + k * 0.3) * 0.05, 0];
      out[6] = [0.5 + sin(t * 0.7 + i) * 0.1, 0, 0];
      for (let k = 7; k <= 12; k++) out[k] = [k === 7 ? -0.25 : 0.06, sin(t * 0.9 + i + k * 0.5) * 0.06, 0];
      [0, Math.PI, Math.PI, 0].forEach((off, k) => (out[legStart + k] = [sin(a + off) * 0.22, 0, 0]));
      out[0] = [0, 0, sin(a * 2) * 0.015];
    },
  };
}

/** A big two-legged hunter (Tyrannosaurus-like), about 4 m at the hip. */
export function theropod(color = '#5d5340', belly = '#8a7a5a'): Species {
  const parts: Part[] = [
    { parent: -1, offset: [0, 3.4, 0], geometry: blob(0.95, 1.15, 2.3, 0, 0, 0.2), color }, // 0 body
    { parent: 0, offset: [0, 0.6, 2.1], geometry: tube(0.65, 0.55, 1.1), color }, // 1 neck
    { parent: 1, offset: [0, 0.1, 1.0], geometry: blob(0.55, 0.62, 1.15, 0, 0.1, 0.8), color }, // 2 skull
    { parent: 2, offset: [0, -0.25, 0.2], geometry: blob(0.45, 0.2, 1.0, 0, -0.1, 0.7), color: belly, rigid: true }, // 3 jaw
  ];
  let prev = 0;
  for (let k = 0; k < 5; k++) {
    parts.push({ parent: prev, offset: k === 0 ? [0, 0.1, -2.0] : [0, 0, -1.5], geometry: tube(0.75 - k * 0.14, 0.6 - k * 0.12, -1.6), color });
    prev = parts.length - 1;
  }
  const legs = parts.length;
  for (const x of [0.75, -0.75]) {
    parts.push({ parent: 0, offset: [x, -0.3, 0.1], geometry: blob(0.42, 1.0, 0.6, 0, -0.8, 0.1), color }); // thigh
    parts.push({ parent: parts.length - 1, offset: [0, -1.6, 0.15], geometry: leg(0.25, 0.18, 1.6), color }); // shin
    parts.push({ parent: parts.length - 1, offset: [0, -1.6, 0], geometry: blob(0.22, 0.12, 0.5, 0, 0, 0.25), color }); // foot
  }
  const arms = parts.length;
  for (const x of [0.6, -0.6]) parts.push({ parent: 0, offset: [x, -0.1, 1.9], geometry: leg(0.1, 0.07, 0.7), color });
  return {
    parts,
    stride: 3.2,
    pose(phase, t, i, out) {
      const a = phase * Math.PI * 2;
      out[0] = [0.05 + sin(a * 2) * 0.03, sin(a) * 0.04, 0];
      out[1] = [-0.25, sin(t * 0.6 + i) * 0.1, 0];
      out[2] = [0.25, 0, 0];
      // Now and then, a roar.
      const roar = Math.max(0, sin(t * 0.35 + i * 2)) ** 8;
      out[3] = [0.08 + roar * 0.6, 0, 0];
      for (let k = 4; k < legs; k++) out[k] = [k === 4 ? -0.1 : 0.05, sin(a + k * 0.6) * 0.1, 0];
      for (let s = 0; s < 2; s++) {
        const swing = sin(a + s * Math.PI);
        out[legs + s * 3] = [swing * 0.5, 0, 0];
        out[legs + s * 3 + 1] = [Math.max(0, -swing) * 0.6 + 0.1, 0, 0];
        out[legs + s * 3 + 2] = [-swing * 0.3, 0, 0];
      }
      out[arms] = out[arms + 1] = [-0.6 + sin(t * 2 + i) * 0.1, 0, 0];
    },
  };
}

/** A three-horned plant eater (Triceratops-like). */
export function ceratopsian(color = '#7a6a4a', frill = '#a8573a'): Species {
  const parts: Part[] = [
    { parent: -1, offset: [0, 1.9, 0], geometry: blob(1.25, 1.15, 2.5), color },
    { parent: 0, offset: [0, 0.1, 2.3], geometry: blob(0.75, 0.75, 1.1, 0, -0.1, 0.6), color }, // head
    { parent: 1, offset: [0, 0.4, 0.1], geometry: new THREE.CylinderGeometry(1.35, 1.35, 0.15, 18).rotateX(Math.PI / 2 - 0.5), color: frill }, // frill
    { parent: 1, offset: [0.35, 0.45, 0.8], geometry: spike(0.12, 1.1), color: '#e8dcc0' },
    { parent: 1, offset: [-0.35, 0.45, 0.8], geometry: spike(0.12, 1.1), color: '#e8dcc0' },
    { parent: 1, offset: [0, -0.05, 1.5], geometry: spike(0.1, 0.5), color: '#e8dcc0' },
    { parent: 0, offset: [0, 0.2, -2.3], geometry: tube(0.6, 0.15, -2.2), color }, // tail
  ];
  const legs = parts.length;
  for (const [x, z] of [[0.9, 1.4], [-0.9, 1.4], [0.9, -1.4], [-0.9, -1.4]]) parts.push({ parent: 0, offset: [x, -0.6, z], geometry: leg(0.4, 0.32, 1.4), color });
  return {
    parts,
    stride: 2.4,
    pose(phase, t, i, out) {
      const a = phase * Math.PI * 2;
      out[1] = [0.15 + sin(t * 0.8 + i) * 0.08, sin(t * 0.5 + i) * 0.1, 0];
      out[3] = out[4] = [-0.45, 0, 0];
      out[5] = [-0.2, 0, 0];
      out[6] = [-0.15, sin(a) * 0.15, 0];
      [0, Math.PI, Math.PI, 0].forEach((off, k) => (out[legs + k] = [sin(a + off) * 0.35, 0, 0]));
    },
  };
}

/** A woolly mammoth: shaggy, humped, with a swinging trunk and curved tusks. */
export function mammoth(color = '#6a4a32'): Species {
  const tusk = new THREE.TorusGeometry(1.0, 0.09, 6, 12, Math.PI * 0.9).rotateY(Math.PI / 2).rotateX(Math.PI / 2 + 0.3);
  const parts: Part[] = [
    { parent: -1, offset: [0, 2.9, 0], geometry: blob(1.55, 1.75, 2.4, 0, 0.1, 0), color },
    { parent: 0, offset: [0, 1.5, 0.9], geometry: blob(1.0, 0.7, 1.0), color }, // hump
    { parent: 0, offset: [0, 0.7, 2.2], geometry: blob(0.95, 1.05, 0.95, 0, 0, 0.35), color }, // head
    { parent: 2, offset: [0.8, 0.2, 0.2], geometry: blob(0.12, 0.55, 0.45), color }, // ears
    { parent: 2, offset: [-0.8, 0.2, 0.2], geometry: blob(0.12, 0.55, 0.45), color },
    { parent: 2, offset: [0.35, -0.5, 0.8], geometry: tusk, color: '#efe6d0' },
    { parent: 2, offset: [-0.35, -0.5, 0.8], geometry: tusk.clone().scale(-1, 1, 1), color: '#efe6d0' },
  ];
  // Trunk: four segments hanging and curling.
  let prev = 2;
  for (let k = 0; k < 4; k++) {
    parts.push({ parent: prev, offset: k === 0 ? [0, -0.3, 1.1] : [0, -0.55, 0], geometry: leg(0.28 - k * 0.04, 0.24 - k * 0.04, 0.6), color });
    prev = parts.length - 1;
  }
  const legs = parts.length;
  for (const [x, z] of [[0.85, 1.3], [-0.85, 1.3], [0.85, -1.3], [-0.85, -1.3]]) parts.push({ parent: 0, offset: [x, -0.9, z], geometry: leg(0.5, 0.42, 2.0), color });
  parts.push({ parent: 0, offset: [0, 0.3, -2.3], geometry: leg(0.1, 0.06, 1.0), color });
  return {
    parts,
    stride: 3,
    pose(phase, t, i, out) {
      const a = phase * Math.PI * 2;
      out[2] = [0.1 + sin(t * 0.6 + i) * 0.05, sin(t * 0.4 + i) * 0.08, 0];
      out[3] = [0, 0, -0.2 + sin(t * 1.5 + i) * 0.15];
      out[4] = [0, 0, 0.2 - sin(t * 1.5 + i) * 0.15];
      for (let k = 0; k < 4; k++) out[7 + k] = [0.12 + k * 0.12 + sin(t * 1.2 + i + k) * 0.12, sin(t * 0.9 + i) * 0.08, 0];
      [0, Math.PI, Math.PI, 0].forEach((off, k) => (out[legs + k] = [sin(a + off) * 0.28, 0, 0]));
      out[legs + 4] = [0.3, sin(t * 3 + i) * 0.4, 0];
    },
  };
}

/**
 * Something with flapping wings: birds, pterosaurs, dragons. `body` and wings scale with
 * `size`; `beat` is wingbeats per second.
 */
export function flyer(opts: { size: number; body: string; wing: string; beat: number; long?: boolean; dragon?: boolean }): Species {
  const s = opts.size;
  const parts: Part[] = [
    { parent: -1, offset: [0, 0, 0], geometry: blob(0.25 * s, 0.22 * s, 0.7 * s), color: opts.body },
    { parent: 0, offset: [0, 0.1 * s, 0.6 * s], geometry: blob(0.17 * s, 0.17 * s, 0.25 * s, 0, 0, 0.12 * s), color: opts.body }, // head
    { parent: 1, offset: [0, 0, 0.3 * s], geometry: spike(0.07 * s, (opts.long ? 0.9 : 0.25) * s), color: opts.dragon ? opts.body : '#e8b84a' }, // beak / snout
    { parent: 0, offset: [0.18 * s, 0.05 * s, 0.1 * s], geometry: wing(1.2 * s, 0.8 * s, 0.35 * s), color: opts.wing },
    { parent: 3, offset: [1.2 * s, 0, 0], geometry: wing(1.1 * s, 0.35 * s, 0.1 * s), color: opts.wing },
    { parent: 0, offset: [-0.18 * s, 0.05 * s, 0.1 * s], geometry: wing(1.2 * s, 0.8 * s, 0.35 * s, true), color: opts.wing },
    { parent: 5, offset: [-1.2 * s, 0, 0], geometry: wing(1.1 * s, 0.35 * s, 0.1 * s, true), color: opts.wing },
    { parent: 0, offset: [0, 0, -0.6 * s], geometry: opts.dragon ? tube(0.18 * s, 0.03 * s, -2.2 * s) : wing(0.25 * s, 0.1 * s, 0.4 * s), color: opts.dragon ? opts.body : opts.wing }, // tail
  ];
  if (opts.dragon) {
    // Horns and a long neck look.
    parts.push({ parent: 1, offset: [0.08 * s, 0.12 * s, -0.05 * s], geometry: spike(0.04 * s, 0.35 * s).rotateX(-2.4), color: '#d8c8a0' });
    parts.push({ parent: 1, offset: [-0.08 * s, 0.12 * s, -0.05 * s], geometry: spike(0.04 * s, 0.35 * s).rotateX(-2.4), color: '#d8c8a0' });
  }
  return {
    parts,
    stride: 1e9,
    pose(_phase, t, i, out) {
      const flap = sin(t * opts.beat * Math.PI * 2 + i * 1.3);
      out[3] = [0, 0, flap * 0.55];
      out[4] = [0, 0, flap * 0.35];
      out[5] = [0, 0, -flap * 0.55];
      out[6] = [0, 0, -flap * 0.35];
      out[1] = [0, sin(t * 0.7 + i) * 0.2, 0];
      out[7] = [0, sin(t * 1.4 + i) * 0.15, 0];
      out[0] = [-flap * 0.04, 0, 0];
    },
  };
}

/** A four-legged grazer: reindeer (antlers) or camel (hump, long neck). */
export function grazer(kind: 'reindeer' | 'camel', color: string): Species {
  const camel = kind === 'camel';
  const parts: Part[] = [
    { parent: -1, offset: [0, camel ? 1.9 : 1.15, 0], geometry: blob(camel ? 0.5 : 0.42, camel ? 0.55 : 0.45, camel ? 1.15 : 0.9), color },
    { parent: 0, offset: [0, 0.25, camel ? 1.0 : 0.75], geometry: tube(camel ? 0.2 : 0.18, camel ? 0.14 : 0.14, camel ? 1.3 : 0.7), color }, // neck
    { parent: 1, offset: [0, 0, camel ? 1.25 : 0.65], geometry: blob(0.17, 0.2, camel ? 0.4 : 0.32, 0, 0, 0.18), color }, // head
  ];
  if (camel) parts.push({ parent: 0, offset: [0, 0.55, -0.1], geometry: blob(0.38, 0.45, 0.5), color, rigid: true });
  else {
    const antler = new THREE.CylinderGeometry(0.025, 0.04, 0.8, 5).translate(0, 0.4, 0);
    const tine = new THREE.CylinderGeometry(0.02, 0.03, 0.35, 5).translate(0, 0.17, 0).rotateZ(0.8).translate(0, 0.45, 0);
    const branch = new THREE.BufferGeometry();
    const merged = [antler, tine].map((g) => g.toNonIndexed());
    branch.setAttribute('position', new THREE.Float32BufferAttribute([...merged[0].attributes.position.array, ...merged[1].attributes.position.array], 3));
    branch.computeVertexNormals();
    parts.push({ parent: 2, offset: [0.1, 0.15, 0], geometry: branch.clone().rotateZ(-0.5).rotateX(-0.3), color: '#d8c8a8', rigid: true });
    parts.push({ parent: 2, offset: [-0.1, 0.15, 0], geometry: branch.clone().rotateZ(0.5).rotateX(-0.3), color: '#d8c8a8', rigid: true });
  }
  const legs = parts.length;
  const h = camel ? 1.75 : 0.95;
  for (const [x, z] of [[0.25, 0.65], [-0.25, 0.65], [0.25, -0.65], [-0.25, -0.65]]) parts.push({ parent: 0, offset: [x, -0.2, z * (camel ? 1.1 : 1)], geometry: leg(0.07, 0.05, h), color });
  return {
    parts,
    stride: camel ? 2.2 : 1.6,
    pose(phase, t, i, out) {
      const a = phase * Math.PI * 2;
      // Grazers lower their heads to eat now and then.
      const graze = Math.max(0, sin(t * 0.2 + i * 1.9)) ** 4;
      out[1] = [camel ? -0.7 + graze * 1.2 : -0.6 + graze * 1.5, 0, 0];
      out[2] = [camel ? 0.75 : 0.5, sin(t * 0.6 + i) * 0.1, 0];
      [0, Math.PI, Math.PI, 0].forEach((off, k) => (out[legs + k] = [sin(a + off) * 0.4, 0, 0]));
    },
  };
}

/** A sled dog (husky) or a horse: four legs, a long head, a wagging tail, at a run. */
export function runner(kind: 'husky' | 'horse', color: string, mane = '#2a2220'): Species {
  const horse = kind === 'horse';
  const s = horse ? 1 : 0.42;
  const parts: Part[] = [
    { parent: -1, offset: [0, 1.25 * s, 0], geometry: blob(0.36 * s, 0.4 * s, 0.95 * s), color }, // 0 body
    { parent: 0, offset: [0, 0.3 * s, 0.8 * s], geometry: tube(0.2 * s, 0.14 * s, 0.75 * s), color }, // 1 neck
    { parent: 1, offset: [0, 0, 0.72 * s], geometry: blob(0.13 * s, 0.15 * s, 0.34 * s, 0, 0, 0.16 * s), color }, // 2 head
    { parent: 0, offset: [0, 0.1 * s, -0.9 * s], geometry: tube(0.07 * s, 0.03 * s, horse ? -0.8 : -0.5 * s * 2.2), color: horse ? mane : color }, // 3 tail
  ];
  // Ears (husky) or a mane (horse).
  if (horse) parts.push({ parent: 1, offset: [0, 0.1, 0.25], geometry: blob(0.035, 0.08, 0.36, 0, 0, 0.1), color: mane, rigid: true });
  else for (const x of [-0.05, 0.05]) parts.push({ parent: 2, offset: [x, 0.08, 0.02], geometry: spike(0.03, 0.09).rotateX(-Math.PI / 2), color, rigid: true });
  const legs = parts.length;
  for (const [x, z] of [[0.18, 0.62], [-0.18, 0.62], [0.18, -0.62], [-0.18, -0.62]]) parts.push({ parent: 0, offset: [x * s, -0.2 * s, z * s], geometry: leg(0.08 * s, 0.05 * s, 1.08 * s), color });
  return {
    parts,
    stride: horse ? 3.2 : 1.4,
    pose(phase, t, i, out) {
      const a = phase * Math.PI * 2;
      // A gallop: front legs together, back legs together, half a beat apart.
      const swing = phase === 0 ? 0 : 0.55;
      [0, 0.3, Math.PI, Math.PI + 0.3].forEach((off, k) => (out[legs + k] = [sin(a + off) * swing, 0, 0]));
      out[0] = [sin(a * 2) * 0.04, 0, 0];
      out[1] = [horse ? -0.75 + sin(a * 2) * 0.06 : -0.35, 0, 0];
      out[2] = [horse ? 0.95 : 0.3, sin(t * 0.7 + i) * 0.08, 0];
      out[3] = [horse ? 0.6 : -0.5, sin(t * (horse ? 2 : 8) + i) * 0.4, 0];
    },
  };
}

/** A penguin: upright, waddling. */
export function penguin(): Species {
  return {
    parts: [
      { parent: -1, offset: [0, 0.4, 0], geometry: blob(0.22, 0.38, 0.2), color: '#1d2228' },
      { parent: 0, offset: [0, 0, 0.05], geometry: blob(0.18, 0.32, 0.16), color: '#f2f2ee', rigid: true },
      { parent: 0, offset: [0, 0.38, 0.02], geometry: blob(0.14, 0.14, 0.14), color: '#1d2228' },
      { parent: 2, offset: [0, 0, 0.12], geometry: spike(0.04, 0.12), color: '#e8a030', rigid: true },
      { parent: 0, offset: [0.2, 0.1, 0], geometry: blob(0.04, 0.2, 0.08, 0, -0.15, 0), color: '#1d2228' },
      { parent: 0, offset: [-0.2, 0.1, 0], geometry: blob(0.04, 0.2, 0.08, 0, -0.15, 0), color: '#1d2228' },
    ],
    stride: 0.35,
    pose(phase, t, i, out) {
      const a = phase * Math.PI * 2;
      out[0] = [0, 0, sin(a) * 0.15];
      out[4] = [0, 0, 0.3 + sin(t * 3 + i) * 0.2];
      out[5] = [0, 0, -0.3 - sin(t * 3 + i) * 0.2];
      out[2] = [0, sin(t * 0.8 + i) * 0.4, 0];
    },
  };
}

/** Sea life: a whale, shark or manta ray, swimming with a beating tail or wings. */
export function swimmer(kind: 'whale' | 'shark' | 'manta' | 'fish' | 'turtle', color: string): Species {
  if (kind === 'manta') {
    return {
      parts: [
        { parent: -1, offset: [0, 0, 0], geometry: blob(0.6, 0.18, 1.0), color },
        { parent: 0, offset: [0.5, 0, 0], geometry: wing(1.8, 1.4, 0.2), color },
        { parent: 0, offset: [-0.5, 0, 0], geometry: wing(1.8, 1.4, 0.2, true), color },
        { parent: 0, offset: [0, 0, -0.9], geometry: tube(0.04, 0.01, -1.6), color },
      ],
      stride: 1e9,
      pose(_p, t, i, out) {
        const f = sin(t * 1.3 + i);
        out[1] = [0, 0, f * 0.45];
        out[2] = [0, 0, -f * 0.45];
      },
    };
  }
  if (kind === 'turtle') {
    return {
      parts: [
        { parent: -1, offset: [0, 0, 0], geometry: blob(0.55, 0.22, 0.7), color },
        { parent: 0, offset: [0, 0, 0.7], geometry: blob(0.14, 0.13, 0.22, 0, 0, 0.12), color: '#8a9a6a' },
        { parent: 0, offset: [0.45, 0, 0.35], geometry: wing(0.6, 0.3, 0.12), color: '#8a9a6a' },
        { parent: 0, offset: [-0.45, 0, 0.35], geometry: wing(0.6, 0.3, 0.12, true), color: '#8a9a6a' },
      ],
      stride: 1e9,
      pose(_p, t, i, out) {
        const f = sin(t * 1.1 + i);
        out[2] = [0, f * 0.4, f * 0.3];
        out[3] = [0, -f * 0.4, -f * 0.3];
      },
    };
  }
  const size = kind === 'whale' ? 9 : kind === 'shark' ? 2.4 : 0.3;
  const parts: Part[] = [
    { parent: -1, offset: [0, 0, 0], geometry: blob(size * 0.16, size * 0.18, size * 0.5, 0, 0, size * 0.05), color },
    { parent: 0, offset: [0, 0, -size * 0.42], geometry: tube(size * 0.12, size * 0.04, -size * 0.35), color },
    { parent: 1, offset: [0, 0, -size * 0.35], geometry: kind === 'whale' ? wing(size * 0.22, size * 0.12, size * 0.05).rotateZ(0) : wing(size * 0.05, size * 0.2, size * 0.02).rotateZ(Math.PI / 2), color },
  ];
  if (kind === 'whale') parts.push({ parent: 1, offset: [0, 0, -size * 0.35], geometry: wing(size * 0.22, size * 0.12, size * 0.05, true), color });
  if (kind === 'shark') parts.push({ parent: 0, offset: [0, size * 0.15, 0], geometry: wing(size * 0.25, size * 0.2, size * 0.04).rotateZ(Math.PI / 2), color });
  if (kind !== 'fish') {
    parts.push({ parent: 0, offset: [size * 0.14, -size * 0.06, size * 0.15], geometry: wing(size * 0.22, size * 0.1, size * 0.03), color });
    parts.push({ parent: 0, offset: [-size * 0.14, -size * 0.06, size * 0.15], geometry: wing(size * 0.22, size * 0.1, size * 0.03, true), color });
  }
  const speed = kind === 'whale' ? 0.5 : kind === 'shark' ? 1.4 : 4;
  return {
    parts,
    stride: 1e9,
    pose(_p, t, i, out) {
      const beat = sin(t * speed * 2 + i * 1.7);
      if (kind === 'whale') {
        out[1] = [beat * 0.15, 0, 0];
        out[2] = [beat * 0.25, 0, 0];
      } else {
        out[1] = [0, beat * 0.3, 0];
        out[2] = [0, beat * 0.3, 0];
      }
    },
  };
}

/** A glowing jellyfish: a pulsing bell trailing tentacles. */
export function jellyfish(color: string): Species {
  const tentacles = new THREE.BufferGeometry();
  const pos: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const x = Math.cos(a) * 0.35;
    const z = Math.sin(a) * 0.35;
    pos.push(x, 0, z, x * 0.6, -1.8, z * 0.6, x * 0.9, 0, z * 0.9);
  }
  tentacles.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tentacles.computeVertexNormals();
  return {
    parts: [
      { parent: -1, offset: [0, 0, 0], geometry: new THREE.SphereGeometry(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1), color, glow: true },
      { parent: 0, offset: [0, 0, 0], geometry: tentacles, color, glow: true },
    ],
    stride: 1e9,
    pose(_p, t, i, out) {
      const pulse = sin(t * 2 + i * 1.3);
      out[0] = [0, t * 0.1, 0];
      out[1] = [pulse * 0.08, 0, pulse * 0.08];
    },
  };
}
