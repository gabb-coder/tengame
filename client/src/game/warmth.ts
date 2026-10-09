import type * as THREE from 'three';
import { ARCTIC } from '../../../shared/zones/arctic.ts';
import { zoneAt } from '../../../shared/world.ts';

/** Seconds of standing in the open tundra to go from fully warm to frozen. */
const FREEZE_SECONDS = 75;
/** How fast you warm up (per second, out of 100): by a fire, indoors or in the car. */
const WARM_UP = { fire: 18, shelter: 9 };
/** A lit fire warms you within this distance. */
export const FIRE_WARMTH_RANGE = 6;
const IGLOO_RADIUS = 3.2;

/**
 * Survival in the Arctic: on foot out in the cold you slowly freeze (the screen frosts
 * over and you can only trudge), until you warm up by a campfire, inside a house or an
 * igloo, or in your car with the heater on.
 */
export class Warmth {
  /** 100 = toasty, 0 = frozen. */
  value = 100;
  private warned = false;

  update(dt: number, p: { position: THREE.Vector3; onFoot: boolean; indoors: boolean; nearFire: boolean }): void {
    const inIgloo = ARCTIC.igloos.some((i) => Math.hypot(p.position.x - i.x, p.position.z - i.z) < IGLOO_RADIUS);
    const cold = zoneAt(p.position.x, p.position.z) === 'arctic' && p.onFoot && !p.indoors && !inIgloo && !p.nearFire;
    if (cold) this.value -= (100 / FREEZE_SECONDS) * dt;
    else this.value += (p.nearFire ? WARM_UP.fire : WARM_UP.shelter) * dt;
    this.value = Math.min(100, Math.max(0, this.value));
    if (this.value > 30) this.warned = false;
  }

  /** Frozen enough to slow down (0..1 of normal speed). */
  get speed(): number {
    return this.value < 20 ? 0.45 + (this.value / 20) * 0.55 : 1;
  }

  /** True once when it's time to warn the player. */
  takeWarning(): boolean {
    if (this.warned || this.value > 15) return false;
    this.warned = true;
    return true;
  }
}
