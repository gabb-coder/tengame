import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { RAGDOLL_GROUPS } from './groups.ts';

/** How a body's surroundings pull on it at a point: gravity (1 normal) and water. */
export type Place = (x: number, y: number, z: number) => { gravity: number; underwater: boolean };

export type Range = [number, number];

/** One rigid piece of a limp body, and how heavy it is (kg). */
export interface Piece {
  body: RAPIER.RigidBody;
  mass: number;
}

/**
 * Lying still: no piece moved further than this (m) in a look this long (s); a twitching
 * finger doesn't count. Still this long (s) is at rest.
 */
const STILL_MOVE = 0.04;
const LOOK_EVERY = 0.25;
const REST_SECONDS = 0.5;
/** Whatever happens, it's over after this long (s): wedged somewhere, rocking on a slope. */
const MAX_SECONDS = 8;
/** A change in speed (m/s, in one step) that counts as hitting something, and one that's as hard as it gets. */
const BUMP = 3.5;
const HARDEST = 14;
/**
 * A little muscle tone: each joint is drawn gently toward a relaxed pose (stiffness), and
 * swings against some friction (damping), so limbs flop and settle rather than flail or fold up.
 */
const TONE = 4;
const DAMPING = 0.5;

/** The parts of Rapier's joint set used to limit and damp ball joints. */
interface RawJoints {
  jointSetLimits(handle: number, axis: number, min: number, max: number): void;
  jointConfigureMotor(handle: number, axis: number, targetPos: number, targetVel: number, stiffness: number, damping: number): void;
}

const inverse = new THREE.Quaternion();
/** Only the world's fixed parts (ground, walls), not cars, people or limp bodies. */
const STATIC_ONLY = RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC;
const down = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

/**
 * The height of whatever's solid under `p` (a sidewalk, a floor, the ground; not cars or
 * people), or `fallback` there if nothing is found: where a body that got up stands.
 */
export function groundUnder(physics: RAPIER.World, p: THREE.Vector3Like, fallback: (x: number, z: number) => number): number {
  down.origin = { x: p.x, y: p.y + 1.5, z: p.z };
  // Not solid: starting inside something (a wall), find where it ends below, not its inside.
  const hit = physics.castRay(down, 8, false, STATIC_ONLY);
  return hit ? p.y + 1.5 - hit.timeOfImpact : fallback(p.x, p.z);
}

/**
 * A body gone limp, knocked flying by a car (a person, see Ragdoll; or an animal): rigid
 * pieces joined at limited joints, thrown about by physics. It flies, tumbles, hits things,
 * lands in a heap and lies there.
 */
export class Limp<P extends Piece = Piece> {
  /** Every limp body there is, for `Limp.step`. */
  private static all = new Set<Limp>();
  protected readonly pieces: P[] = [];
  private age = 0;
  private still = 0;
  /** Where each piece was at the last look for stillness, and how long since. */
  private was: THREE.Vector3[] = [];
  private sinceLook = 0;
  private hardest = 0;
  private lastV = new THREE.Vector3();

  constructor(protected physics: RAPIER.World) {
    Limp.all.add(this as Limp);
  }

