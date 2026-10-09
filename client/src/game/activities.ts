import type * as THREE from 'three';

/** What pressing E would do, for the on-screen prompt. */
export interface Prompt {
  /** "Ring the bell". */
  action: string;
  /** A smaller line under it, e.g. "Next train in 12 s". */
  detail?: string;
  /** Shown greyed out: you can see it but not use it yet. */
  waiting?: boolean;
}

/** Something to do at a spot in the world: ring a bell, board a train, talk to someone. */
export interface Activity {
  /** Where it is; read every frame, so it can move (a person, a ride). */
  position: THREE.Vector3Like;
  /** How close you must be, across the ground, and up or down. */
  reach: number;
  height?: number;
  /** What E does right now, or null when there's nothing to do here at the moment. */
  prompt(): Prompt | null;
  use(): void;
}

/**
 * Something you sit or stand on, which may move: a bench, a monorail car, a dinosaur's
 * back. While on it, the player's body follows `position` and `yaw`.
 */
export interface Mount {
  /** Where the hips go when sitting, or the feet when standing. */
  position: THREE.Vector3;
  yaw: number;
  pose: 'sit' | 'stand';
  /** What it is, for the prompt ("bench", "monorail"). */
  label: string;
  /** A ride: walking keys don't get you off, only E does. */
  ride?: boolean;
  /** Moves the mount along (called every frame). */
  update?(): void;
  /** Why you can't get off now ("Wait for the next station"), or null. */
  blocked?(): string | null;
  /** Where to stand after getting off, or null to stay where you were before. */
  exit?(): THREE.Vector3 | null;
  /** True when the ride is over and puts you off by itself. */
  done?(): boolean;
  /** A push as you get off (the trebuchet's throw), in m/s. */
  release?(): THREE.Vector3 | null;
  /** Called after you've got off. */
  left?(): void;
}

/** Every activity in the world; the player looks up what's in reach each frame. */
export class Activities {
  private list: Activity[] = [];

  add(...activities: Activity[]): void {
    this.list.push(...activities);
  }

  remove(activity: Activity): void {
    const i = this.list.indexOf(activity);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** Activities within reach of feet at `p` that have something to do right now. */
  within(p: THREE.Vector3Like): { activity: Activity; distance: number; prompt: Prompt }[] {
    const out = [];
    for (const activity of this.list) {
      const a = activity.position;
      const dx = a.x - p.x;
      const dz = a.z - p.z;
      if (Math.abs(dx) > activity.reach || Math.abs(dz) > activity.reach) continue;
      const distance = Math.hypot(dx, dz);
      if (distance > activity.reach || Math.abs(a.y - p.y) > (activity.height ?? 2.2)) continue;
      const prompt = activity.prompt();
      if (prompt) out.push({ activity, distance, prompt });
    }
    return out;
  }
}
