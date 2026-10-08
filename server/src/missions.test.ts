import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MissionKind, MissionState, Vec3 } from '../../shared/protocol.ts';
import { ASPHALT_WIDTH, mulberry32, PITCH, roadCenter } from '../../shared/town.ts';
import { BRIEFING_MS, DONE_MS, MissionManager, type MissionPlayer, REACH } from './missions.ts';

/** A pretend room: players we move by hand, and a log of what the manager announced. */
function setup(kind: MissionKind, seed = 1) {
  const players: MissionPlayer[] = [
    { id: 'a', name: 'Alice', p: [0, 0.6, 0], avatar: null },
    { id: 'b', name: 'Bob', p: [5, 0.6, 0], avatar: null },
  ];
  const published: MissionState[] = [];
  const notices: string[] = [];
  const awards: [string, number][] = [];
  const host = {
    players: () => players,
    publish: (s: MissionState) => published.push(structuredClone(s)),
    notice: (t: string) => notices.push(t),
    award: (id: string, pts: number) => awards.push([id, pts]),
  };
  // Find a seed whose rotation starts with the wanted mission kind.
  let s = seed;
  let m: MissionManager;
  for (;;) {
    m = new MissionManager(host, mulberry32(s));
    m.tick(0);
    if (m.state!.kind === kind) break;
    s++;
    published.length = 0;
  }
  let now = 0;
  const advance = (ms: number) => {
    // Tick at 20 Hz like the server.
    for (let t = 0; t < ms; t += 50) m.tick((now += 50));
  };
  return { m, players, published, notices, awards, advance, get now() { return now; } };
}

const near = (p: Vec3, dx = 0.5): Vec3 => [p[0] + dx, p[1], p[2]];

test('delivery: pick up by car, deliver on foot at the door, score points', () => {
  const t = setup('delivery');
  assert.equal(t.m.state!.phase, 'briefing');
  t.advance(BRIEFING_MS + 100);
  assert.equal(t.m.state!.phase, 'active');
  const [pickup, dropoff] = t.m.state!.targets;
  assert.equal(pickup.kind, 'pickup');
  assert.equal(dropoff.kind, 'dropoff');

  // Driving past the dropoff without the package does nothing.
  t.players[1].avatar = { p: near(dropoff.p), yaw: 0, speed: 0 };
  t.advance(200);
  assert.equal(t.m.state!.phase, 'active');
  t.players[1].avatar = null;

  // Alice drives to the pickup and gets the package.
  t.players[0].p = near(pickup.p, 2);
  t.advance(100);
  assert.equal(t.m.state!.carrier, 'a');
  assert.deepEqual(t.m.state!.targets.map((x) => x.kind), ['dropoff']);

  // Arriving by car isn't enough: you walk it to the door.
  t.players[0].p = near(dropoff.p, 1);
  t.advance(200);
  assert.equal(t.m.state!.phase, 'active');
  t.players[0].avatar = { p: near(dropoff.p), yaw: 0, speed: 0 };
  t.advance(100);
  assert.equal(t.m.state!.phase, 'done');
  assert.equal(t.awards.length, 1);
  assert.equal(t.awards[0][0], 'a');
  assert.ok(t.awards[0][1] > 100 && t.awards[0][1] <= 250);
  assert.match(t.m.state!.result!, /^Alice delivered it/);

  // Then the next mission starts on its own.
  t.advance(DONE_MS + 100);
  assert.equal(t.m.state!.id, 2);
  assert.equal(t.m.state!.phase, 'briefing');
  assert.notEqual(t.m.state!.kind, 'delivery');
});

test('delivery: the package goes back if its carrier leaves', () => {
  const t = setup('delivery');
  t.advance(BRIEFING_MS + 100);
  const pickup = t.m.state!.targets[0];
  t.players[1].p = near(pickup.p);
  t.advance(100);
  assert.equal(t.m.state!.carrier, 'b');
  t.players.pop();
  t.m.playerLeft('b', t.now);
  assert.equal(t.m.state!.carrier, null);
  assert.equal(t.m.state!.targets.length, 2);
});

test('delivery: times out with nobody scoring', () => {
  const t = setup('delivery');
  t.advance(BRIEFING_MS + 150_000 + 100);
  assert.equal(t.m.state!.phase, 'done');
  assert.match(t.m.state!.result!, /Time up/);
  assert.equal(t.awards.length, 0);
});

