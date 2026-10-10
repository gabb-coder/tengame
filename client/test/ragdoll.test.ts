// Someone knocked flying goes limp: a ragdoll of jointed pieces that flies, lands in a
// heap and lies still, without coming apart or bending joints the wrong way.
import RAPIER from '@dimforge/rapier3d-compat';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { Ragdoll, type Skeleton } from '../src/player/ragdoll.ts';
import { CarPhysics } from '../src/vehicles/carPhysics.ts';

const DT = 1 / 60;
const NORMAL = { gravity: 1, underwater: false };

before(() => RAPIER.init());

/** The people's skeleton as it rests in the model file (a T-pose), feet at the origin. */
const BONES: [name: string, parent: string | null, t: number[], q: number[]][] = [
  ['root', null, [0, 0, 0], [-0.707, 0, 0, 0.707]],
  ['pelvis', 'root', [0, 0.043, 0.949], [0.801, 0, 0, 0.599]],
  ['spine_01', 'pelvis', [0, 0.128, 0], [-0.092, 0, 0, 0.996]],
  ['spine_02', 'spine_01', [0, 0.106, 0], [-0.04, 0, 0, 0.999]],
  ['spine_03', 'spine_02', [0, 0.133, 0], [-0.124, 0, 0, 0.992]],
  ['neck_01', 'spine_03', [0, 0.215, 0], [0.257, 0, 0, 0.966]],
  ['Head', 'neck_01', [0, 0.083, 0], [-0.132, 0, 0, 0.991]],
  ...(['l', 'r'] as const).flatMap((s): [string, string | null, number[], number[]][] => {
    const m = s === 'l' ? 1 : -1;
    return [
      [`clavicle_${s}`, 'spine_03', [0.031 * m, 0.174, 0.067], [-0.529, -0.329 * m, -0.414 * m, 0.664]],
      [`upperarm_${s}`, `clavicle_${s}`, [-0.009 * m, 0.206, -0.04], [0.15, 0.691 * m, -0.149 * m, 0.691]],
      [`lowerarm_${s}`, `upperarm_${s}`, [0, 0.251, 0], [0.031, 0, 0, 1]],
      [`hand_${s}`, `lowerarm_${s}`, [0, 0.244, 0], [-0.016, 0, 0, 1]],
      [`thigh_${s}`, 'pelvis', [0.114 * m, 0.023, 0], [0.99, 0, 0, 0.142]],
      [`calf_${s}`, `thigh_${s}`, [0, 0.429, 0], [0.056, 0, 0, 0.998]],
      [`foot_${s}`, `calf_${s}`, [0, 0.459, 0], [-0.572, 0, 0, 0.82]],
      [`ball_${s}`, `foot_${s}`, [0, 0.159, 0], [0, 0.973 * m, -0.23 * m, 0]],
    ];
  }),
];

function person(): Skeleton {
  const root = new THREE.Group();
  const bones = new Map<string, THREE.Object3D>();
  for (const [name, parent, t, q] of BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.fromArray(t);
    bone.quaternion.fromArray(q).normalize();
    (parent ? bones.get(parent)! : root).add(bone);
    bones.set(name, bone);
  }
  root.updateMatrixWorld(true);
  const standing = new Map<string, THREE.Quaternion>();
  for (const [name, bone] of bones) standing.set(name, bone.getWorldQuaternion(new THREE.Quaternion()));
  return { root, bone: (name) => bones.get(name), standing: (name) => standing.get(name)!.clone() };
}

function world() {
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  w.timestep = DT;
  w.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0));
  return w;
}

/** Bend of a knee (radians, positive the natural way): how far the shin has turned back from the thigh. */
function kneeBend(skeleton: Skeleton, side: 'l' | 'r', parts: Map<string, RAPIER.RigidBody>): number {
  const q = (name: string) => {
    const r = parts.get(name)!.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w).multiply(skeleton.standing(name).invert());
  };
  const relative = q(`thigh_${side}`).invert().multiply(q(`calf_${side}`));
  const thigh = q(`thigh_${side}`);
  // About the thigh's own left axis.
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(thigh);
  const angle = 2 * Math.acos(Math.min(1, Math.abs(relative.w)));
  const along = new THREE.Vector3(relative.x, relative.y, relative.z).applyQuaternion(thigh).dot(axis);
  return Math.sign(relative.w) * Math.sign(along) * angle;
}

test('someone hit by a car flies, lands in a heap and lies still, in one piece', (t) => {
  // The same little spin every run.
  t.mock.method(Math, 'random', () => 0.7);
  const physics = world();
  const skeleton = person();
  const ragdoll = new Ragdoll(physics, skeleton, { x: 0, y: 3, z: 12 });
  const parts = (ragdoll as unknown as { parts: { bone: THREE.Object3D; body: RAPIER.RigidBody }[] }).parts;
  const byName = new Map(parts.map((p) => [p.bone.name, p.body]));
  let restedAt = -1;
  let worstKnee = 0;
  for (let i = 0; i < 10 / DT && restedAt < 0; i++) {
    Ragdoll.step(DT, () => NORMAL);
    physics.step();
    for (const s of ['l', 'r'] as const) worstKnee = Math.min(worstKnee, kneeBend(skeleton, s, byName));
    if (ragdoll.resting) restedAt = i * DT;
  }
  const knees = (['l', 'r'] as const).map((s) => kneeBend(skeleton, s, byName));
  const hips = ragdoll.hips();
  assert.ok(restedAt > 0.5 && restedAt < 6, `came to rest after ${restedAt.toFixed(1)} s`);
  assert.ok(hips.y < 0.35, `lying down: hips ${hips.y.toFixed(2)} m up`);
  assert.ok(hips.z > 3 && hips.z < 15, `thrown ${hips.z.toFixed(1)} m`);
  for (const { bone, body } of parts) {
    const t = body.translation();
    assert.ok(Math.hypot(t.x - hips.x, t.y - hips.y, t.z - hips.z) < 1.1, `${bone.name} came away from the body`);
  }
  // Joint limits give a little under a hard knock, but never far, and not for long.
  assert.ok(worstKnee > -0.5, `a knee bent backwards by ${(-worstKnee).toFixed(2)} rad`);
  for (const k of knees) assert.ok(k > -0.15 && k < 2.5, `a knee lies bent ${k.toFixed(2)} rad`);
  ragdoll.dispose();
  assert.equal(physics.bodies.len(), 0, 'all its pieces are gone');
});

test("someone thrown onto a car lands on its roof, not inside it", (t) => {
  t.mock.method(Math, 'random', () => 0.5);
  const physics = world();
  const car = new CarPhysics(physics, { x: 0, y: 1.2, z: 0 });
  for (let i = 0; i < 60; i++) {
    car.step({ throttle: 0, brake: 0, steer: 0, handbrake: true }, DT);
    physics.step();
  }
  const skeleton = person();
  // Lying flat across the car, a little above the roof.
  skeleton.root.position.set(0.9, 2.1, -0.4);
  skeleton.root.rotation.set(0, 0, Math.PI / 2);
  const ragdoll = new Ragdoll(physics, skeleton, { x: 0, y: 0, z: 0 });
  for (let i = 0; i < 3 / DT; i++) {
    Ragdoll.step(DT, () => NORMAL);
    car.step({ throttle: 0, brake: 0, steer: 0, handbrake: true }, DT);
    physics.step();
  }
  const roof = car.body.translation().y + 0.7;
  const hips = ragdoll.hips();
  assert.ok(hips.y > roof - 0.1, `fell into the car: hips ${hips.y.toFixed(2)} m up, roof at ${roof.toFixed(2)} m`);
});
