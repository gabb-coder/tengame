// Who sits where: anyone can get in anyone's car, and a car is moved by its driver's game.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Seating } from '../src/game/seating.ts';

test('a car is moved by whoever drives it, or by its owner while nobody does', () => {
  const seating = new Seating({ alice: { car: 'alice', n: 0 }, bob: null });
  assert.equal(seating.movedBy('alice'), 'alice');
  assert.equal(seating.movedBy('bob'), 'bob', 'parked, it stays with its owner');
  // Bob takes Alice's car (she's out), and she hops in beside him.
  seating.set('alice', null);
  seating.set('bob', { car: 'alice', n: 0 });
  seating.set('alice', { car: 'alice', n: 1 });
  assert.equal(seating.driverOf('alice'), 'bob');
  assert.equal(seating.movedBy('alice'), 'bob');
  assert.deepEqual(seating.taken('alice'), [0, 1]);
  assert.deepEqual(seating.riders('alice'), [
    { id: 'bob', n: 0 },
    { id: 'alice', n: 1 },
  ]);
  assert.equal(seating.driverOf('bob'), null);
  // Someone we've not heard about yet starts at their own wheel; someone gone is nowhere.
  assert.deepEqual(seating.of('cat'), { car: 'cat', n: 0 });
  seating.remove('bob');
  assert.equal(seating.driverOf('alice'), null);
  assert.equal(seating.movedBy('alice'), 'alice');
});
