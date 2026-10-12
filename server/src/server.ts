import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ACTS,
  type AvatarState,
  type BotState,
  type CarDamage,
  type CarState,
  type ClientMessage,
  DOOR_REACH,
  GEARS,
  MAX_KNOCK_SPEED,
  MAX_STRIKE_SPEED,
  STRIKES,
  type ServerMessage,
  TICK_RATE,
  type Vec3,
} from '../../shared/protocol.ts';
import { TRIGGER_REACH, TRIGGERS_BY_ID } from '../../shared/activities.ts';
import { APPLIANCE_REACH, type Appliance, appliancesOf, fireAppliances, TV_REMOTE_REACH } from '../../shared/appliances.ts';
import { generateInterior } from '../../shared/interior.ts';
import { doorPosition } from '../../shared/town.ts';
import { generateWorld } from '../../shared/world.ts';
import { RoomManager, type Player, type Room } from './rooms.ts';
import { CIRCUIT_IDS } from '../../shared/circuits.ts';
import { type Difficulty, DIFFICULTIES, MAX_GRID, MAX_LAPS, MIN_LAPS, type RaceSetup } from '../../shared/racing.ts';

const WORLD = generateWorld();
/** Every house in town and out in the zones. */
const HOUSES = new Map(WORLD.houses.map((h) => [h.id, h]));
const APPLIANCES = new Map<string, Appliance>(
  [...[...HOUSES.values()].flatMap((h) => appliancesOf(h, generateInterior(h))), ...fireAppliances(WORLD.fires)].map((a) => [a.id, a]),
);
/** Extra reach allowed on the server, since positions arrive a little late. */
const DOOR_REACH_SLACK = 1.5;
/**
 * A driver can only knock over someone this close to their car (meters, with room for
 * lag), and the same person once a second at most.
 */
const KNOCK_REACH = 10;
const KNOCK_COOLDOWN = 1;
/**
 * A punch or kick only reaches someone this close (meters, with room for lag), and the
 * same person can be hit this often at most (seconds).
 */
const STRIKE_REACH = 3.5;
const STRIKE_COOLDOWN = 0.3;
/** People walking about the world, and the street things a car can smash. */
const NPC_ID = /^npc:[a-z0-9-]{1,40}$/;
const SMASH_ID = /^[a-z]+:[A-Za-z0-9:_.,-]{1,60}$/;
/** Street things light enough to kick over (a car smashes anything). */
const KICKABLE = /^(bin|mailbox|fence):/;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
};

/** Precompressed copies written by scripts/compress.mjs, best first. */
const ENCODINGS = [
  ['br', '.br'],
  ['gzip', '.gz'],
] as const;

export interface GameServer {
  http: Server;
  rooms: RoomManager;
  close(): Promise<void>;
}

export interface GameServerOptions {
  /** Directory of the built client to serve. Static serving is skipped if missing. */
  staticDir?: string;
}

