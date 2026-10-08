import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  type AvatarState,
  type CarState,
  type GameMode,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  ROOM_CODE_LENGTH,
  type PlayerInfo,
  type Quat,
  type ServerMessage,
  type Vec3,
} from '../../shared/protocol.ts';
import { MissionManager } from './missions.ts';

/** Chat flood control: at most this many messages per window. */
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 5000;

// Distinct, readable colors assigned by join slot.
const PLAYER_COLORS = ['#e4572e', '#29a3e0', '#f2c14e', '#6cbf54'];
// No 0/O or 1/I so codes are easy to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface Player extends PlayerInfo {
  socket: WebSocket;
  p: Vec3;
  q: Quat;
  car: CarState;
  avatar: AvatarState | null;
}

export class Room {
  readonly players = new Map<string, Player>();
  /** House ids whose front doors are open. */
  readonly openDoors = new Set<string>();
  /** Mission points by player id. */
  readonly scores = new Map<string, number>();
  readonly missions: MissionManager | null;
  private chatTimes = new Map<string, number[]>();

  constructor(
    readonly code: string,
    readonly mode: GameMode = 'freeroam',
    private now: () => number = Date.now,
  ) {
    this.missions =
      mode === 'missions'
        ? new MissionManager({
            players: () => [...this.players.values()],
            publish: (mission) => this.broadcast({ type: 'mission', mission }),
            notice: (text) => this.broadcast({ type: 'notice', text }),
            award: (id, points) => {
              this.scores.set(id, (this.scores.get(id) ?? 0) + points);
              this.broadcast({ type: 'scores', scores: this.scoreTable() });
            },
          })
        : null;
  }

  get isFull(): boolean {
    return this.players.size >= MAX_PLAYERS;
  }

  add(socket: WebSocket, rawName: string): Player {
    const used = new Set([...this.players.values()].map((pl) => pl.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
    const player: Player = {
      id: randomUUID(),
      name: sanitizeName(rawName),
      color,
      socket,
      p: [0, 1, 0],
      q: [0, 0, 0, 1],
      car: { steer: 0, rpm: 0, load: 0, speed: 0, braking: false },
      avatar: null,
    };
    this.broadcast({ type: 'player_joined', player: toInfo(player) });
    this.players.set(player.id, player);
    if (this.mode === 'missions') this.scores.set(player.id, 0);
    return player;
  }

  remove(id: string): void {
    if (this.players.delete(id)) {
      this.scores.delete(id);
      this.chatTimes.delete(id);
      this.missions?.playerLeft(id, this.now());
      this.broadcast({ type: 'player_left', id });
    }
  }

  scoreTable(): Record<string, number> {
    return Object.fromEntries(this.scores);
  }

  /** Relays a chat line from `player`, unless it's empty or they're flooding. */
  chat(player: Player, raw: string): void {
    // Strip control characters; the client renders text, never HTML.
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
    if (!text) return;
    const now = this.now();
    const recent = (this.chatTimes.get(player.id) ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_BURST) return;
    recent.push(now);
    this.chatTimes.set(player.id, recent);
    this.broadcast({ type: 'chat', id: player.id, name: player.name, text });
  }

  tick(): void {
    this.missions?.tick(this.now());
    this.broadcastSnapshot();
  }

  info(): PlayerInfo[] {
    return [...this.players.values()].map(toInfo);
  }

  broadcastSnapshot(): void {
    if (this.players.size < 2) return;
    this.broadcast({
      type: 'snapshot',
      players: [...this.players.values()].map(({ id, p, q, car, avatar }) => ({ id, p, q, car, avatar })),
    });
  }

  broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const pl of this.players.values()) {
      if (pl.socket.readyState === pl.socket.OPEN) pl.socket.send(data);
    }
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  create(mode: GameMode = 'freeroam'): Room {
    let code: string;
    do {
      code = randomCode();
    } while (this.rooms.has(code));
    const room = new Room(code, mode);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Removes the player and deletes the room once it is empty. */
  leave(room: Room, playerId: string): void {
    room.remove(playerId);
    if (room.players.size === 0) this.rooms.delete(room.code);
  }

  tick(): void {
    for (const room of this.rooms.values()) room.tick();
  }
}

function toInfo({ id, name, color }: Player): PlayerInfo {
  return { id, name, color };
}

function sanitizeName(raw: string): string {
  const name = raw.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  return name || 'Driver';
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}
