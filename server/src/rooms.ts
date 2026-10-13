import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  type AvatarState,
  type CarPose,
  type CarSeat,
  type CarState,
  type Clock,
  DAY_RATE,
  type GameMode,
  START_HOUR,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  ROOM_CODE_LENGTH,
  type PlayerInfo,
  type Quat,
  type ServerMessage,
  SMASH_REPAIR_SECONDS,
  type Vec3,
} from '../../shared/protocol.ts';
import { DRIVER, sameSeat } from '../../shared/seats.ts';
import { MissionManager } from './missions.ts';
import { RaceManager } from './race.ts';
import { CIRCUITS } from '../../shared/circuits.ts';
import type { RaceSetup } from '../../shared/racing.ts';

/** Chat flood control: at most this many messages per window. */
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 5000;
/** At most this many street things lie smashed in a room at once. */
const MAX_SMASHED = 800;

// Distinct, readable colors assigned by join slot.
const PLAYER_COLORS = ['#e4572e', '#29a3e0', '#f2c14e', '#6cbf54'];
// No 0/O or 1/I so codes are easy to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface Player extends PlayerInfo {
  socket: WebSocket;
  /** Their car: where it is and what it's doing (whoever is driving it). */
  p: Vec3;
  q: Quat;
  car: CarState;
  avatar: AvatarState | null;
  /** Where they sit, in their own car or someone else's; null on foot. */
  seat: CarSeat | null;
}

export class Room {
  readonly players = new Map<string, Player>();
  /** House ids whose front doors are open. */
  readonly openDoors = new Set<string>();
  /** Appliances (TVs, lamps, stoves) that are switched on. */
  readonly switchedOn = new Set<string>();
  /** Mission points by player id. */
  readonly scores = new Map<string, number>();
  readonly missions: MissionManager | null;
  readonly race: RaceManager | null;
  private chatTimes = new Map<string, number[]>();
  /** When each shared button (bell, cannon...) was last used, in ms. */
  private fired = new Map<string, number>();
  /** Street things lying smashed, and when each was hit (ms). */
  private smashedAt = new Map<string, number>();
  /** Recent times of things each player did that could flood the room (by key). */
  private recent = new Map<string, number[]>();
  /** Hours on the clock at `clockSetAt` (real ms). */
  private clockHours = START_HOUR;
  private clockSetAt: number;
  private lastSkip = -Infinity;
  /** The last race mission everyone was put back in their own car for. */
  private linedUp = -1;

