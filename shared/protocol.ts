// Messages exchanged between client and server over the /ws WebSocket.
// All messages are JSON objects with a `type` field.

export const MAX_PLAYERS = 4;
export const TICK_RATE = 20; // server snapshots per second
export const MAX_NAME_LENGTH = 16;
export const ROOM_CODE_LENGTH = 5;
/** How close (meters, horizontal) a player on foot must be to a door to use it. Server allows some slack for lag. */
export const DOOR_REACH = 2.2;
export const MAX_CHAT_LENGTH = 200;

export type GameMode = 'freeroam' | 'missions';

/** Game hours that pass per real second: a full day takes 24 minutes. */
export const DAY_RATE = 1 / 60;
/** Time of day new rooms start at. */
export const START_HOUR = 9;

/** Time of day: `hours` (0..24) at the moment it was sent, advancing at `rate` game hours per real second. */
export interface Clock {
  hours: number;
  rate: number;
}

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
}

/** Vehicle state used to animate and voice other players' cars. */
export interface CarState {
  /** Front wheel angle in radians. */
  steer: number;
  rpm: number;
  /** Throttle 0..1, drives engine sound. */
  load: number;
  /** Forward speed in m/s. */
  speed: number;
  braking: boolean;
  /** Crash damage to the front, back, left and right, each 0..1 (absent when undamaged). */
  dmg?: CarDamage;
}

export type CarDamage = [front: number, rear: number, left: number, right: number];

/** Smashed street things (lamps, hydrants, bins...) are put back this long after, in seconds. */
export const SMASH_REPAIR_SECONDS = 180;
/** Nobody hit by a car flies off faster than this (m/s). */
export const MAX_KNOCK_SPEED = 45;

/** Something a player's character is doing, shown to everyone. */
export const ACTS = ['dance', 'talk', 'interact', 'pickup', 'fish', 'hit', 'jet', 'tumble', 'down', 'getup'] as const;
export type Act = (typeof ACTS)[number];
/** Things a player can carry or wear. */
export const GEARS = ['jetpack'] as const;
export type Gear = (typeof GEARS)[number];

/** A player walking around. Present only while out of the car. */
export interface AvatarState {
  /** Feet position. */
  p: Vec3;
  /** Facing, radians around +Y; 0 faces +Z. */
  yaw: number;
  /** Horizontal speed in m/s, drives the walk animation. */
  speed: number;
  /** Sitting down (on a sofa, chair, bench, or a ride); `p` and `yaw` place the sitting body. */
  seated?: boolean;
  /** Swimming. */
  swim?: boolean;
  /** Dancing, chatting, fishing, flying a jetpack, knocked flying by a car... */
  act?: Act;
  gear?: Gear;
  /** Hurt (hit by a car): limping until they heal. */
  hurt?: boolean;
}

export interface PlayerTransform {
  id: string;
  /** Car position and rotation; the car stays where it was parked while on foot. */
  p: Vec3;
  q: Quat;
  car: CarState;
  avatar: AvatarState | null;
}

// ---- client -> server ----

export interface JoinMessage {
  type: 'join';
  name: string;
  /** Existing room code to join; omit to create a new room. */
  room?: string;
  /** Mode for a new room (ignored when joining). Defaults to free roam. */
  mode?: GameMode;
}

export interface ChatRequestMessage {
  type: 'chat';
  text: string;
}

/** Free roam: skip the clock ahead by some hours. */
export interface TimeRequestMessage {
  type: 'time';
  skip: number;
}

export interface StateMessage {
  type: 'state';
  p: Vec3;
  q: Quat;
  car: CarState;
  avatar: AvatarState | null;
}

/** Ask to open or close a house's front door. Must be on foot and near it. */
export interface DoorRequestMessage {
  type: 'door';
  id: string;
  open: boolean;
}

/** Ask to switch a TV, lamp or stove on or off (see shared/appliances.ts). Must be on foot and near it. */
export interface SwitchRequestMessage {
  type: 'switch';
  id: string;
  on: boolean;
}

/** Ask to use one of the shared buttons out in the world (see shared/activities.ts). Must be on foot and near it. */
export interface TriggerRequestMessage {
  type: 'trigger';
  id: string;
}

/**
 * Our car hit someone, sending them flying at `v` (m/s). `target` is a player's id, or
 * `npc:<id>` for one of the people walking about the world (everyone sees them fly).
 */
export interface KnockRequestMessage {
  type: 'knock';
  target: string;
  v: Vec3;
}

/** Our car smashed a street thing (`lamp:12`, `bin:<house>:1`...), knocking it off at `v` (m/s). */
export interface SmashRequestMessage {
  type: 'smash';
  id: string;
  v: Vec3;
}

