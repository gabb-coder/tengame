import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { brotliCompressSync } from 'node:zlib';
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

test('missions rooms start a mission and keep scores; free roam has none', async () => {
  const a = await TestClient.connect();
  a.send({ type: 'join', name: 'Alice', mode: 'missions' });
  const welcome = await a.next('welcome');
  assert.equal(welcome.mode, 'missions');
  assert.deepEqual(welcome.scores, { [welcome.id]: 0 });
  const { mission } = await a.next('mission');
  assert.equal(mission!.phase, 'briefing');
  assert.equal(mission!.id, 1);
  assert.ok(mission!.timeLeft > 0);

  // A late joiner gets the mission in progress with their welcome.
  const b = await TestClient.connect();
  b.send({ type: 'join', name: 'Bob', room: welcome.room });
  const wb = await b.next('welcome');
  assert.equal(wb.mission?.id, 1);
  assert.deepEqual(Object.keys(wb.scores).sort(), [welcome.id, wb.id].sort());

  const c = await TestClient.connect();
  c.send({ type: 'join', name: 'Cat' });
  const wc = await c.next('welcome');
  assert.equal(wc.mode, 'freeroam');
  assert.equal(wc.mission, null);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(c.inbox.filter((m) => m.type === 'mission').length, 0);
  for (const x of [a, b, c]) x.close();
});

test('chat is relayed to the room, cleaned up, and rate limited', async () => {
  const a = await TestClient.connect();
  a.send({ type: 'join', name: 'Alice' });
  const { room } = await a.next('welcome');
  const b = await TestClient.connect();
  b.send({ type: 'join', name: 'Bob', room });
  await b.next('welcome');

  a.send({ type: 'chat', text: '  hi\nthere <b>bob</b>  ' });
  const msg = await b.next('chat');
  assert.equal(msg.name, 'Alice');
  assert.equal(msg.text, 'hi there <b>bob</b>'); // control chars stripped; HTML is rendered as text by clients
  assert.equal((await a.next('chat')).text, msg.text);

  a.send({ type: 'chat', text: '   ' });
  a.send({ type: 'chat', text: 'x'.repeat(500) });
  assert.equal((await b.next('chat')).text.length, 200);

  // Flooding: only the first few in a burst get through.
  for (let i = 0; i < 10; i++) a.send({ type: 'chat', text: `spam ${i}` });
  await new Promise((r) => setTimeout(r, 200));
  const spam = b.inbox.filter((m) => m.type === 'chat');
  assert.ok(spam.length <= 4, `${spam.length} spam messages got through`);
  for (const x of [a, b]) x.close();
});

test('rooms share a clock; free roam players can skip ahead, missions players cannot', async () => {
  const a = await TestClient.connect();
  a.send({ type: 'join', name: 'Alice' });
  const w = await a.next('welcome');
  assert.ok(w.clock.hours >= 9 && w.clock.hours < 9.1, `starts at ${w.clock.hours}`);
  assert.ok(w.clock.rate > 0);
  a.send({ type: 'time', skip: 3 });
  const t = await a.next('time');
  assert.ok(Math.abs(t.clock.hours - 12) < 0.1, `skipped to ${t.clock.hours}`);
  // Too soon after the last skip: ignored.
  a.send({ type: 'time', skip: 3 });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(a.inbox.filter((m) => m.type === 'time').length, 0);

  const m = await TestClient.connect();
  m.send({ type: 'join', name: 'Max', mode: 'missions' });
  await m.next('welcome');
  m.send({ type: 'time', skip: 5 });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(m.inbox.filter((x) => x.type === 'time').length, 0);
  a.close();
  m.close();
});

test('serves the built client, precompressed when the browser accepts it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tengame-static-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(dir, 'assets', 'app-123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'app-123.js.br'), brotliCompressSync('console.log(1)'));
  const web = createGameServer({ staticDir: dir });
  await new Promise<void>((done) => web.http.listen(0, done));
  const base = `http://127.0.0.1:${(web.http.address() as AddressInfo).port}`;
  try {
    const js = await fetch(`${base}/assets/app-123.js`, { headers: { 'accept-encoding': 'gzip, br' } });
    assert.equal(js.headers.get('content-encoding'), 'br');
    assert.equal(js.headers.get('content-type'), 'text/javascript');
    assert.match(js.headers.get('cache-control') ?? '', /immutable/);
    assert.equal(await js.text(), 'console.log(1)'); // fetch decodes it

    const plain = await fetch(`${base}/assets/app-123.js`, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.equal(await plain.text(), 'console.log(1)');

    // Unknown paths (like an invite link) get the page, which must not be cached long.
    const page = await fetch(`${base}/?room=ABCDE`);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    assert.match(await page.text(), /<title>t<\/title>/);

    // A file the browser already has is not sent again.
    const again = await fetch(`${base}/?room=ABCDE`, { headers: { 'if-none-match': page.headers.get('etag')! } });
    assert.equal(again.status, 304);

    const escape = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
    assert.match(await escape.text(), /<title>t<\/title>/);
  } finally {
    await web.close();
    rmSync(dir, { recursive: true });
  }
});
