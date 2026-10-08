// Headless handling checks for the car physics. Ranges are loose on purpose:
// they catch broken tuning (car flips, won't move, 3 g corners), not small tweaks.
import RAPIER from '@dimforge/rapier3d-compat';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { CarPhysics, type CarControls } from '../src/vehicles/carPhysics.ts';

const DT = 1 / 60;
const IDLE: CarControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const FULL: CarControls = { ...IDLE, throttle: 1 };
const kmh = (v: number) => v / 3.6;

before(() => RAPIER.init());

function setup() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0));
  const car = new CarPhysics(world, { x: 0, y: 1.2, z: 0 });
  /** Steps until `until` returns true or `seconds` pass; returns elapsed seconds. */
  const drive = (c: CarControls, seconds: number, until?: () => boolean) => {
    for (let i = 0; i < seconds / DT; i++) {
      car.step(c, DT);
      world.step();
      if (until?.()) return (i + 1) * DT;
    }
    return seconds;
  };
  drive(IDLE, 1);
  return { car, drive };
}

/** Tilt from upright, in degrees. */
function tilt(car: CarPhysics): number {
  const r = car.body.rotation();
  return (Math.acos(Math.min(1, 1 - 2 * (r.x * r.x + r.z * r.z))) * 180) / Math.PI;
}

test('settles on its wheels and stays parked', () => {
  const { car, drive } = setup();
  drive(IDLE, 5);
  const t = car.body.translation();
  assert.ok(Math.hypot(t.x, t.z) < 0.05, `drifted to ${t.x}, ${t.z}`);
  assert.ok(t.y > 0.4 && t.y < 1, `ride height ${t.y}`);
  assert.ok(tilt(car) < 1);
});

test('accelerates like a sports sedan and shifts up', () => {
  const { car, drive } = setup();
  const t100 = drive(FULL, 20, () => car.speed >= kmh(100));
  assert.ok(t100 > 4 && t100 < 9, `0-100 km/h in ${t100.toFixed(2)} s`);
  assert.ok(car.gear >= 2);
  drive(FULL, 40);
  assert.ok(car.speed > kmh(170) && car.speed < kmh(260), `top speed ${car.speed * 3.6} km/h`);
  assert.ok(car.body.translation().x ** 2 < 1, 'drove straight along +Z');
});

test('brakes from 100 km/h in a realistic distance', () => {
  const { car, drive } = setup();
  drive(FULL, 20, () => car.speed >= kmh(100));
  const z0 = car.body.translation().z;
  drive({ ...IDLE, brake: 1 }, 10, () => car.speed < 0.5);
  const distance = car.body.translation().z - z0;
  assert.ok(distance > 30 && distance < 60, `stopped in ${distance.toFixed(1)} m`);
});

test('reverses slowly when holding brake from a stop', () => {
  const { car, drive } = setup();
  drive({ ...IDLE, brake: 1 }, 4);
  assert.equal(car.gear, -1);
  assert.ok(car.speed < kmh(-10) && car.speed > kmh(-35), `reverse at ${car.speed * 3.6} km/h`);
});

test('corners at about 1 g without rolling over', () => {
  for (const target of [30, 60, 100]) {
    const { car, drive } = setup();
    drive(FULL, 20, () => car.speed >= kmh(target));
    let maxTilt = 0;
    drive({ ...IDLE, throttle: 0.4, steer: 1 }, 3, () => ((maxTilt = Math.max(maxTilt, tilt(car))), false));
    const lateralG = Math.abs(car.speed * car.body.angvel().y) / 9.81;
    assert.ok(lateralG > 0.6 && lateralG < 1.3, `${lateralG.toFixed(2)} g at ${target} km/h`);
    assert.ok(maxTilt < 10, `tilted ${maxTilt.toFixed(1)}° at ${target} km/h`);
  }
});

test('steering right turns toward -X (car faces +Z)', () => {
  const { car, drive } = setup();
  drive(FULL, 20, () => car.speed >= kmh(30));
  drive({ ...IDLE, throttle: 0.3, steer: 1 }, 1);
  assert.ok(car.body.translation().x < -1);
});

test('handbrake turn slides the rear out', () => {
  const { car, drive } = setup();
  drive(FULL, 20, () => car.speed >= kmh(60));
  let maxSlip = 0;
  drive({ ...IDLE, steer: 1, handbrake: true }, 1.5, () => ((maxSlip = Math.max(maxSlip, car.slipAngle)), false));
  assert.ok(maxSlip > 0.35, `max slip ${((maxSlip * 180) / Math.PI).toFixed(0)}°`);
  assert.ok(tilt(car) < 15);
});

test('reset puts a flipped car back upright', () => {
  const { car, drive } = setup();
  car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); // upside down
  drive(IDLE, 1);
  car.reset();
  drive(IDLE, 2);
  assert.ok(tilt(car) < 2);
});
