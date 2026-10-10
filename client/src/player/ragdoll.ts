import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { MAX_KNOCK_SPEED } from '../../../shared/protocol.ts';
import { RAGDOLL_GROUPS } from '../game/groups.ts';

/** A person's skeleton, as a ragdoll needs it (see Human). */
export interface Skeleton {
  /** The person's own frame: feet at its origin, facing +Z, left +X. */
  readonly root: THREE.Object3D;
  bone(name: string): THREE.Object3D | undefined;
  /** How a bone is turned, relative to `root`, standing at ease. */
  standing(name: string): THREE.Quaternion;
}

/** How the person's environment pulls on them at a point: gravity (1 normal) and water. */
export type Place = (x: number, y: number, z: number) => { gravity: number; underwater: boolean };

type Range = [number, number];

/** A capsule between two bones (reaching `past` m on beyond the second), or a ball over it. */
interface Shape {
  from: string;
  to: string;
  radius: number;
  past?: number;
  ball?: boolean;
}

/** One rigid piece of the body: the bone it moves, what it hangs from, how it may turn there. */
interface PartSpec {
  bone: string;
  parent?: string;
  /** The joint's bone, if not this part's own (the head turns at the base of the neck). */
  at?: string;
  mass: number;
  shapes: Shape[];
  /**
   * How far it can turn from standing at ease, in radians about the body's left (+X: positive
   * bends a limb back, the spine forward), up (twist) and forward (positive tips it to the left).
   */
  turn?: [Range, Range, Range];
  /** Or a hinge, bending only about the left axis (knees, elbows). */
  hinge?: Range;
}

const side = (s: 'l' | 'r'): PartSpec[] => {
  const out = s === 'l' ? 1 : -1;
  // Sideways ranges mirror: raising the left arm out tips it left (+), the right one right (-).
  const away = (inward: number, outward: number): Range => (out > 0 ? [-inward, outward] : [-outward, inward]);
  return [
    { bone: `upperarm_${s}`, parent: 'spine_03', mass: 2.2, shapes: [{ from: `upperarm_${s}`, to: `lowerarm_${s}`, radius: 0.05 }], turn: [[-2.6, 0.9], [-1, 1], away(0.3, 2.4)] },
    { bone: `lowerarm_${s}`, parent: `upperarm_${s}`, mass: 1.6, shapes: [{ from: `lowerarm_${s}`, to: `hand_${s}`, past: 0.12, radius: 0.045 }], hinge: [-2.5, 0.05] },
    { bone: `thigh_${s}`, parent: 'pelvis', mass: 8.5, shapes: [{ from: `thigh_${s}`, to: `calf_${s}`, radius: 0.08 }], turn: [[-2, 0.45], [-0.5, 0.5], away(0.35, 1)] },
    {
      bone: `calf_${s}`,
      parent: `thigh_${s}`,
      mass: 4.5,
      shapes: [
        { from: `calf_${s}`, to: `foot_${s}`, radius: 0.055 },
        { from: `foot_${s}`, to: `ball_${s}`, radius: 0.045 },
      ],
      hinge: [-0.05, 2.4],
    },
  ];
};

/** The body as twelve pieces, parents first; about 75 kg in all. */
const PARTS: PartSpec[] = [
  { bone: 'pelvis', mass: 11, shapes: [{ from: 'thigh_l', to: 'thigh_r', radius: 0.11 }] },
  { bone: 'spine_01', parent: 'pelvis', mass: 9, shapes: [{ from: 'spine_01', to: 'spine_03', radius: 0.12 }], turn: [[-0.35, 0.7], [-0.35, 0.35], [-0.35, 0.35]] },
  {
    bone: 'spine_03',
    parent: 'spine_01',
    mass: 14,
    shapes: [
      { from: 'spine_03', to: 'neck_01', radius: 0.13 },
      { from: 'upperarm_l', to: 'upperarm_r', radius: 0.07 },
    ],
    turn: [[-0.3, 0.6], [-0.4, 0.4], [-0.3, 0.3]],
  },
  { bone: 'Head', parent: 'spine_03', at: 'neck_01', mass: 5, shapes: [{ from: 'neck_01', to: 'Head', past: 0.09, radius: 0.11, ball: true }], turn: [[-0.6, 0.8], [-0.9, 0.9], [-0.5, 0.5]] },
  ...side('l'),
  ...side('r'),
];

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

