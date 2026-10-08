// Messages exchanged between client and server over the /ws WebSocket.
// All messages are JSON objects with a `type` field.

export const MAX_PLAYERS = 4;
export const TICK_RATE = 20; // server snapshots per second
export const MAX_NAME_LENGTH = 16;
export const ROOM_CODE_LENGTH = 5;

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
}

export interface PlayerTransform {
  id: string;
  p: Vec3;
  q: Quat;
}

// ---- client -> server ----

export interface JoinMessage {
  type: 'join';
  name: string;
  /** Existing room code to join; omit to create a new room. */
  room?: string;
}

export interface StateMessage {
  type: 'state';
  p: Vec3;
  q: Quat;
}

export type ClientMessage = JoinMessage | StateMessage;

// ---- server -> client ----

export interface WelcomeMessage {
  type: 'welcome';
  id: string;
  room: string;
  players: PlayerInfo[];
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
  | ErrorMessage;