export type ClientMessage =
  | JoinMessage
  | StateMessage
  | DoorRequestMessage
  | SwitchRequestMessage
  | TriggerRequestMessage
  | ChatRequestMessage
  | TimeRequestMessage
  | KnockRequestMessage
  | SmashRequestMessage;

// ---- server -> client ----

export interface WelcomeMessage {
  type: 'welcome';
  id: string;
  room: string;
  players: PlayerInfo[];
  /** House ids whose front doors are open. */
  openDoors: string[];
  /** Appliances that are switched on. */
  switchedOn: string[];
  mode: GameMode;
  /** Mission points by player id (missions mode). */
  scores: Record<string, number>;
  mission: MissionState | null;
  clock: Clock;
  /** Street things lying smashed, with how many seconds ago each was hit. */
  smashed: [id: string, ago: number][];
  /**
   * The server's wall clock (ms) when this was sent. Timed things (rides, eruptions, rocket
   * launches) run on it, so they're in the same place on every player's screen.
   */
  now: number;
}

/** The clock was changed (someone skipped time). */
export interface TimeMessage {
  type: 'time';
  clock: Clock;
}

export interface ChatMessage {
  type: 'chat';
  /** Sender's player id. */
  id: string;
  name: string;
  text: string;
}

/** A one-line announcement, e.g. "Alice picked up the package". */
export interface NoticeMessage {
  type: 'notice';
  text: string;
}

export interface MissionMessage {
  type: 'mission';
  mission: MissionState | null;
}

export interface ScoresMessage {
  type: 'scores';
  scores: Record<string, number>;
}

// ---- missions ----

export type MissionKind = 'delivery' | 'race' | 'fetch';
/** briefing: read the objective (races line up); active: go; done: results. */
export type MissionPhase = 'briefing' | 'active' | 'done';

/** Something to show in the world: a beam of light, a checkpoint gate, an item. */
export interface MissionTarget {
  kind: 'pickup' | 'dropoff' | 'checkpoint' | 'item';
  p: Vec3;
  label: string;
}

export interface MissionState {
  /** Increments with each new mission. */
  id: number;
  kind: MissionKind;
  phase: MissionPhase;
  title: string;
  /** What to do right now, e.g. "Deliver the package to 112 Oak Street". */
  objective: string;
  /** Milliseconds left in this phase when the message was sent. */
  timeLeft: number;
  /** Markers everyone sees. Race checkpoints are in `checkpoints` instead. */
  targets: MissionTarget[];
  /** Delivery: who's carrying the package. */
  carrier?: string | null;
  /** Race: the course, in order. */
  checkpoints?: Vec3[];
  /** Race: next checkpoint index per player (checkpoints.length = finished). */
  progress?: Record<string, number>;
  /** Race: where each player lines up, with heading. */
  grid?: Record<string, { p: Vec3; yaw: number }>;
  /** Race: player ids in finishing order. */
  finished?: string[];
  /** Fetch: what's being looked for, e.g. "car keys". */
  item?: string;
  /** Results line once done, e.g. "Alice delivered it with 42 s to spare (+121)". */
  result?: string;
}

/** A door was opened or closed by someone in the room. */
export interface DoorMessage {
  type: 'door';
  id: string;
  open: boolean;
}

/** An appliance was switched on or off by someone in the room. */
export interface SwitchMessage {
  type: 'switch';
  id: string;
  on: boolean;
}

/** Someone used a shared button: everyone plays what happens (a bell rings, fireworks go up). */
export interface TriggerMessage {
  type: 'trigger';
  id: string;
  /** Who pressed it. */
  by: string;
}

/**
 * Someone's car hit `target` at speed, sending them flying at `v` (m/s): sent to the player
 * hit (who flies), or for people walking about the world, to everyone else.
 */
export interface KnockMessage {
  type: 'knock';
  target: string;
  v: Vec3;
  /** Whose car it was. */
  by: string;
}

/** Someone's car smashed a street thing (sent to everyone else). */
export interface SmashMessage {
  type: 'smash';
  id: string;
  v: Vec3;
  by: string;
}

export interface PlayerJoinedMessage {
  type: 'player_joined';
  player: PlayerInfo;
}

export interface PlayerLeftMessage {
  type: 'player_left';
  id: string;
}

export interface SnapshotMessage {
  type: 'snapshot';
  players: PlayerTransform[];
}

export type ErrorCode = 'room_full' | 'room_not_found' | 'bad_request';

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
}

export type ServerMessage =
  | WelcomeMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | SnapshotMessage
  | DoorMessage
  | SwitchMessage
  | TriggerMessage
  | KnockMessage
  | SmashMessage
  | ChatMessage
  | NoticeMessage
  | MissionMessage
  | ScoresMessage
  | TimeMessage
  | ErrorMessage;
