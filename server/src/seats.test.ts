import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebSocket } from 'ws';
import type { MissionMessage, SeatMessage, ServerMessage } from '../../shared/protocol.ts';
import { passengerSeat, seatFor, seatPlace } from '../../shared/seats.ts';
import { Room } from './rooms.ts';

test('getting in takes the wheel if nobody has it, otherwise the first free seat', () => {
  assert.equal(seatFor([]), 0);
  assert.equal(seatFor([0]), 1);
  assert.equal(seatFor([0, 1, 3]), 2);
  assert.equal(seatFor([1, 2]), 0);
  assert.equal(seatFor([0, 1, 2, 3]), null, 'full');
  assert.equal(passengerSeat([0]), 1);
  assert.equal(passengerSeat([1, 2]), 3);
  assert.equal(passengerSeat([1, 2, 3]), null);
  // The driver gets out on their side (the car's +X), the front passenger on the other.
  assert.deepEqual(seatPlace(0), { side: 1, z: 0.3 });
  assert.deepEqual(seatPlace(1), { side: -1, z: 0.3 });
  assert.ok(seatPlace(3).z < seatPlace(1).z, 'the back seats are behind the front ones');
});

test('a race mission first puts everyone back at the wheel of their own car', () => {
  let now = 0;
  const room = new Room('SEATS', 'missions', () => now);
  const sent: ServerMessage[] = [];
  // What Alice's game is told (Bob's hears the same).
  const socket = (inbox?: ServerMessage[]) => ({ readyState: 1, OPEN: 1, send: (data: string) => inbox?.push(JSON.parse(data)) }) as unknown as WebSocket;
  const alice = room.add(socket(sent), 'Alice');
  const bob = room.add(socket(), 'Bob');
  // Bob drives Alice's car, with her riding along.
  room.seat(bob, { car: alice.id, n: 0 });
  room.seat(alice, { car: alice.id, n: 1 });
  sent.length = 0;
  const isRace = (m: ServerMessage): m is MissionMessage => m.type === 'mission' && m.mission?.kind === 'race' && m.mission.phase === 'briefing';
  for (let t = 0; t < 60 * 60 && !sent.some(isRace); t++) {
    now += 1000;
    room.tick();
    // Until the race, they stay as they are.
    if (!sent.some(isRace)) sent.splice(0);
  }
  const race = sent.findIndex(isRace);
  assert.ok(race >= 0, 'a race came round');
  const moves = sent.slice(0, race).filter((m): m is SeatMessage => m.type === 'seat');
  assert.deepEqual(
    moves.map((m) => [m.id, m.seat]),
    [
      [alice.id, null],
      [bob.id, null],
      [alice.id, { car: alice.id, n: 0 }],
      [bob.id, { car: bob.id, n: 0 }],
    ],
  );
  assert.deepEqual([alice.seat, bob.seat], [{ car: alice.id, n: 0 }, { car: bob.id, n: 0 }]);
  // Each step says where the car that changed hands is.
  assert.deepEqual(moves[1].cars?.map((c) => c.id), [alice.id]);
});