test('race: a valid course along the streets, a starting grid on the road', () => {
  for (let seed = 1; seed < 40; seed++) {
    const t = setup('race', seed);
    const s = t.m.state!;
    const cps = s.checkpoints!;
    assert.equal(cps.length, 6);
    const lines = [0, 1, 2, 3].map(roadCenter);
    for (const [x, , z] of cps) assert.ok(lines.includes(x) && lines.includes(z), 'checkpoint not at an intersection');
    for (let i = 1; i < cps.length; i++) {
      assert.ok(Math.abs(Math.hypot(cps[i][0] - cps[i - 1][0], cps[i][2] - cps[i - 1][2]) - PITCH) < 1e-6, 'checkpoints not adjacent');
      if (i > 1) assert.ok(cps[i][0] !== cps[i - 2][0] || cps[i][2] !== cps[i - 2][2], 'course doubles back');
    }
    for (const id of ['a', 'b']) {
      const { p } = s.grid![id];
      const onRoad = lines.some((c) => Math.abs(p[0] - c) < ASPHALT_WIDTH / 2) || lines.some((c) => Math.abs(p[2] - c) < ASPHALT_WIDTH / 2);
      assert.ok(onRoad, `grid slot ${p} not on a road`);
    }
    assert.notDeepEqual(s.grid!.a.p, s.grid!.b.p);
  }
});

test('race: checkpoints in order, by car only; finishing order scores', () => {
  const t = setup('race');
  t.advance(BRIEFING_MS + 100);
  const cps = t.m.state!.checkpoints!;
  // Bob skips ahead to the last checkpoint: doesn't count.
  t.players[1].p = near(cps[5]);
  t.advance(100);
  assert.equal(t.m.state!.progress!.b, 0);
  // On foot doesn't count either.
  t.players[0].avatar = { p: near(cps[0]), yaw: 0, speed: 0 };
  t.players[0].p = near(cps[0]);
  t.advance(100);
  assert.equal(t.m.state!.progress!.a, 0);
  t.players[0].avatar = null;

  for (const cp of cps) {
    t.players[0].p = near(cp, REACH.checkpoint - 1);
    t.advance(100);
  }
  assert.equal(t.m.state!.progress!.a, 6);
  assert.deepEqual(t.m.state!.finished, ['a']);
  assert.ok(t.notices.some((n) => /Alice finished 1st/.test(n)));
  for (const cp of cps) {
    t.players[1].p = near(cp);
    t.advance(100);
  }
  // Everyone's in: the race ends.
  assert.equal(t.m.state!.phase, 'done');
  assert.equal(t.m.state!.result, 'Alice won the race!');
  assert.deepEqual(t.awards, [
    ['a', 150],
    ['b', 100],
  ]);
});

test('fetch: the item is inside a house, and only someone walking up to it finds it', () => {
  const t = setup('fetch');
  t.advance(BRIEFING_MS + 100);
  const item = t.m.state!.targets[0];
  assert.equal(item.kind, 'item');
  assert.ok(item.p[1] > 0.5, 'item should be on furniture, above the floor');
  // A car parked on top of it (impossible, but) doesn't count; standing a floor below doesn't either.
  t.players[0].p = near(item.p, 0.2);
  t.players[1].avatar = { p: [item.p[0], item.p[1] - 3, item.p[2]], yaw: 0, speed: 0 };
  t.advance(200);
  assert.equal(t.m.state!.phase, 'active');
  // Bob walks up to it on the right floor.
  t.players[1].avatar = { p: [item.p[0] + 0.8, item.p[1] - 0.8, item.p[2]], yaw: 0, speed: 1 };
  t.advance(100);
  assert.equal(t.m.state!.phase, 'done');
  assert.equal(t.awards[0][0], 'b');
  assert.match(t.m.state!.result!, /^Bob found the/);
});

test('snapshots count down the time left in the phase', () => {
  const t = setup('fetch');
  t.advance(1000);
  const left = t.m.snapshot(t.now)!.timeLeft;
  assert.ok(left > BRIEFING_MS - 1200 && left <= BRIEFING_MS - 900, `timeLeft ${left}`);
});
