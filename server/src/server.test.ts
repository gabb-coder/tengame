import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { MAX_PLAYERS, type ServerMessage } from '../../shared/protocol.ts';
import { doorPosition, generateTown } from '../../shared/town.ts';
import { createGameServer, type GameServer } from './server.ts';

let server: GameServer;
let url: string;

before(async () => {
  server = createGameServer();
  await new Promise<void>((done) => server.http.listen(0, done));
  url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}/ws`;
});

after(() => server.close());

class TestClient {
  readonly inbox: ServerMessage[] = [];
  private waiters: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      this.inbox.push(JSON.parse(data.toString()));
      this.waiters.splice(0).forEach((w) => w());
    });
  }

  static async connect(): Promise<TestClient> {
    const ws = new WebSocket(url);
    await new Promise((done, fail) => ws.once('open', done).once('error', fail));
    return new TestClient(ws);
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  async next<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + 2000;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.type === type);
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
      await new Promise<void>((done) => {
        this.waiters.push(done);
        setTimeout(done, 50);
      });
    }
  }

  close(): void {
    this.ws.close();
  }
}

test('players in the same room see each other move', async () => {
  const a = await TestClient.connect();
  a.send({ type: 'join', name: 'Alice' });
  const welcomeA = await a.next('welcome');
  assert.equal(welcomeA.players.length, 1);
  assert.match(welcomeA.room, /^[A-Z2-9]{5}$/);

  const b = await TestClient.connect();
  b.send({ type: 'join', name: 'Bob', room: welcomeA.room.toLowerCase() });
  const welcomeB = await b.next('welcome');
  assert.equal(welcomeB.room, welcomeA.room);
  assert.deepEqual(welcomeB.players.map((p) => p.name).sort(), ['Alice', 'Bob']);

  const joined = await a.next('player_joined');
  assert.equal(joined.player.name, 'Bob');
  assert.notEqual(joined.player.color, welcomeA.players[0].color);

  const car = { steer: 0.2, rpm: 3000, load: 1, speed: 12, braking: false };
  b.send({ type: 'state', p: [3, 1, -2], q: [0, 0, 0, 1], car: { ...car, extra: 'dropped' } });
  let bob;
  for (let i = 0; i < 10 && !bob; i++) {
    const snap = await a.next('snapshot');
    bob = snap.players.find((p) => p.id === welcomeB.id && p.p[0] === 3);
  }
  assert.deepEqual(bob?.p, [3, 1, -2]);
  assert.deepEqual(bob?.car, car);

  b.close();
  assert.equal((await a.next('player_left')).id, welcomeB.id);
  a.close();
});

test('rejects invalid state and sanitizes names', async () => {
  const a = await TestClient.connect();
  a.send({ type: 'join', name: '<script>alert(1)</script>a very long name indeed' });
  const welcome = await a.next('welcome');
  assert.equal(welcome.players[0].name, 'scriptalert1scri');

  const car = { steer: 0, rpm: 900, load: 0, speed: 0, braking: false };
  a.send({ type: 'state', p: [Infinity, 0, 0], q: [0, 0, 0, 1], car });
  a.send({ type: 'state', p: [1, 2], q: [0, 0, 0, 1], car });
  a.send({ type: 'state', p: [5, 5, 5], q: [0, 0, 0, 1] });
  a.send({ type: 'state', p: [5, 5, 5], q: [0, 0, 0, 1], car: { ...car, braking: 'yes' } });
  a.ws.send('not json');
  assert.equal((await a.next('error')).code, 'bad_request');
  a.send(null as unknown as object);
  assert.equal((await a.next('error')).code, 'bad_request');

  const stored = server.rooms.get(welcome.room)!.players.get(welcome.id)!;
  assert.deepEqual(stored.p, [0, 1, 0]);
  a.close();
});

test(`room is limited to ${MAX_PLAYERS} players`, async () => {
  const host = await TestClient.connect();
  host.send({ type: 'join', name: 'Host' });
  const { room } = await host.next('welcome');

  const guests = [];
  for (let i = 1; i < MAX_PLAYERS; i++) {
    const g = await TestClient.connect();
    g.send({ type: 'join', name: `G${i}`, room });
    await g.next('welcome');
    guests.push(g);
  }

  const extra = await TestClient.connect();
  extra.send({ type: 'join', name: 'Extra', room });
  assert.equal((await extra.next('error')).code, 'room_full');

  const lost = await TestClient.connect();
  lost.send({ type: 'join', name: 'Lost', room: 'ZZZZZ' });
  assert.equal((await lost.next('error')).code, 'room_not_found');

  for (const c of [host, ...guests, extra, lost]) c.close();
});

test('empty rooms are deleted', async () => {
  const a = await TestClient.connect();
  a.send({ type: 'join', name: 'Solo' });
  const { room } = await a.next('welcome');
  assert.ok(server.rooms.get(room));
  a.close();
  for (let i = 0; i < 20 && server.rooms.get(room); i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(server.rooms.get(room), undefined);
});

test('players on foot can open and close doors they stand at', async () => {
  const house = generateTown().houses[5];
  const door = doorPosition(house);
  const car = { steer: 0, rpm: 0, load: 0, speed: 0, braking: false };
  const standAt = (x: number, z: number) => ({ type: 'state', p: [0, 1, 0], q: [0, 0, 0, 1], car, avatar: { p: [x, 0.2, z], yaw: 0, speed: 0 } });

  const a = await TestClient.connect();
  a.send({ type: 'join', name: 'Alice' });
  const { room } = await a.next('welcome');
  const b = await TestClient.connect();
  b.send({ type: 'join', name: 'Bob', room });
  assert.deepEqual((await b.next('welcome')).openDoors, []);

  // In the car: ignored. Far away on foot: ignored. Unknown house: ignored.
  a.send({ type: 'door', id: house.id, open: true });
  a.send(standAt(door.x + 20, door.z));
  await a.next('snapshot');
  a.send({ type: 'door', id: house.id, open: true });
  a.send({ type: 'door', id: 'nope', open: true });

  a.send(standAt(door.x + 0.5, door.z + 0.8));
  await a.next('snapshot');
  a.send({ type: 'door', id: house.id, open: true });
  assert.deepEqual(await b.next('door'), { type: 'door', id: house.id, open: true });
  assert.deepEqual(await a.next('door'), { type: 'door', id: house.id, open: true });
  assert.equal(a.inbox.filter((m) => m.type === 'door').length, 0, 'earlier requests were rejected');

  // Late joiners see it open.
  const c = await TestClient.connect();
  c.send({ type: 'join', name: 'Cat', room });
  assert.deepEqual((await c.next('welcome')).openDoors, [house.id]);

  a.send({ type: 'door', id: house.id, open: false });
  assert.equal((await b.next('door')).open, false);
  for (const client of [a, b, c]) client.close();
});

test('rejects malformed avatar state', async () => {
  const a = await TestClient.connect();
  a.send({ type: 'join', name: 'Alice' });
  const welcome = await a.next('welcome');
  const car = { steer: 0, rpm: 0, load: 0, speed: 0, braking: false };
  a.send({ type: 'state', p: [1, 1, 1], q: [0, 0, 0, 1], car, avatar: { p: [1, 2], yaw: 0, speed: 0 } });
  a.send({ type: 'state', p: [1, 1, 1], q: [0, 0, 0, 1], car, avatar: { p: [1, 2, 3], yaw: 'x', speed: 0 } });
  a.send({ type: 'state', p: [2, 2, 2], q: [0, 0, 0, 1], car, avatar: { p: [1, 2, 3], yaw: 0.5, speed: 1, extra: true } });
  await new Promise((r) => setTimeout(r, 100));
  const stored = server.rooms.get(welcome.room)!.players.get(welcome.id)!;
  assert.deepEqual(stored.p, [2, 2, 2]);
  assert.deepEqual(stored.avatar, { p: [1, 2, 3], yaw: 0.5, speed: 1 });
  a.close();
});
