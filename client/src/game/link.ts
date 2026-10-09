import * as THREE from 'three';
import type { Act } from '../../../shared/protocol.ts';
import type { Sounds } from '../audio/sounds.ts';
import { Activities, type Mount } from './activities.ts';

/**
 * How things in the world reach the game: the world (zones, the town park) is built before
 * anyone joins a room, so its rides, buttons and treasures talk to the player, the server
 * and the speakers through this, which the game fills in once it starts.
 */
export const game = {
  /** Everything to do out in the world. */
  activities: new Activities(),
  /** The local player: feet (or the car), and whether they're walking. */
  player: { id: '', position: new THREE.Vector3(), onFoot: false, grounded: true },
  ride(mount: Mount): void {
    void mount;
  },
  riding(mount?: Mount): boolean {
    void mount;
    return false;
  },
  /** Throws the walking player through the air (m/s). */
  launch(v: THREE.Vector3Like): void {
    void v;
  },
  /** Teleports the walking player (feet). */
  placeAt(p: THREE.Vector3Like, yaw: number): void {
    void p;
    void yaw;
  },
  playOnce(act: Act): void {
    void act;
  },
  /** Starts something done standing still (fishing), facing `yaw`; `stop` runs when it ends. */
  startTask(act: Act, yaw: number, stop: () => void): void {
    void act;
    void yaw;
    void stop;
  },
  stopTask(): void {},
  /** Straps a jetpack on (or gives it back); and whether one's on. */
  wearJetpack(on: boolean): void {
    void on;
  },
  hasJetpack(): boolean {
    return false;
  },
  /** Asks the server to set off a shared button; what happens arrives through `onTrigger`. */
  trigger(id: string): void {
    void id;
  },
  notice(text: string): void {
    void text;
  },
  sounds: null as Sounds | null,
};

type Effect = (by: string, mine: boolean) => void;
const effects = new Map<string, Effect>();

/** What a shared button does in the scene when anyone uses it. */
export function onTrigger(id: string, effect: Effect): void {
  effects.set(id, effect);
}

/** Plays a shared button's effect (from the server's message). */
export function playTrigger(id: string, by: string): void {
  effects.get(id)?.(by, by === game.player.id);
}