export function createGameServer({ staticDir }: GameServerOptions = {}): GameServer {
  const rooms = new RoomManager();
  const root = staticDir && existsSync(staticDir) ? resolve(staticDir) : undefined;

  const http = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (!root) {
      res.writeHead(404).end();
      return;
    }
    // Resolve inside root only; fall back to index.html for unknown paths.
    let file: string;
    try {
      file = normalize(join(root, decodeURIComponent(url.pathname)));
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(root, 'index.html');
    }
    const hashed = file.startsWith(join(root, 'assets') + sep);
    const stat = statSync(file);
    const headers: Record<string, string | number> = {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      // Built code has content hashes in its file names, so it never changes. Everything else
      // (the page, textures, models) is rechecked each visit, and only resent if it changed.
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      etag: `W/"${stat.size.toString(36)}-${Math.round(stat.mtimeMs).toString(36)}"`,
      vary: 'accept-encoding',
    };
    if (req.headers['if-none-match'] === headers.etag) {
      res.writeHead(304, headers).end();
      return;
    }
    // Send a precompressed copy (made at build time) when the browser accepts one.
    const accepted = String(req.headers['accept-encoding'] ?? '');
    for (const [encoding, suffix] of ENCODINGS) {
      if (new RegExp(`\\b${encoding}\\b`).test(accepted) && existsSync(file + suffix)) {
        file += suffix;
        headers['content-encoding'] = encoding;
        break;
      }
    }
    headers['content-length'] = statSync(file).size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });
  const alive = new WeakSet<WebSocket>();

  wss.on('connection', (socket) => {
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));

    let room: Room | undefined;
    let player: Player | undefined;

    socket.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return sendError(socket, 'bad_request', 'Invalid JSON');
      }
      if (typeof msg !== 'object' || msg === null) {
        return sendError(socket, 'bad_request', 'Expected an object');
      }

      if (msg.type === 'join') {
        if (room) return;
        if (msg.room) {
          room = rooms.get(String(msg.room));
          if (!room) return sendError(socket, 'room_not_found', 'That room does not exist');
          if (room.isFull) {
            room = undefined;
            return sendError(socket, 'room_full', 'That room is full');
          }
        } else {
          const mode = msg.mode === 'missions' || msg.mode === 'racing' ? msg.mode : 'freeroam';
          room = rooms.create(mode, mode === 'racing' ? raceSetup(msg.race) : undefined);
        }
        player = room.add(socket, String(msg.name ?? ''));
        send(socket, {
          type: 'welcome',
          id: player.id,
          room: room.code,
          players: room.info(),
          openDoors: [...room.openDoors],
          switchedOn: [...room.switchedOn],
          mode: room.mode,
          scores: room.scoreTable(),
          mission: room.missions?.snapshot(Date.now()) ?? null,
          race: room.race?.state ?? null,
          clock: room.clock(),
          smashed: room.smashed(),
          now: Date.now(),
        });
      } else if (msg.type === 'time') {
        if (room) room.skipTime(Number(msg.skip));
      } else if (msg.type === 'chat') {
        if (room && player) room.chat(player, String(msg.text ?? ''));
      } else if (msg.type === 'state') {
        if (!player || !isVec(msg.p, 3) || !isVec(msg.q, 4) || !isCarState(msg.car)) return;
        const avatar = msg.avatar ?? null;
        if (avatar !== null && !isAvatarState(avatar)) return;
        player.p = msg.p;
        player.q = msg.q;
        player.car = cleanCar(msg.car);
        player.avatar = avatar && {
          p: avatar.p,
          yaw: avatar.yaw,
          speed: avatar.speed,
          ...(avatar.seated ? { seated: true } : {}),
          ...(avatar.swim ? { swim: true } : {}),
          ...(avatar.act ? { act: avatar.act } : {}),
          ...(avatar.gear ? { gear: avatar.gear } : {}),
          ...(avatar.hurt ? { hurt: true } : {}),
        };
      } else if (msg.type === 'lap') {
        // Racing: a car crossed the line (the referee checks it).
        if (!room?.race || !player || !room.allow(`${player.id}:lap`, 30, 1000)) return;
        const car = msg.car === undefined ? undefined : String(msg.car);
        room.race.lap(player.id, car, Number(msg.lap), Number(msg.time), Number(msg.at), Date.now());
      } else if (msg.type === 'bots') {
        // Racing: the computer cars, from the player whose game drives them.
        if (!room?.race || !player || !Array.isArray(msg.bots) || msg.bots.length > MAX_GRID) return;
        const bots = msg.bots.filter(isBotState).map(({ n, p, q, car }) => ({ n, p, q, car: cleanCar(car) }));
        room.race.botsMoved(player.id, Number(msg.race), bots);
      } else if (msg.type === 'race_setup') {
        // Racing: the host choosing the Grand Prix (each change shown to everyone).
        if (!room?.race || !player || !room.allow(`${player.id}:setup`, 20, 1000)) return;
        const step = msg.step === 'settings' ? 'settings' : 'gp';
        room.race.choose(player.id, raceSetup(msg.setup), step, msg.final === true, Date.now());
      } else if (msg.type === 'race_change') {
        if (room?.race && player) room.race.reopen(player.id, Date.now());
      } else if (msg.type === 'race_start') {
        if (room?.race && player) room.race.startNow(player.id, Date.now());
      } else if (msg.type === 'race_ready') {
        if (room?.race && player) room.race.playerReady(player.id, Date.now());
      } else if (msg.type === 'door') {
        // Only players on foot, standing at that house's door, can use it.
        const house = HOUSES.get(String(msg.id));
        if (!room || !player?.avatar || !house || typeof msg.open !== 'boolean') return;
        const door = doorPosition(house);
        const [x, , z] = player.avatar.p;
        if (Math.hypot(x - door.x, z - door.z) > DOOR_REACH + DOOR_REACH_SLACK) return;
        if (room.openDoors.has(house.id) === msg.open) return;
        if (msg.open) room.openDoors.add(house.id);
        else room.openDoors.delete(house.id);
        room.broadcast({ type: 'door', id: house.id, open: msg.open });
      } else if (msg.type === 'switch') {
        // Likewise, only someone by an appliance (on its floor) can switch it.
        const appliance = APPLIANCES.get(String(msg.id));
        if (!room || !player?.avatar || !appliance || typeof msg.on !== 'boolean') return;
        const [x, y, z] = player.avatar.p;
        // From a seat, TVs work by remote.
        const reach = player.avatar.seated && appliance.kind === 'tv' ? TV_REMOTE_REACH : APPLIANCE_REACH;
        const near = Math.hypot(x - appliance.world.x, z - appliance.world.z) <= reach + DOOR_REACH_SLACK;
        if (!near || Math.abs(y - appliance.floorY) > 1.5) return;
        if (room.switchedOn.has(appliance.id) === msg.on) return;
        if (msg.on) room.switchedOn.add(appliance.id);
        else room.switchedOn.delete(appliance.id);
        room.broadcast({ type: 'switch', id: appliance.id, on: msg.on });
      } else if (msg.type === 'trigger') {
        // Bells, cannons, fireworks: only someone on foot beside one can set it off, and
        // each needs a moment to reset.
        const trigger = TRIGGERS_BY_ID.get(String(msg.id));
        if (!room || !player?.avatar || !trigger) return;
        const [x, y, z] = player.avatar.p;
        if (Math.hypot(x - trigger.x, z - trigger.z) > TRIGGER_REACH + DOOR_REACH_SLACK || Math.abs(y - trigger.y) > 2.5) return;
        if (!room.fire(trigger.id, trigger.cooldown)) return;
        room.broadcast({ type: 'trigger', id: trigger.id, by: player.id });
      } else if (msg.type === 'knock') {
        // The people and animals walking about the world can be knocked over by a car or a
        // kick (everyone else sees them fly too); only a driver can run over a player
        // standing by their car.
        if (!room || !player || !isVec(msg.v, 3)) return;
        const target = String(msg.target ?? '');
        const v = capSpeed(msg.v, MAX_KNOCK_SPEED);
        if (NPC_ID.test(target)) {
          if (room.allow(`${player.id}:knock`, 10, 1000)) room.broadcast({ type: 'knock', target, v, by: player.id }, player.id);
          return;
        }
        if (player.avatar) return;
        const victim = room.players.get(target);
        if (!victim?.avatar || victim === player) return;
        const [x, y, z] = victim.avatar.p;
        const [cx, cy, cz] = player.p;
        if (Math.hypot(x - cx, z - cz) > KNOCK_REACH || Math.abs(y - cy) > 4) return;
        if (!room.fire(`knock:${victim.id}`, KNOCK_COOLDOWN)) return;
        // They fly in their own game; everyone else sees their body fly too.
        room.broadcast({ type: 'knock', target, v, by: player.id }, player.id);
      } else if (msg.type === 'strike') {
        // A punch or a kick: only on foot, at someone in reach (a player on foot, or one of
        // the people about the world). They react in their own game; everyone sees it.
        const target = String(msg.target ?? '');
        const kind = msg.kind;
        if (!room || !player?.avatar || !isVec(msg.v, 3) || !(STRIKES as readonly unknown[]).includes(kind)) return;
        if (!room.allow(`${player.id}:strike`, 6, 1000)) return;
        const v = capSpeed(msg.v, MAX_STRIKE_SPEED);
        if (NPC_ID.test(target)) {
          room.broadcast({ type: 'strike', target, kind, v, by: player.id }, player.id);
          return;
        }
        const victim = room.players.get(target);
        if (!victim?.avatar || victim === player) return;
        const [x, y, z] = victim.avatar.p;
        const [ax, ay, az] = player.avatar.p;
        if (Math.hypot(x - ax, z - az) > STRIKE_REACH || Math.abs(y - ay) > 2) return;
        if (!room.fire(`strike:${victim.id}`, STRIKE_COOLDOWN)) return;
        room.broadcast({ type: 'strike', target, kind, v, by: player.id }, player.id);
      } else if (msg.type === 'smash') {
        // A car (or a kick) knocked over a lamp, a bin, a fence...: it stays down for
        // everyone until it's put back.
        const id = String(msg.id ?? '');
        if (!room || !player || !isVec(msg.v, 3) || !SMASH_ID.test(id)) return;
        if (player.avatar && !KICKABLE.test(id)) return;
        if (!room.allow(`${player.id}:smash`, 20, 1000) || !room.smash(id)) return;
        room.broadcast({ type: 'smash', id, v: capSpeed(msg.v, MAX_KNOCK_SPEED), by: player.id }, player.id);
      }
    });

    socket.on('close', () => {
      if (room && player) rooms.leave(room, player.id);
    });
  });

  const tick = setInterval(() => rooms.tick(), 1000 / TICK_RATE);
  // Drop connections that stop answering pings (e.g. closed laptop lids).
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, 10_000);

  return {
    http,
    rooms,
    close: () =>
      new Promise((done) => {
        clearInterval(tick);
        clearInterval(heartbeat);
        for (const socket of wss.clients) socket.terminate();
        wss.close(() => http.close(() => done()));
      }),
  };
}