  /** Adds a piece at `p`, turned `q`, moving at `v` and spinning at `w`; the first is the middle of the body. */
  protected addPiece(p: THREE.Vector3Like, q: THREE.QuaternionLike, v: THREE.Vector3Like, w: THREE.Vector3Like, more: Omit<P, keyof Piece>): P {
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(v.x, v.y, v.z)
        .setAngvel({ x: w.x, y: w.y, z: w.z })
        .setLinearDamping(0.05)
        .setAngularDamping(0.6)
        .setCcdEnabled(true),
    );
    const piece = { ...more, body, mass: 0 } as P;
    if (this.pieces.length === 0) this.lastV.set(v.x, v.y, v.z);
    this.pieces.push(piece);
    return piece;
  }

  /** Gives a piece some of its shape and weight (`desc` placed in the piece's own frame). */
  protected addShape(piece: P, desc: RAPIER.ColliderDesc, mass: number): void {
    this.physics.createCollider(desc.setMass(mass).setFriction(0.8).setRestitution(0.05).setCollisionGroups(RAGDOLL_GROUPS), piece.body);
    piece.mass += mass;
  }

  /**
   * Joins `child` to `parent` at `at` (world) with a ball joint. The joint measures turning
   * between frames `f1` and `f2` (in each piece's own frame), which line up in the body's
   * natural pose, about their X, Y and Z axes: no further than `turn`, and drawn gently back.
   */
  protected ball(parent: P, child: P, at: THREE.Vector3, f1: THREE.Quaternion, f2: THREE.Quaternion, turn: [Range, Range, Range], tone = TONE): void {
    const [a1, a2] = [anchor(parent, at), anchor(child, at)];
    const joint = this.physics.createImpulseJoint(RAPIER.JointData.spherical(a1, a2), parent.body, child.body, true);
    joint.setLocalFrame1(a1, f1);
    joint.setLocalFrame2(a2, f2);
    // Rapier keeps limits and motors for ball joints but only lets hinges set them; ask its joint set directly.
    const raw = (joint as unknown as { rawSet: RawJoints }).rawSet;
    [RAPIER.JointAxis.AngX, RAPIER.JointAxis.AngY, RAPIER.JointAxis.AngZ].forEach((axis, i) => {
      raw.jointSetLimits(joint.handle, axis, turn[i][0], turn[i][1]);
      raw.jointConfigureMotor(joint.handle, axis, relaxed(turn[i]), 0, tone, DAMPING);
    });
  }

  /** Joins `child` to `parent` at `at` (world) with a hinge about the frames' X axis (see `ball`). */
  protected hinge(parent: P, child: P, at: THREE.Vector3, f1: THREE.Quaternion, f2: THREE.Quaternion, range: Range, tone = TONE): void {
    const [a1, a2] = [anchor(parent, at), anchor(child, at)];
    const joint = this.physics.createImpulseJoint(RAPIER.JointData.revolute(a1, a2, { x: 1, y: 0, z: 0 }), parent.body, child.body, true) as RAPIER.RevoluteImpulseJoint;
    joint.setLocalFrame1(a1, f1);
    joint.setLocalFrame2(a2, f2);
    joint.setLimits(range[0], range[1]);
    joint.configureMotor(relaxed(range), 0, tone, DAMPING);
  }

  /** Where the middle of the body is (the hips, for a person). */
  hips(out = new THREE.Vector3()): THREE.Vector3 {
    const t = this.pieces[0].body.translation();
    return out.set(t.x, t.y, t.z);
  }

  /** Lying still (or it's been long enough): time to get up. */
  get resting(): boolean {
    return this.still >= REST_SECONDS || this.age >= MAX_SECONDS;
  }

  /** The hardest knock since last asked (landing, hitting a wall): 0 none .. 1 as hard as it gets. */
  takeImpact(): number {
    const h = this.hardest;
    this.hardest = 0;
    return h;
  }

  dispose(): void {
    for (const piece of this.pieces) this.physics.removeRigidBody(piece.body);
    this.pieces.length = 0;
    Limp.all.delete(this as Limp);
  }

  /** Before each physics step: low gravity and water hold bodies up; watch for knocks and rest. */
  static step(dt: number, place: Place): void {
    for (const limp of Limp.all) limp.step(dt, place);
  }

  private step(dt: number, place: Place): void {
    this.age += dt;
    const middle = this.pieces[0].body;
    if (middle.isSleeping()) {
      this.still += dt;
      return;
    }
    const t = middle.translation();
    const here = place(t.x, t.y, t.z);
    // Water bears most of a body's weight and slows it; the alien world's gravity is weak.
    const lift = here.underwater ? 0.95 : 1 - here.gravity;
    for (const { body, mass } of this.pieces) {
      if (lift > 0) body.applyImpulse({ x: 0, y: mass * 9.81 * lift * dt, z: 0 }, true);
      if (here.underwater) {
        const v = body.linvel();
        const k = Math.exp(-2 * dt);
        body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
      }
    }
    if ((this.sinceLook += dt) >= LOOK_EVERY) {
      this.sinceLook = 0;
      let moved = this.was.length === 0 ? Infinity : 0;
      this.pieces.forEach(({ body }, i) => {
        const at = body.translation();
        const was = (this.was[i] ??= new THREE.Vector3(at.x, at.y, at.z));
        moved = Math.max(moved, Math.hypot(at.x - was.x, at.y - was.y, at.z - was.z));
        was.set(at.x, at.y, at.z);
      });
      this.still = moved < STILL_MOVE ? this.still + LOOK_EVERY : 0;
      // Settled: let it sleep, rather than twitch on the ground (a knock wakes it).
      if (this.still >= REST_SECONDS && lift <= 0) for (const { body } of this.pieces) body.sleep();
    }
    // A sudden change in the middle's speed (more than falling adds) is a hit: the ground, a wall, a car.
    const v = middle.linvel();
    const change = Math.hypot(v.x - this.lastV.x, v.y - this.lastV.y + 9.81 * dt, v.z - this.lastV.z);
    if (change > BUMP) this.hardest = Math.max(this.hardest, Math.min(1, change / HARDEST));
    this.lastV.set(v.x, v.y, v.z);
  }
}

/** A relaxed angle in a joint's range: as it was, or bent a little if that's past one end. */
function relaxed([min, max]: Range): number {
  return THREE.MathUtils.clamp(0, min + 0.25, max - 0.25);
}

/** `at` (world) in a piece's own frame. */
function anchor(piece: Piece, at: THREE.Vector3): RAPIER.Vector {
  const t = piece.body.translation();
  const r = piece.body.rotation();
  const l = at.clone().sub(t as THREE.Vector3).applyQuaternion(inverse.set(r.x, r.y, r.z, r.w).invert());
  return { x: l.x, y: l.y, z: l.z };
}

/** `v` (world) in the frame of a body at `t`, turned by the inverse of `inverse`. */
export function toLocal(v: THREE.Vector3, t: THREE.Vector3Like, inverse: THREE.Quaternion): [number, number, number] {
  const l = v.clone().sub(t as THREE.Vector3).applyQuaternion(inverse);
  return [l.x, l.y, l.z];
}
