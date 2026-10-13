import type { CarSeat } from '../../../shared/protocol.ts';
import { DRIVER } from '../../../shared/seats.ts';

/**
 * Who sits where, in every car in the room (each player's car has their id), as the
 * server last said; except that our own getting out counts at once (it's never refused).
 */
export class Seating {
  private seats = new Map<string, CarSeat | null>();

  constructor(initial: Record<string, CarSeat | null> = {}) {
    for (const [id, seat] of Object.entries(initial)) this.seats.set(id, seat);
  }

  /** Where `id` sits; null on foot. Players we haven't heard about are at their own wheel. */
  of(id: string): CarSeat | null {
    return this.seats.has(id) ? this.seats.get(id)! : { car: id, n: DRIVER };
  }

  set(id: string, seat: CarSeat | null): void {
    this.seats.set(id, seat);
  }

  /** Someone left: they're no longer anywhere. */
  remove(id: string): void {
    this.seats.delete(id);
  }

  /** Who's in `car`, by seat. */
  riders(car: string): { id: string; n: number }[] {
    const out: { id: string; n: number }[] = [];
    for (const [id, seat] of this.seats) if (seat?.car === car) out.push({ id, n: seat.n });
    return out.sort((a, b) => a.n - b.n);
  }

  /** The seats taken in `car`. */
  taken(car: string): number[] {
    return this.riders(car).map((r) => r.n);
  }

  /** Who's driving `car`, if anyone. */
  driverOf(car: string): string | null {
    return this.riders(car).find((r) => r.n === DRIVER)?.id ?? null;
  }

  /** Whose game moves `car`: its driver's, or its owner's while nobody's driving it. */
  movedBy(car: string): string {
    return this.driverOf(car) ?? car;
  }
}