  constructor(
    readonly code: string,
    readonly mode: GameMode = 'freeroam',
    private now: () => number = Date.now,
    setup: RaceSetup = { circuit: CIRCUITS[0].id, laps: 5, bots: 9, difficulty: 'normal' },
  ) {
    this.clockSetAt = now();
    this.missions =
      mode === 'missions'
        ? new MissionManager({
            // Where each player is: their car is the one they're in, and only drivers race.
            players: () =>
              [...this.players.values()].map((pl) => ({
                id: pl.id,
                name: pl.name,
                p: this.carOf(pl)?.p ?? pl.p,
                avatar: pl.avatar,
                passenger: !pl.avatar && !!pl.seat && pl.seat.n !== DRIVER,
              })),
            publish: (mission) => {
              // Everyone races in their own car, so first they're all put back at their own wheel.
              if (mission.kind === 'race' && mission.phase === 'briefing' && mission.id !== this.linedUp) {
                this.linedUp = mission.id;
                this.everyoneAtTheirWheel();
              }
              this.broadcast({ type: 'mission', mission });
            },
            notice: (text) => this.broadcast({ type: 'notice', text }),
            award: (id, points) => {
              this.scores.set(id, (this.scores.get(id) ?? 0) + points);
              this.broadcast({ type: 'scores', scores: this.scoreTable() });
            },
          })
        : null;
    this.race =
      mode === 'racing'
        ? new RaceManager(
            {
              players: () => [...this.players.values()],
              publish: (race) => this.broadcast({ type: 'race', race }),
              notice: (text) => this.broadcast({ type: 'notice', text }),
            },
            setup,
            now(),
          )
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
      seat: null,
    };
    player.seat = { car: player.id, n: DRIVER };
    this.broadcast({ type: 'player_joined', player: toInfo(player) });
    this.players.set(player.id, player);
    if (this.mode === 'missions') this.scores.set(player.id, 0);
    this.race?.join();
    return player;
  }

  remove(id: string): void {
    const leaving = this.players.get(id);
    if (!leaving) return;
    // Out of every car first: a friend's car they were driving goes back to its owner, and
    // anyone in theirs is left standing where it was (it goes with them).
    if (leaving.seat) this.seat(leaving, null);
    for (const pl of this.players.values()) if (pl !== leaving && pl.seat?.car === id) this.seat(pl, null);
    if (this.players.delete(id)) {
      this.scores.delete(id);
      this.chatTimes.delete(id);
      for (const key of this.recent.keys()) if (key.startsWith(`${id}:`)) this.recent.delete(key);
      this.missions?.playerLeft(id, this.now());
      this.broadcast({ type: 'player_left', id });
      this.race?.leave(id);
    }
  }

  /** The player whose car `car` is, if they're here. */
  private owner(car: string): Player | undefined {
    return this.players.get(car);
  }

  /** The car `player` is sitting in (its owner's record), if any. */
  carOf(player: Player): Player | undefined {
    return player.seat ? this.owner(player.seat.car) : undefined;
  }

  /** The car `player` is at the wheel of, if they're driving one. */
  driving(player: Player): Player | undefined {
    return !player.avatar && player.seat?.n === DRIVER ? this.owner(player.seat.car) : undefined;
  }

  /** Who sits in seat `n` of `car`, if anyone. */
  sitting(car: string, n: number): Player | undefined {
    for (const pl of this.players.values()) if (pl.seat?.car === car && pl.seat.n === n) return pl;
    return undefined;
  }

  /** Where everyone sits, by player id. */
  seats(): Record<string, CarSeat | null> {
    return Object.fromEntries([...this.players.values()].map((pl) => [pl.id, pl.seat]));
  }

  /**
   * Puts `player` in `seat` (null: out on foot) and tells everyone, with where each car
   * whose driver changed is right now (its new driver's game carries on from there).
   */
  seat(player: Player, seat: CarSeat | null): void {
    const was = player.seat;
    if (sameSeat(was, seat)) return;
    player.seat = seat;
    const handed = new Set<string>();
    if (was?.n === DRIVER) handed.add(was.car);
    if (seat?.n === DRIVER) handed.add(seat.car);
    const cars: CarPose[] = [...handed].flatMap((id) => {
      const car = this.owner(id);
      return car ? [{ id, p: car.p, q: car.q, car: car.car }] : [];
    });
    this.broadcast({ type: 'seat', id: player.id, seat, ...(cars.length ? { cars } : {}) });
  }

  /** Everyone back at the wheel of their own car (to line up for a race). */
  private everyoneAtTheirWheel(): void {
    // Out first, so nobody's seat is still taken when its owner gets back in.
    const moving = [...this.players.values()].filter((pl) => !sameSeat(pl.seat, { car: pl.id, n: DRIVER }));
    for (const pl of moving) this.seat(pl, null);
    for (const pl of moving) this.seat(pl, { car: pl.id, n: DRIVER });
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

  /** Uses a shared button unless it was used less than `cooldown` seconds ago. */
  fire(id: string, cooldown: number): boolean {
    const now = this.now();
    if (now - (this.fired.get(id) ?? -Infinity) < cooldown * 1000) return false;
    this.fired.set(id, now);
    return true;
  }

  /** Whether `key` (a player and a kind of thing) has done it fewer than `burst` times in the last `windowMs`; counts this one if so. */
  allow(key: string, burst: number, windowMs: number): boolean {
    const now = this.now();
    const times = (this.recent.get(key) ?? []).filter((t) => now - t < windowMs);
    if (times.length >= burst) return false;
    times.push(now);
    this.recent.set(key, times);
    return true;
  }

  /** Marks a street thing smashed, unless it already is (or too many are). */
  smash(id: string): boolean {
    this.mendSmashed();
    if (this.smashedAt.has(id) || this.smashedAt.size >= MAX_SMASHED) return false;
    this.smashedAt.set(id, this.now());
    return true;
  }

  /** What lies smashed, with how many seconds ago each was hit. */
  smashed(): [string, number][] {
    this.mendSmashed();
    const now = this.now();
    return [...this.smashedAt].map(([id, at]) => [id, Math.round((now - at) / 100) / 10]);
  }

  /** Forgets things smashed long enough ago to have been put back. */
  private mendSmashed(): void {
    const now = this.now();
    for (const [id, at] of this.smashedAt) if (now - at >= SMASH_REPAIR_SECONDS * 1000) this.smashedAt.delete(id);
  }

  clock(): Clock {
    const elapsed = (this.now() - this.clockSetAt) / 1000;
    return { hours: (this.clockHours + elapsed * DAY_RATE) % 24, rate: DAY_RATE };
  }

  /** Free roam only: jump the clock forward 1-12 hours (at most once a second). */
  skipTime(hours: number): void {
    if (this.mode !== 'freeroam' || !Number.isFinite(hours)) return;
    const now = this.now();
    if (now - this.lastSkip < 1000) return;
    this.lastSkip = now;
    const current = this.clock().hours;
    this.clockHours = (current + Math.min(12, Math.max(1, Math.round(hours)))) % 24;
    this.clockSetAt = now;
    this.broadcast({ type: 'time', clock: this.clock() });
  }

  tick(): void {
    this.missions?.tick(this.now());
    this.race?.tick(this.now());
    this.broadcastSnapshot();
  }

  info(): PlayerInfo[] {
    return [...this.players.values()].map(toInfo);
  }

  broadcastSnapshot(): void {
    if (this.players.size < 2) return;
    const bots = this.race?.bots;
    const data = JSON.stringify({
      type: 'snapshot',
      players: [...this.players.values()].map(({ id, p, q, car, avatar }) => ({ id, p, q, car, avatar })),
      ...(bots?.length ? { bots } : {}),
    } satisfies ServerMessage);
    for (const pl of this.players.values()) {
      // A racer whose game is still building the circuit can't read these yet, and if they
      // piled up, their browser would stop answering and lose the connection.
      if (this.race && !this.race.hasLoaded(pl.id)) continue;
      if (pl.socket.readyState === pl.socket.OPEN) pl.socket.send(data);
    }
  }

  /** Sends `msg` to everyone in the room, except the player `except` if given. */
  broadcast(msg: ServerMessage, except?: string): void {
    const data = JSON.stringify(msg);
    for (const pl of this.players.values()) {
      if (pl.id !== except && pl.socket.readyState === pl.socket.OPEN) pl.socket.send(data);
    }
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  create(mode: GameMode = 'freeroam', setup?: RaceSetup): Room {
    let code: string;
    do {
      code = randomCode();
    } while (this.rooms.has(code));
    const room = new Room(code, mode, Date.now, setup);
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