function isVec(v: unknown, length: number): v is number[] {
  return (
    Array.isArray(v) &&
    v.length === length &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e5)
  );
}

/** `v` scaled down, if need be, to at most `max` long. */
function capSpeed(v: number[], max: number): Vec3 {
  const k = Math.min(1, max / (Math.hypot(v[0], v[1], v[2]) || 1));
  return [v[0] * k, v[1] * k, v[2] * k];
}

function isDamage(d: unknown): d is CarDamage {
  return isVec(d, 4) && d.every((n) => n >= 0 && n <= 1);
}

function isAvatarState(a: unknown): a is AvatarState {
  if (typeof a !== 'object' || a === null) return false;
  const { p, yaw, speed, seated, swim, act, gear, hurt } = a as Record<string, unknown>;
  const flag = (v: unknown) => v === undefined || typeof v === 'boolean';
  return (
    isVec(p, 3) &&
    isVec([yaw, speed], 2) &&
    flag(seated) &&
    flag(swim) &&
    flag(hurt) &&
    (act === undefined || (ACTS as readonly unknown[]).includes(act)) &&
    (gear === undefined || (GEARS as readonly unknown[]).includes(gear))
  );
}

/** Only the fields a car state has, checked. */
function cleanCar({ steer, rpm, load, speed, braking, dmg, drs }: CarState): CarState {
  return { steer, rpm, load, speed, braking, ...(isDamage(dmg) ? { dmg } : {}), ...(drs === true ? { drs } : {}) };
}

