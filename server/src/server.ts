import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { TICK_RATE, type CarState, type ClientMessage, type ServerMessage } from '../../shared/protocol.ts';
import { RoomManager, type Player, type Room } from './rooms.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
};

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
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
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
          room = rooms.create();
        }
        player = room.add(socket, String(msg.name ?? ''));
        send(socket, { type: 'welcome', id: player.id, room: room.code, players: room.info() });
      } else if (msg.type === 'state') {
        if (!player || !isVec(msg.p, 3) || !isVec(msg.q, 4) || !isCarState(msg.car)) return;
        player.p = msg.p;
        player.q = msg.q;
        const { steer, rpm, load, speed, braking } = msg.car;
        player.car = { steer, rpm, load, speed, braking };
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
