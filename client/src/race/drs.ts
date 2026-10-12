import type { DrsZone } from './racingLine.ts';
import type { Track } from './track.ts';

/** Within this long (s) of a car ahead at a detection point, the wing may open in the zone after it. */
export const DRS_GAP = 1;
/** A wake reaches this far back (m), strongest close up; it only helps at speed. */
const TOW_REACH = 60;
const TOW_CLOSEST = 4;
const TOW_SPEED = 30;
const TOW_WIDTH = 2.2;

/** A car as the rules see it: where on the lap, how far across, how fast. */
export interface Runner {
  id: string;
  s: number;
  lateral: number;
  speed: number;
}

/**
 * DRS, as in real races: passing a detection point within a second of the car in front
 * lets a driver open the rear wing on the straight after it, until it ends. Each detection
 * point remembers when a car last crossed it, so the gap is simply the time since then.
 */
export class Drs {
  private crossed: number[];
  /** Which zone each car may open its wing in. */
  private allowed = new Map<string, number>();

  constructor(
    readonly track: Track,
    readonly zones: DrsZone[],
  ) {
    this.crossed = zones.map(() => -Infinity);
  }

  /**
   * A car moved from `from` to `to` along the lap at time `now` (s). `enabled` is false
   * until the race allows DRS (from the second lap).
   */
  moved(id: string, from: number, to: number, now: number, enabled: boolean): void {
    const step = this.track.delta(from, to);
    if (step <= 0 || step > 60) return;
    this.zones.forEach((z, k) => {
      if (this.track.delta(from, z.detection) > 0 && this.track.delta(from, z.detection) <= step) {
        if (enabled && now - this.crossed[k] < DRS_GAP) this.allowed.set(id, k);
        else if (this.allowed.get(id) === k) this.allowed.delete(id);
        this.crossed[k] = now;
      }
      // Past the end of its zone, the permission is used up.
      if (this.allowed.get(id) === k && this.track.delta(from, z.end) > 0 && this.track.delta(from, z.end) <= step) this.allowed.delete(id);
    });
  }

  /** Whether the car may have its wing open at `s`: allowed for this zone, and inside it. */
  open(id: string, s: number): boolean {
    const k = this.allowed.get(id);
    if (k === undefined) return false;
    const z = this.zones[k];
    const into = this.track.wrap(s - z.start);
    return into <= this.track.wrap(z.end - z.start);
  }

  /** Allowed to open it in the next zone (or this one): for the dashboard light. */
  armed(id: string): boolean {
    return this.allowed.has(id);
  }

  /** Clears everything, for a new race. */
  reset(): void {
    this.crossed.fill(-Infinity);
    this.allowed.clear();
  }
}

/** How much tow `me` gets (0..1) from the nearest car close ahead in its line. */
export function towFor(track: Track, me: Runner, others: readonly Runner[]): number {
  if (me.speed < TOW_SPEED) return 0;
  let best = 0;
  for (const o of others) {
    if (o.id === me.id) continue;
    const ds = track.delta(me.s, o.s);
    if (ds < TOW_CLOSEST || ds > TOW_REACH || Math.abs(o.lateral - me.lateral) > TOW_WIDTH) continue;
    best = Math.max(best, 1 - (ds - TOW_CLOSEST) / (TOW_REACH - TOW_CLOSEST));
  }
  return best;
}
