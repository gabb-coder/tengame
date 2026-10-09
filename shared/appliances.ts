// Furniture that can be switched on and off (TVs, floor lamps, stoves): which pieces, and
// where each one's "switch" is. Shared so the server can check players are standing by it.
import type { Furniture, Interior } from './interior.ts';
import { type House, houseToWorld } from './town.ts';

export type ApplianceKind = 'tv' | 'lamp' | 'stove';

/** How close (meters, horizontal) a player on foot must be to switch something. */
export const APPLIANCE_REACH = 2;
/** From a seat, the TV remote reaches this far. */
export const TV_REMOTE_REACH = 6;

export interface Appliance {
  /** `houseId/furnitureIndex`, plus `/module` for one stove among several counters. */
  id: string;
  kind: ApplianceKind;
  house: House;
  furniture: Furniture;
  /** The part you reach for, in the furniture's own frame (centered, bottom at 0, front +Z). */
  local: { x: number; y: number; z: number };
  /** The same point in the world. */
  world: { x: number; y: number; z: number };
  /** Height of the floor it stands on, in the world. */
  floorY: number;
}

/** Every switchable thing in a house. */
export function appliancesOf(house: House, plan: Interior): Appliance[] {
  const out: Appliance[] = [];
  plan.furniture.forEach((f, i) => {
    const add = (kind: ApplianceKind, id: string, local: Appliance['local']) => {
      // Furniture frame -> house frame (rotate by the item's yaw), then house -> world.
      const c = Math.cos(f.yaw);
      const s = Math.sin(f.yaw);
      const world = houseToWorld(house, f.x + local.x * c + local.z * s, f.y + local.y, f.z - local.x * s + local.z * c);
      out.push({ id, kind, house, furniture: f, local, world, floorY: houseToWorld(house, f.x, f.y, f.z).y });
    };
    if (f.type === 'tvStand') add('tv', `${house.id}/${i}`, { x: 0, y: f.h + 0.48, z: -0.02 });
    else if (f.type === 'floorLamp') add('lamp', `${house.id}/${i}`, { x: 0, y: f.h - 0.15, z: 0 });
    else if (f.type === 'counter' && f.modules) {
      [...f.modules].forEach((kind, m) => {
        if (kind === 'o') add('stove', `${house.id}/${i}/${m}`, { x: -f.w / 2 + 0.3 + m * 0.6, y: 0.93, z: 0.02 });
      });
    }
  });
  return out;
}
