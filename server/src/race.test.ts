import assert from 'node:assert/strict';
import { test } from 'node:test';
import { circuitInfo } from '../../shared/circuits.ts';
import type { RaceState } from '../../shared/protocol.ts';
import { GRID_MS, LIGHT_MS, LOAD_WAIT_MS, MAX_GRID, MAX_LAP_SPEED, NEXT_GRID_MS, RESULTS_MS, type RaceSetup } from '../../shared/racing.ts';
import { RaceManager, type RacePlayer } from './race.ts';

const SETUP: RaceSetup = { circuit: 'monza', laps: 2, bots: 3, difficulty: 'normal' };
/** A believable lap of Monza (s). */
const LAP = 92;

/** A pretend room: players we add and remove by hand, and what the race announced. */
function setup(race: RaceSetup = SETUP) {
  const players: RacePlayer[] = [{ id: 'a', name: 'Alice' }];
  const published: RaceState[] = [];
  const notices: string[] = [];
  const m = new RaceManager({ players: () => players, publish: (s) => published.push(structuredClone(s)), notice: (t) => notices.push(t) }, race, 0, () => 0.5);
  m.join();
  let now = 0;
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 50) m.tick((now += 50));
  };
  /** Seconds into the race right now. */
  const at = () => (now - m.state.startAt) / 1000;
  /** Starts the race (everyone's game loads, countdown and lights) and returns once the lights are out. */
  const start = () => {
    for (const p of players) m.playerReady(p.id, now);
    advance(GRID_MS + 50);
    assert.equal(m.state.phase, 'lights');
    advance(m.state.startAt - now + 50);
    assert.equal(m.state.phase, 'racing');
  };
  return { m, players, published, notices, advance, at, start, get now() { return now; } };
}

test('a race lines up the players among the computer drivers, then counts down to five red lights and the start', () => {
  const t = setup();
  const ids = t.m.state.cars.map((c) => c.id);
  assert.deepEqual(ids, ['bot:0', 'a', 'bot:1', 'bot:2']);
  assert.equal(t.m.state.host, 'a');
  assert.ok(new Set(t.m.state.cars.map((c) => c.name)).size === 4, 'everyone has a name');
  // The countdown waits for the host's game to build the circuit.
  t.advance(GRID_MS + 1000);
  assert.equal(t.m.state.phase, 'grid');
  t.m.playerReady('a', t.now);
  t.advance(GRID_MS - 1000);
  assert.equal(t.m.state.phase, 'grid');
  t.advance(1100);
  assert.equal(t.m.state.phase, 'lights');
  // Five lights a second apart, then a pause before they go out.
  assert.ok(t.m.state.startAt - t.m.state.lightsAt > 5 * LIGHT_MS);
  t.advance(t.m.state.startAt - t.now + 50);
  assert.equal(t.m.state.phase, 'racing');
});

test('only the player running the race can start it early', () => {
  const t = setup();
  t.players.push({ id: 'b', name: 'Bob' });
  t.m.join();
  t.m.playerReady('a', 50);
  t.m.playerReady('b', 50);
  t.m.startNow('b', 100);
  assert.equal(t.m.state.phase, 'grid');
  t.m.startNow('a', 100);
  assert.equal(t.m.state.phase, 'lights');
});

test('the lights wait for a friend still loading the circuit, but not for ever', () => {
  const t = setup();
  t.m.playerReady('a', t.now);
  t.advance(GRID_MS - 2000);
  // A friend joins with two seconds to go; their game takes a while to build the circuit.
  t.players.push({ id: 'b', name: 'Bob' });
  t.m.join();
  assert.equal(t.m.state.cars.find((c) => c.id === 'b')?.loading, true);
  t.advance(5000);
  assert.equal(t.m.state.phase, 'grid', 'waiting for Bob');
  t.m.playerReady('b', t.now);
  assert.equal(t.m.state.cars.find((c) => c.id === 'b')?.loading, undefined);
  t.advance(100);
  assert.equal(t.m.state.phase, 'lights');

  // A friend whose game never finishes loading holds the start up only so long.
  const u = setup();
  u.m.playerReady('a', u.now);
  u.players.push({ id: 'c', name: 'Cat' });
  u.m.join();
  u.advance(GRID_MS + LOAD_WAIT_MS - 1000);
  assert.equal(u.m.state.phase, 'grid');
  u.advance(1100);
  assert.equal(u.m.state.phase, 'lights');
});

