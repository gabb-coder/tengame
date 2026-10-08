import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  type AvatarState,
  type CarState,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  ROOM_CODE_LENGTH,
  type PlayerInfo,
  type Quat,
  type ServerMessage,
  type Vec3,
} from '../../shared/protocol.ts';

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

  constructor(readonly code: string) {}

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
    return player;
  }

  remove(id: string): void {
    if (this.players.delete(id)) {
      this.broadcast({ type: 'player_left', id });
    }
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

  create(): Room {
    let code: string;
    do {
      code = randomCode();
    } while (this.rooms.has(code));
    const room = new Room(code);
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
    for (const room of this.rooms.values()) room.broadcastSnapshot();
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
