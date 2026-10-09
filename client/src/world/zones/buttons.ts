import * as THREE from 'three';
import { TRIGGER_REACH, TRIGGERS_BY_ID } from '../../../../shared/activities.ts';
import type { Seat } from '../seats.ts';
import type { Activity } from '../../game/activities.ts';
import { game } from '../../game/link.ts';

/** When each shared button last went off here (performance.now ms), to grey it out while it resets. */
const firedAt = new Map<string, number>();

/** Notes that a shared button just went off (called for every trigger message). */
export function markFired(id: string): void {
  firedAt.set(id, performance.now());
}

/**
 * The "press E" spot for one of the shared buttons in shared/activities.ts. `use` runs
 * extra local things first (climbing into the cannon); everyone sees the effect once the
 * server says it went off.
 */
export function buttonActivity(id: string, use?: () => boolean): Activity {
  const t = TRIGGERS_BY_ID.get(id)!;
  return {
    position: new THREE.Vector3(t.x, t.y, t.z),
    reach: TRIGGER_REACH,
    height: 2.2,
    prompt() {
      if (!game.player.onFoot) return null;
      const since = (performance.now() - (firedAt.get(id) ?? -Infinity)) / 1000;
      if (since < t.cooldown) return { action: t.label, detail: 'Getting ready…', waiting: true };
      return { action: t.label };
    },
    use() {
      if (use && !use()) return;
      game.playOnce('interact');
      game.trigger(id);
    },
  };
}

/** Seats along a straight bench from `a` to `b` (hip height `y`), every `spacing` meters, facing `yaw`. */
export function benchSeats(id: string, a: { x: number; z: number }, b: { x: number; z: number }, y: number, floorY: number, yaw: number, label: string, spacing = 1.1): Seat[] {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.floor(len / spacing) + 1);
  const seats: Seat[] = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    seats.push({ id: `${id}/${i}`, position: new THREE.Vector3(a.x + (b.x - a.x) * f, y, a.z + (b.z - a.z) * f), yaw, floorY, label });
  }
  return seats;
}

/** Seats out in the zones (thrones, benches, logs by the fire), gathered for the player. */
export const zoneSeats: Seat[] = [];

/** Throw speed (m/s) to fly from `from` and land on `to`, leaving at `angle` above the horizon. */
export function ballistic(from: THREE.Vector3Like, to: THREE.Vector3Like, angle: number, gravity: number): THREE.Vector3 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const dy = to.y - from.y;
  const tan = Math.tan(angle);
  const cos = Math.cos(angle);
  const v2 = (gravity * d * d) / (2 * cos * cos * Math.max(0.5, d * tan - dy));
  const v = Math.sqrt(v2);
  const h = v * cos;
  return new THREE.Vector3((dx / d) * h, v * Math.sin(angle), (dz / d) * h);
}
