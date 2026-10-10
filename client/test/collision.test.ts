// Other players are kinematic bodies in our physics world: cars must bump into them,
// but camera rays must pass through.
import RAPIER from '@dimforge/rapier3d-compat';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { REMOTE_CAR_GROUPS } from '../src/game/groups.ts';
import { CAMERA_RAY_GROUPS } from '../src/net/remotePlayers.ts';
import { CAR, CarPhysics, type CarControls } from '../src/vehicles/carPhysics.ts';

const DT = 1 / 60;
const IDLE: CarControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };

before(() => RAPIER.init());

function setup() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  const car = new CarPhysics(world, { x: 0, y: 1.2, z: 0 });
  // Another player's car parked 20 m ahead, the way RemotePlayers adds it.
  const h = CAR.halfExtents;
  const other = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.8, 20));
  world.createCollider(RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setCollisionGroups(REMOTE_CAR_GROUPS), other);
  const run = (c: CarControls, seconds: number) => {
    for (let i = 0; i < seconds / DT; i++) {
      car.step(c, DT);
      world.step();
    }
  };
  run(IDLE, 1);
  return { world, car, other, run };
}

test("driving into another player's car stops you", () => {
  const { car, run } = setup();
  run({ ...IDLE, throttle: 1 }, 6);
  const z = car.body.translation().z;
  assert.ok(z < 20 - CAR.halfExtents.z, `drove through the other car to z=${z.toFixed(1)}`);
});

test('a moving player car shoves a parked one', () => {
  const { car, other, run } = setup();
  for (let i = 0; i < 90; i++) {
    const t = other.translation();
    other.setNextKinematicTranslation({ x: t.x, y: t.y, z: t.z - 0.25 }); // 15 m/s toward us
    run(IDLE, DT);
  }
  assert.ok(car.body.translation().z < -1, `wasn't pushed: z=${car.body.translation().z.toFixed(2)}`);
});

test('camera rays pass through other players but not the ground', () => {
  const { world } = setup();
  const down = new RAPIER.Ray({ x: 0, y: 5, z: 20 }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(down, 10, true, undefined, CAMERA_RAY_GROUPS);
  assert.ok(hit, 'ray missed the ground');
  assert.ok(Math.abs(hit.timeOfImpact - 5) < 0.01, `stopped at ${hit.timeOfImpact} m, not the ground`);
  const any = world.castRay(down, 10, true);
  assert.ok(any && any.timeOfImpact < 4.9, 'the other car should be hit by ordinary rays');
});
