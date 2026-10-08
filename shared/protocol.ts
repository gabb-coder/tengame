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
}

/** A player walking around. Present only while out of the car. */
export interface AvatarState {
  /** Feet position. */
  p: Vec3;
  /** Facing, radians around +Y; 0 faces +Z. */
  yaw: number;
  /** Horizontal speed in m/s, drives the walk animation. */
  speed: number;
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

export type ClientMessage = JoinMessage | StateMessage | DoorRequestMessage | ChatRequestMessage;

// ---- server -> client ----

export interface WelcomeMessage {
  type: 'welcome';
  id: string;
  room: string;
  players: PlayerInfo[];
  /** House ids whose front doors are open. */
  openDoors: string[];
  mode: GameMode;
  /** Mission points by player id (missions mode). */
  scores: Record<string, number>;
  mission: MissionState | null;
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
  | ChatMessage
  | NoticeMessage
  | MissionMessage
  | ScoresMessage
  | ErrorMessage;