interface Part {
  bone: THREE.Object3D;
  body: RAPIER.RigidBody;
  mass: number;
}

const p = new THREE.Vector3();
const q = new THREE.Quaternion();
const scale = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const dir = new THREE.Vector3();
const parentQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Someone gone limp, knocked flying by a car: a body of jointed pieces, each one a bone of
 * their skeleton, thrown about by physics. It flies, tumbles, hits things, lands in a heap
 * and lies there; `pose` puts their skeleton where the pieces are.
 */
export class Ragdoll {
  /** Every ragdoll there is, for `Ragdoll.step`. */
  private static all = new Set<Ragdoll>();
  private parts: Part[] = [];
  private byBone = new Map<string, Part>();
  private age = 0;
  private still = 0;
  /** Where each piece was at the last look for stillness, and how long since. */
  private was: THREE.Vector3[] = [];
  private sinceLook = 0;
  private hardest = 0;
  private lastV = new THREE.Vector3();

  /**
   * Builds the body where `skeleton` stands right now, in the pose it's in, flung at `v`
   * (m/s): legs swept on ahead, the head left behind a little, spinning a bit.
   */
  constructor(
    private physics: RAPIER.World,
    private skeleton: Skeleton,
    v: THREE.Vector3Like,
  ) {
    const root = skeleton.root;
    root.updateMatrixWorld(true);
    const feet = root.getWorldPosition(new THREE.Vector3());
    const hips = skeleton.bone('pelvis')!.getWorldPosition(new THREE.Vector3());
    const spin = (Math.random() * 2 - 1) * 2.5;
    for (const spec of PARTS) {
      const bone = skeleton.bone(spec.bone);
      if (!bone) continue;
      bone.matrixWorld.decompose(p, q, scale);
      // Low down moves with the car; high up lags behind, so the body tips back onto the bonnet.
      const f = THREE.MathUtils.clamp((p.y - feet.y - 0.3) / 1.3, 0, 1);
      const along = 1.15 - 0.6 * f;
      const body = physics.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setRotation(q)
          .setLinvel(v.x * along - spin * (p.z - hips.z), v.y * (1 - 0.2 * f), v.z * along + spin * (p.x - hips.x))
          .setAngvel({ x: 0, y: spin, z: 0 })
          .setLinearDamping(0.05)
          .setAngularDamping(0.6)
          .setCcdEnabled(true),
      );
      for (const shape of spec.shapes) this.addShape(body, shape, spec.mass / spec.shapes.length);
      const part = { bone, body, mass: spec.mass };
      this.parts.push(part);
      this.byBone.set(spec.bone, part);
      const parent = spec.parent && this.byBone.get(spec.parent);
      if (parent) this.join(parent, part, spec);
    }
    this.lastV.copy(this.hipsVelocity());
    Ragdoll.all.add(this);
  }

  /** A piece of the body's shape, in its body's frame (the bone's, at the bone's position). */
  private addShape(body: RAPIER.RigidBody, s: Shape, mass: number): void {
    const from = this.skeleton.bone(s.from);
    const to = this.skeleton.bone(s.to);
    if (!from || !to) return;
    from.getWorldPosition(a);
    to.getWorldPosition(b);
    dir.subVectors(b, a);
    const length = dir.length();
    dir.divideScalar(length || 1);
    b.addScaledVector(dir, s.past ?? 0);
    const t = body.translation();
    const r = body.rotation();
    const inverse = q.set(r.x, r.y, r.z, r.w).invert();
    const desc = s.ball
      ? RAPIER.ColliderDesc.ball(s.radius).setTranslation(...toLocal(b, t, inverse))
      : RAPIER.ColliderDesc.capsule(Math.max(0.01, a.distanceTo(b) / 2 - s.radius / 2), s.radius)
          .setTranslation(...toLocal(a.add(b).multiplyScalar(0.5), t, inverse))
          // Capsules lie along their Y axis.
          .setRotation(new THREE.Quaternion().setFromUnitVectors(UP, dir).premultiply(inverse));
    this.physics.createCollider(desc.setMass(mass).setFriction(0.8).setRestitution(0.05).setCollisionGroups(RAGDOLL_GROUPS), body);
  }

  /**
   * Joins a part to its parent where its bone starts. The joint measures turning from how
   * the two sit standing at ease, about the body's own axes, so its limits read naturally.
   */
  private join(parent: Part, child: Part, spec: PartSpec): void {
    const at = this.skeleton.bone(spec.at ?? spec.bone)!.getWorldPosition(new THREE.Vector3());
    const anchor = (part: Part) => {
      const t = part.body.translation();
      const r = part.body.rotation();
      const v = toLocal(at, t, new THREE.Quaternion(r.x, r.y, r.z, r.w).invert());
      return { x: v[0], y: v[1], z: v[2] };
    };
    const [a1, a2] = [anchor(parent), anchor(child)];
    const f1 = this.skeleton.standing(boneName(parent)).clone().invert();
    const f2 = this.skeleton.standing(spec.bone).clone().invert();
    if (spec.hinge) {
      const joint = this.physics.createImpulseJoint(RAPIER.JointData.revolute(a1, a2, { x: 1, y: 0, z: 0 }), parent.body, child.body, true) as RAPIER.RevoluteImpulseJoint;
      joint.setLocalFrame1(a1, f1);
      joint.setLocalFrame2(a2, f2);
      joint.setLimits(spec.hinge[0], spec.hinge[1]);
      joint.configureMotor(relaxed(spec.hinge), 0, TONE, DAMPING);
      return;
    }
    const joint = this.physics.createImpulseJoint(RAPIER.JointData.spherical(a1, a2), parent.body, child.body, true);
    joint.setLocalFrame1(a1, f1);
    joint.setLocalFrame2(a2, f2);
    // Rapier keeps limits and motors for ball joints but only lets hinges set them; ask its joint set directly.
    const raw = (joint as unknown as { rawSet: RawJoints }).rawSet;
    const axes = [RAPIER.JointAxis.AngX, RAPIER.JointAxis.AngY, RAPIER.JointAxis.AngZ];
    axes.forEach((axis, i) => {
      const [min, max] = spec.turn![i];
      raw.jointSetLimits(joint.handle, axis, min, max);
      raw.jointConfigureMotor(joint.handle, axis, relaxed(spec.turn![i]), 0, TONE, DAMPING);
    });
  }

  /** Where the hips are. */
  hips(out = new THREE.Vector3()): THREE.Vector3 {
    const t = this.parts[0].body.translation();
    return out.set(t.x, t.y, t.z);
  }

  private hipsVelocity(): THREE.Vector3Like {
    return this.parts[0].body.linvel();
  }

  /** Lying still (or it's been long enough): time to get up. */
  get resting(): boolean {
    return this.still >= REST_SECONDS || this.age >= MAX_SECONDS;
  }

  /**
   * How the body lies, for getting up: which way to face once up (toward the head if face
   * down, pushing up; toward the feet if face up, sitting up), and whether it's face up.
   */
  lying(): { yaw: number; faceUp: boolean } {
    const chest = this.byBone.get('spine_03') ?? this.parts[0];
    const r = chest.body.rotation();
    const facing = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(this.skeleton.standing(boneName(chest)).clone().invert())
      .applyQuaternion(q.set(r.x, r.y, r.z, r.w));
    const head = (this.byBone.get('Head') ?? chest).body.translation();
    const hips = this.parts[0].body.translation();
    const toHead = Math.atan2(head.x - hips.x, head.z - hips.z);
    const faceUp = facing.y > 0;
    return { yaw: faceUp ? toHead + Math.PI : toHead, faceUp };
  }

  /** The hardest knock since last asked (landing, hitting a wall): 0 none .. 1 as hard as it gets. */
  takeImpact(): number {
    const h = this.hardest;
    this.hardest = 0;
    return h;
  }

  /** Puts the skeleton's bones where the pieces lie. Call each frame, after moving `root` near the hips. */
  pose(): void {
    for (let i = 0; i < this.parts.length; i++) {
      const { bone, body } = this.parts[i];
      const parent = bone.parent!;
      parent.updateWorldMatrix(true, false);
      parent.matrixWorld.decompose(p, parentQ, scale);
      const r = body.rotation();
      bone.quaternion.set(r.x, r.y, r.z, r.w).premultiply(parentQ.invert());
      if (i === 0) {
        const t = body.translation();
        bone.position.copy(parent.worldToLocal(p.set(t.x, t.y, t.z)));
      }
    }
  }

  dispose(): void {
    for (const part of this.parts) this.physics.removeRigidBody(part.body);
    this.parts.length = 0;
    Ragdoll.all.delete(this);
  }

  /** Before each physics step: low gravity and water hold bodies up; watch for knocks and rest. */
  static step(dt: number, place: Place): void {
    for (const r of Ragdoll.all) r.step(dt, place);
  }

  private step(dt: number, place: Place): void {
    this.age += dt;
    const hips = this.parts[0].body;
    if (hips.isSleeping()) {
      this.still += dt;
      return;
    }
    const t = hips.translation();
    const here = place(t.x, t.y, t.z);
    // Water bears most of a body's weight and slows it; the alien world's gravity is weak.
    const lift = here.underwater ? 0.95 : 1 - here.gravity;
    for (const { body, mass } of this.parts) {
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
      this.parts.forEach(({ body }, i) => {
        const at = body.translation();
        const was = (this.was[i] ??= new THREE.Vector3(at.x, at.y, at.z));
        moved = Math.max(moved, Math.hypot(at.x - was.x, at.y - was.y, at.z - was.z));
        was.set(at.x, at.y, at.z);
      });
      this.still = moved < STILL_MOVE ? this.still + LOOK_EVERY : 0;
      // Settled: let it sleep, rather than twitch on the ground (a knock wakes it).
      if (this.still >= REST_SECONDS && lift <= 0) for (const { body } of this.parts) body.sleep();
    }
    // A sudden change in the hips' speed (more than falling adds) is a hit: the ground, a wall, a car.
    const v = hips.linvel();
    const change = Math.hypot(v.x - this.lastV.x, v.y - this.lastV.y + 9.81 * dt, v.z - this.lastV.z);
    if (change > BUMP) this.hardest = Math.max(this.hardest, Math.min(1, change / HARDEST));
    this.lastV.set(v.x, v.y, v.z);
  }
}

/** A relaxed angle in a joint's range: standing at ease, or bent a little if that's past one end. */
function relaxed([min, max]: Range): number {
  return THREE.MathUtils.clamp(0, min + 0.25, max - 0.25);
}

/** The bone a part moves. */
function boneName(part: Part): string {
  return part.bone.name;
}

/** `v` in the frame of a body at `t` turned by `inverse`'s inverse. */
function toLocal(v: THREE.Vector3, t: THREE.Vector3Like, inverse: THREE.Quaternion): [number, number, number] {
  const l = v.clone().sub(t as THREE.Vector3).applyQuaternion(inverse);
  return [l.x, l.y, l.z];
}

/**
 * How someone hit by a car moving at `car` (m/s) is flung: on with the car and a little to
 * one side, and up only a little (the car sweeps their legs; they don't take off).
 */
export function flingFrom(car: THREE.Vector3Like): THREE.Vector3 {
  const speed = Math.hypot(car.x, car.z);
  const v = new THREE.Vector3(car.x, 0, car.z);
  v.applyAxisAngle(UP, (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.35));
  v.y = 0.8 + speed * 0.18;
  return v.clampLength(0, MAX_KNOCK_SPEED);
}