test('lap reports are checked: the right lap, a possible time, the right moment, from the right player', () => {
  const t = setup();
  t.start();
  t.advance(LAP * 1000);
  const shortest = circuitInfo('monza').length / MAX_LAP_SPEED;
  assert.equal(t.m.lap('a', undefined, 2, LAP, t.at(), t.now), false, 'skipping a lap');
  assert.equal(t.m.lap('a', undefined, 1, shortest - 1, t.at(), t.now), false, 'faster than possible');
  assert.equal(t.m.lap('a', undefined, 1, LAP, t.at() - 40, t.now), false, 'at the wrong moment');
  assert.equal(t.m.lap('a', 'bot:1', 1, LAP, t.at(), t.now), true, 'the host reports a computer driver');
  t.players.push({ id: 'b', name: 'Bob' });
  t.m.join();
  assert.equal(t.m.lap('b', 'bot:2', 1, LAP, t.at(), t.now), false, 'only the host reports computer drivers');
  assert.equal(t.m.lap('b', undefined, 1, LAP, t.at(), t.now), false, 'joined mid-race: watching, not racing');
  assert.equal(t.m.lap('a', 'b', 1, LAP, t.at(), t.now), false, "nobody reports another player's laps");
  assert.equal(t.m.lap('a', undefined, 1, LAP, t.at(), t.now), true);
  const alice = t.m.state.cars.find((c) => c.id === 'a')!;
  assert.equal(alice.laps, 1);
  assert.equal(alice.best, LAP);
});

test('the winner takes the flag, the rest finish as they next cross the line, then results and the next race', () => {
  const t = setup();
  t.start();
  const bots = ['bot:0', 'bot:1', 'bot:2'];
  t.advance(LAP * 1000);
  for (const id of ['a', ...bots]) assert.ok(t.m.lap('a', id === 'a' ? undefined : id, 1, LAP, t.at(), t.now));
  t.advance(LAP * 1000);
  assert.ok(t.m.lap('a', 'bot:1', 2, LAP, t.at(), t.now));
  assert.equal(t.m.state.flag, true);
  assert.deepEqual(t.notices, [`${t.m.state.cars.find((c) => c.id === 'bot:1')!.name} wins!`]);
  // A car a lap down finishes the next time it crosses the line too.
  t.advance(1000);
  assert.ok(t.m.lap('a', undefined, 2, LAP + 1, t.at(), t.now));
  t.advance(300);
  assert.ok(t.m.lap('a', 'bot:0', 2, LAP + 1, t.at(), t.now));
  assert.equal(t.m.state.phase, 'racing');
  assert.ok(t.m.lap('a', 'bot:2', 2, LAP + 2, t.at(), t.now));
  assert.equal(t.m.state.phase, 'finished');
  assert.deepEqual(t.m.standings().map((c) => c.id), ['bot:1', 'a', 'bot:0', 'bot:2']);
  t.advance(RESULTS_MS + 100);
  assert.equal(t.m.state.phase, 'grid');
  assert.equal(t.m.state.number, 2);
  assert.ok(t.m.state.cars.every((c) => c.laps === 0 && c.finish === null));
  assert.ok(t.m.state.until - t.now <= NEXT_GRID_MS);
});

test('players joining fill the grid (computer drivers make way); leaving hands the computer cars to someone else', () => {
  const t = setup({ ...SETUP, bots: MAX_GRID - 1 });
  assert.equal(t.m.state.cars.length, MAX_GRID);
  t.players.push({ id: 'b', name: 'Bob' });
  t.m.join();
  assert.equal(t.m.state.cars.length, MAX_GRID);
  assert.equal(t.m.state.cars.filter((c) => c.bot).length, MAX_GRID - 2);
  // Teams of their own.
  const team = (id: string) => t.m.state.cars.find((c) => c.id === id)!.team;
  assert.notEqual(team('a'), team('b'));
  t.start();
  t.players.shift();
  t.m.leave('a');
  assert.equal(t.m.state.host, 'b');
  assert.equal(t.m.state.cars.find((c) => c.id === 'a')!.out, true);
  // With nobody left racing, it's over.
  t.players.shift();
  t.m.leave('b');
  t.advance(100);
  assert.equal(t.m.state.phase, 'finished');
});
