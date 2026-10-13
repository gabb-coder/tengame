// Seats in cars: anyone can get in anyone's car, to drive it or to ride along.
import { CAR_SEATS, type CarSeat } from './protocol.ts';

/** The driver's seat. */
export const DRIVER = 0;

/**
 * The seat someone getting in takes, given the ones already taken: the wheel if nobody
 * has it, otherwise the first free one. Null when the car is full.
 */
export function seatFor(taken: readonly number[]): number | null {
  for (let n = 0; n < CAR_SEATS; n++) if (!taken.includes(n)) return n;
  return null;
}

/** The first free seat for a passenger (not the wheel), or null if there's none. */
export function passengerSeat(taken: readonly number[]): number | null {
  for (let n = 1; n < CAR_SEATS; n++) if (!taken.includes(n)) return n;
  return null;
}

/**
 * Where a seat is in the car (which faces +Z): which side its door is on, +1 for the
 * driver's side (the car's +X) or -1 for the other, and how far forward it is (m).
 */
export function seatPlace(n: number): { side: number; z: number } {
  return { side: n % 2 === 0 ? 1 : -1, z: n < 2 ? 0.3 : -0.7 };
}

export function sameSeat(a: CarSeat | null, b: CarSeat | null): boolean {
  return a === b || (!!a && !!b && a.car === b.car && a.n === b.n);
}
