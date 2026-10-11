import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { MAX_KNOCK_SPEED } from '../../../shared/protocol.ts';
import { Limp, type Piece, toLocal } from '../game/limp.ts';

/** A person's skeleton, as a ragdoll needs it (see Human). */
export interface Skeleton {
  /** The person's own frame: feet at its origin, facing +Z, left +X. */
  readonly root: THREE.Object3D;
  bone(name: string): THREE.Object3D | undefined;
  /** How a bone is turned, relative to `root`, standing at ease. */
  standing(name: string): THREE.Quaternion;
}

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

/** A piece of the body and the bone it moves. */
interface Part extends Piece {
  bone: THREE.Object3D;
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
 * their skeleton, thrown about by physics (see Limp). `pose` puts their skeleton where the
 * pieces are.
 */
export class Ragdoll extends Limp<Part> {
  private byBone = new Map<string, Part>();

  /**
   * Builds the body where `skeleton` stands right now, in the pose it's in, flung at `v`
   * (m/s): legs swept on ahead, the head left behind a little, spinning a bit.
   */
  constructor(
    physics: RAPIER.World,
    private skeleton: Skeleton,
    v: THREE.Vector3Like,
  ) {
    super(physics);
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
      const velocity = { x: v.x * along - spin * (p.z - hips.z), y: v.y * (1 - 0.2 * f), z: v.z * along + spin * (p.x - hips.x) };
      const part = this.addPiece(p, q, velocity, { x: 0, y: spin, z: 0 }, { bone });
      for (const shape of spec.shapes) this.shape(part, shape, spec.mass / spec.shapes.length);
      this.byBone.set(spec.bone, part);
      const parent = spec.parent && this.byBone.get(spec.parent);
      if (parent) this.join(parent, part, spec);
    }
  }

  /** A piece of the body's shape, in its body's frame (the bone's, at the bone's position). */
  private shape(part: Part, s: Shape, mass: number): void {
    const from = this.skeleton.bone(s.from);
    const to = this.skeleton.bone(s.to);
    if (!from || !to) return;
    from.getWorldPosition(a);
    to.getWorldPosition(b);
    dir.subVectors(b, a);
    const length = dir.length();
    dir.divideScalar(length || 1);
    b.addScaledVector(dir, s.past ?? 0);
    const t = part.body.translation();
    const r = part.body.rotation();
    const inverse = q.set(r.x, r.y, r.z, r.w).invert();
    const desc = s.ball
      ? RAPIER.ColliderDesc.ball(s.radius).setTranslation(...toLocal(b, t, inverse))
      : RAPIER.ColliderDesc.capsule(Math.max(0.01, a.distanceTo(b) / 2 - s.radius / 2), s.radius)
          .setTranslation(...toLocal(a.add(b).multiplyScalar(0.5), t, inverse))
          // Capsules lie along their Y axis.
          .setRotation(new THREE.Quaternion().setFromUnitVectors(UP, dir).premultiply(inverse));
    this.addShape(part, desc, mass);
  }

  /**
   * Joins a part to its parent where its bone starts. The joint measures turning from how
   * the two sit standing at ease, about the body's own axes, so its limits read naturally.
   */
  private join(parent: Part, child: Part, spec: PartSpec): void {
    const at = this.skeleton.bone(spec.at ?? spec.bone)!.getWorldPosition(new THREE.Vector3());
    const f1 = this.skeleton.standing(parent.bone.name).clone().invert();
    const f2 = this.skeleton.standing(spec.bone).clone().invert();
    if (spec.hinge) this.hinge(parent, child, at, f1, f2, spec.hinge);
    else this.ball(parent, child, at, f1, f2, spec.turn!);
  }

  /**
   * How the body lies, for getting up: which way to face once up (toward the head if face
   * down, pushing up; toward the feet if face up, sitting up), and whether it's face up.
   */
  lying(): { yaw: number; faceUp: boolean } {
    const chest = this.byBone.get('spine_03') ?? this.pieces[0];
    const r = chest.body.rotation();
    const facing = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(this.skeleton.standing(chest.bone.name).clone().invert())
      .applyQuaternion(q.set(r.x, r.y, r.z, r.w));
    const head = (this.byBone.get('Head') ?? chest).body.translation();
    const hips = this.pieces[0].body.translation();
    const toHead = Math.atan2(head.x - hips.x, head.z - hips.z);
    const faceUp = facing.y > 0;
    return { yaw: faceUp ? toHead + Math.PI : toHead, faceUp };
  }

  /** Puts the skeleton's bones where the pieces lie. Call each frame, after moving `root` near the hips. */
  pose(): void {
    for (let i = 0; i < this.pieces.length; i++) {
      const { bone, body } = this.pieces[i];
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
