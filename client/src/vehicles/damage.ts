import type { CarDamage } from '../../../shared/protocol.ts';

/** The four sides of a car, in the order damage is kept: front, back, left (+X), right (-X). */
export const FRONT = 0;
export const REAR = 1;
export const LEFT = 2;
export const RIGHT = 3;

/**
 * How much life a car has left (1 like new, 0 wrecked) with its sides this dented: any one
 * side smashed all the way wrecks it, and dents all round add up.
 */
export function carHealth(d: CarDamage): number {
  const sum = d[0] + d[1] + d[2] + d[3];
  return Math.max(0, 1 - Math.max(...d) * 0.5 - sum * 0.5);
}

/** A crash's speed change (m/s) that does no harm, and how much damage each m/s above it does. */
const HARMLESS_BUMP = 2.5;
const DAMAGE_PER_MS = 1 / 32;
/** The most one crash can do to a side. */
const MAX_HIT = 0.6;

/** Crash damage to one car: how dented each side is, and what that does to it. */
export class Damage {
  readonly sides: CarDamage = [0, 0, 0, 0];

  get health(): number {
    return carHealth(this.sides);
  }

  get wrecked(): boolean {
    return this.health <= 0;
  }

  /** Engine power left: the engine's in front, so a smashed nose loses some. */
  get power(): number {
    return this.wrecked ? 0 : 1 - this.sides[FRONT] * 0.45;
  }

  /** The state to send to other players (rounded), or undefined when undamaged. */
  get state(): CarDamage | undefined {
    if (this.sides.every((s) => s === 0)) return undefined;
    return this.sides.map((s) => Math.round(s * 100) / 100) as CarDamage;
  }

  /**
   * A crash that changed the car's speed by `dv` (m/s), hit from `dir` (car-local x and z,
   * pointing from the middle toward where it was hit). Returns the damage done, 0..1.
   */
  crash(dir: { x: number; z: number }, dv: number): number {
    const amount = Math.min(MAX_HIT, Math.max(0, dv - HARMLESS_BUMP) * DAMAGE_PER_MS);
    this.hit(dir, amount);
    return amount;
  }

  /** Dents the side(s) facing `dir` (car-local) by `amount` (0..1), shared out by angle. */
  hit(dir: { x: number; z: number }, amount: number): void {
    if (amount <= 0) return;
    const ax = Math.abs(dir.x);
    const az = Math.abs(dir.z);
    const total = ax + az || 1;
    const add = (side: number, share: number) => (this.sides[side] = Math.min(1, this.sides[side] + amount * share));
    add(dir.z >= 0 ? FRONT : REAR, az / total);
    add(dir.x >= 0 ? LEFT : RIGHT, ax / total);
  }

  repair(): void {
    this.sides.fill(0);
  }
}
