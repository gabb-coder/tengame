import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { MAX_KNOCK_SPEED } from '../../../shared/protocol.ts';

const GRAVITY = 9.8;
/** A body only bounces off the ground if it lands faster than this (m/s). */
const BOUNCE_SPEED = 4;
/** Only the world's fixed parts (ground, walls) stop a flying body, not cars or people. */
const STATIC_ONLY = RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC;

/**
 * How someone hit by a car moving at `car` (m/s) flies: on ahead and off to one side (out
 * of the car's way, so it doesn't run into them again), and up. Faster cars throw further,
 * but nobody flies faster than allowed.
 */
export function knockFlight(car: THREE.Vector3Like): THREE.Vector3 {
  const speed = Math.hypot(car.x, car.z);
  const v = new THREE.Vector3(car.x, 0, car.z);
  v.applyAxisAngle(THREE.Object3D.DEFAULT_UP, (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.45));
  v.y = 2 + speed * 0.25;
  return v.clampLength(0, MAX_KNOCK_SPEED);
}

/**
 * A body thrown through the air (by a car): it flies, stops against walls, bounces off
 * the ground and slides to a stop. Knocked-over people and animals ride along with it.
 */
export class Thrown {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** On the ground (sliding or still), not in the air. */
  landed = false;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  constructor(
    private physics: RAPIER.World,
    from: THREE.Vector3Like,
    v: THREE.Vector3Like,
    /** Ground height where there's nothing solid below to find (the terrain). */
    private fallback: (x: number, z: number) => number,
    /** How high above its feet the body is solid (walls are looked for at this height). */
    private height = 0.9,
  ) {
    this.position.set(from.x, from.y, from.z);
    this.velocity.set(v.x, v.y, v.z);
  }

  /** Moves it on by `dt` seconds. Returns true once it has come to rest. */
  update(dt: number): boolean {
    const p = this.position;
    const v = this.velocity;
    if (this.landed) {
      // Sliding along the ground to a stop.
      v.multiplyScalar(Math.exp(-5 * dt));
      v.y = 0;
      this.moveAcross(dt);
      p.y = this.ground(p);
      return Math.hypot(v.x, v.z) < 0.05;
    }
    v.y -= GRAVITY * dt;
    v.multiplyScalar(Math.exp(-0.25 * dt));
    this.moveAcross(dt);
    p.y += v.y * dt;
    const ground = this.ground(p);
    if (p.y <= ground && v.y <= 0) {
      p.y = ground;
      if (-v.y > BOUNCE_SPEED) {
        v.y *= -0.3;
        v.x *= 0.6;
        v.z *= 0.6;
      } else {
        this.landed = true;
        v.y = 0;
      }
    }
    return false;
  }

  /** Moves sideways, stopping (and bouncing back a little) against walls. */
  private moveAcross(dt: number): void {
    const p = this.position;
    const v = this.velocity;
    const step = Math.hypot(v.x, v.z) * dt;
    if (step < 1e-4) return;
    const dir = { x: v.x / (step / dt), y: 0, z: v.z / (step / dt) };
    this.ray.origin = { x: p.x, y: p.y + this.height, z: p.z };
    this.ray.dir = dir;
    const hit = this.physics.castRay(this.ray, step + 0.3, true, STATIC_ONLY);
    if (hit) {
      v.x *= -0.25;
      v.z *= -0.25;
      return;
    }
    p.x += v.x * dt;
    p.z += v.z * dt;
  }

  /** The height of whatever's solid under `p`: a sidewalk, a floor, the ground. */
  ground(p: THREE.Vector3Like): number {
    return groundUnder(this.physics, p, this.fallback);
  }
}

const down = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

/**
 * The height of whatever's solid under `p` (a sidewalk, a floor, the ground; not cars or
 * people), or `fallback` there if nothing is found.
 */
export function groundUnder(physics: RAPIER.World, p: THREE.Vector3Like, fallback: (x: number, z: number) => number): number {
  down.origin = { x: p.x, y: p.y + 1.5, z: p.z };
  // Not solid: starting inside something (a wall), find where it ends below, not its inside.
  const hit = physics.castRay(down, 8, false, STATIC_ONLY);
  return hit ? p.y + 1.5 - hit.timeOfImpact : fallback(p.x, p.z);
}
