// The on-screen stick and buttons of phones and tablets drive and walk like the keys.
import assert from 'node:assert/strict';
import { test } from 'node:test';

// No browser here: listening for keys and the mouse goes nowhere.
Object.assign(globalThis, { addEventListener: () => {} });
const { Input } = await import('../src/input.ts');

const still = (look: { yaw: number; pitch: number }) => look.yaw === 0 && look.pitch === 0;

function input() {
  return new Input({ addEventListener: () => {} } as unknown as HTMLElement);
}

test('the stick pushed up is full gas, and full lock on a diagonal', () => {
  const i = input();
  i.setStick(0, 1);
  assert.deepEqual(i.car, { throttle: 1, brake: 0, steer: 0, handbrake: false });
  i.setStick(-1, 1);
  assert.equal(i.car.throttle, 1);
  assert.equal(i.car.steer, -1);
  i.setStick(0, -1);
  assert.equal(i.car.brake, 1);
  assert.equal(i.car.throttle, 0);
});

test('a light push steers and walks a little; the middle does nothing', () => {
  const i = input();
  i.setStick(0.3, 0);
  assert.ok(i.car.steer > 0 && i.car.steer < 0.5, `steer ${i.car.steer}`);
  i.setStick(0.1, 0.05);
  assert.equal(i.car.steer, 0);
  assert.equal(i.foot.strafe, 0);
  assert.equal(i.foot.forward, 0);
  i.setStick(0, 0.5);
  const { forward, run } = i.foot;
  assert.ok(forward > 0.3 && forward < 0.6, `forward ${forward}`);
  assert.equal(run, false);
});

test('pushed all the way out, you run', () => {
  const i = input();
  i.setStick(0, 1);
  assert.equal(i.foot.forward, 1);
  assert.equal(i.foot.run, true);
  // Pushed past the edge counts as the edge.
  i.setStick(3, 0);
  assert.equal(i.foot.strafe, 1);
});

test('buttons hold and tap keys like the keyboard', () => {
  const i = input();
  i.hold('Space', true);
  assert.equal(i.foot.jump, true);
  assert.equal(i.car.handbrake, true);
  i.hold('Space', false);
  assert.equal(i.foot.jump, false);
  i.tap('KeyE');
  assert.equal(i.wasPressed('KeyE'), true);
  assert.equal(i.wasPressed('KeyE'), false);
});

test('with a menu open, fingers do nothing', () => {
  const i = input();
  i.enabled = false;
  i.setStick(0, 1);
  i.hold('Space', true);
  i.tap('KeyE');
  i.drag(100, 0);
  assert.equal(i.car.throttle, 0);
  assert.equal(i.foot.jump, false);
  assert.equal(i.wasPressed('KeyE'), false);
  assert.ok(still(i.takeLook(0)));
});

test('dragging a finger looks around like the mouse', () => {
  const i = input();
  i.drag(-50, 20);
  const look = i.takeLook(0);
  assert.ok(look.yaw > 0, 'dragging left turns left');
  assert.ok(look.pitch > 0, 'dragging down looks down');
  assert.ok(still(i.takeLook(0)), 'each drag is taken once');
});