function isBotState(b: unknown): b is BotState {
  if (typeof b !== 'object' || b === null) return false;
  const { n, p, q, car } = b as Record<string, unknown>;
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) < MAX_GRID && isVec(p, 3) && isVec(q, 4) && isCarState(car);
}

/** A new racing room's settings, from what the lobby sent (anything odd falls back to a default). */
function raceSetup(raw: unknown): RaceSetup {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const whole = (v: unknown, min: number, max: number, fallback: number) => (Number.isInteger(v) ? Math.min(max, Math.max(min, v as number)) : fallback);
  return {
    circuit: typeof r.circuit === 'string' && CIRCUIT_IDS.has(r.circuit) ? r.circuit : 'sepang',
    laps: whole(r.laps, MIN_LAPS, MAX_LAPS, 5),
    bots: whole(r.bots, 0, MAX_GRID - 1, 9),
    difficulty: DIFFICULTIES.includes(r.difficulty as Difficulty) ? (r.difficulty as Difficulty) : 'normal',
  };
}

function isCarState(c: unknown): c is CarState {
  if (typeof c !== 'object' || c === null) return false;
  const { steer, rpm, load, speed, braking } = c as Record<string, unknown>;
  return isVec([steer, rpm, load, speed], 4) && typeof braking === 'boolean';
}

function send(socket: WebSocket, msg: ServerMessage): void {
  socket.send(JSON.stringify(msg));
}

function sendError(socket: WebSocket, code: 'room_full' | 'room_not_found' | 'bad_request', message: string): void {
  send(socket, { type: 'error', code, message });
}
