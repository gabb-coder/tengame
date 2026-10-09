import * as THREE from 'three';
import type { Furniture, Interior } from '../../../shared/interior.ts';
import { CURB_HEIGHT, type House } from '../../../shared/town.ts';
import { houseMatrix } from './town/houses.ts';
import { placement } from './town/meshBuilder.ts';

/** A place to sit: the middle of the seat's top surface, and the way a sitter faces. */
export interface Seat {
  id: string;
  /** Seat surface center, in the world. */
  position: THREE.Vector3;
  /** Facing (yaw, 0 = +Z): out from the furniture's front. */
  yaw: number;
  /** Height of the floor the furniture stands on. */
  floorY: number;
  label: string;
}

/** How close (horizontally) you must be to a seat to sit on it. */
export const SEAT_REACH = 1.5;

/** Seat spots in each piece's frame (front +Z), with seat-top heights matching the models. */
function spots(f: Furniture): { x: number; y: number; z: number }[] {
  switch (f.type) {
    case 'sofa': {
      const n = f.w > 1.6 ? 2 : 1;
      return Array.from({ length: n }, (_, i) => ({ x: (i - (n - 1) / 2) * (f.w / 2.6), y: 0.47, z: 0.08 }));
    }
    case 'armchair':
      return [{ x: 0, y: 0.47, z: 0.05 }];
    case 'chair':
      return [{ x: 0, y: 0.47, z: 0 }];
    case 'bed':
      // On the edge at the foot of the bed.
      return [{ x: 0, y: 0.5, z: f.d / 2 - 0.28 }];
    default:
      return [];
  }
}

const LABELS: Partial<Record<Furniture['type'], string>> = { sofa: 'sofa', armchair: 'armchair', chair: 'chair', bed: 'bed' };

/** Every seat in a house. */
export function seatsOf(house: House, plan: Interior): Seat[] {
  const M = houseMatrix(house);
  const out: Seat[] = [];
  plan.furniture.forEach((f, i) => {
    spots(f).forEach((s, k) => {
      const position = new THREE.Vector3(s.x, s.y, s.z).applyMatrix4(M.clone().multiply(placement(f.x, f.y, f.z, f.yaw)));
      out.push({ id: `${house.id}/${i}/${k}`, position, yaw: house.rotation + f.yaw, floorY: CURB_HEIGHT + f.y, label: LABELS[f.type]! });
    });
  });
  return out;
}

/**
 * The nearest free seat within reach of someone standing at `feet`, on the same floor.
 * `taken` holds where other sitters' hips are.
 */
export function nearestSeat(seats: Seat[], feet: THREE.Vector3Like, taken: THREE.Vector3[]): { seat: Seat; distance: number } | null {
  let best: { seat: Seat; distance: number } | null = null;
  for (const seat of seats) {
    if (Math.abs(feet.y - seat.floorY) > 0.6) continue;
    const d = Math.hypot(feet.x - seat.position.x, feet.z - seat.position.z);
    if (d > SEAT_REACH || (best && d >= best.distance)) continue;
    // Someone else is already sitting there.
    if (taken.some((p) => Math.hypot(p.x - seat.position.x, p.z - seat.position.z) < 0.4)) continue;
    best = { seat, distance: d };
  }
  return best;
}
