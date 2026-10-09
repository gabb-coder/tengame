import { generateInterior, type FurnitureType } from '../../shared/interior.ts';
import type { AvatarState, MissionKind, MissionState, MissionTarget, Vec3 } from '../../shared/protocol.ts';
import { BLOCKS_PER_SIDE, doorPosition, type House, houseToWorld, roadCenter } from '../../shared/town.ts';
import { generateWorld, zoneAt, ZONES } from '../../shared/world.ts';

export const BRIEFING_MS = 6000;
export const DONE_MS = 7000;
const ACTIVE_MS: Record<MissionKind, number> = { delivery: 150_000, race: 150_000, fetch: 150_000 };
/** After the first racer finishes, the rest get this long. */
const RACE_GRACE_MS = 25_000;
const RACE_CHECKPOINTS = 6;
const RACE_POINTS = [150, 100, 75, 50];

/** How close (meters, horizontal) counts as reaching each kind of target. */
export const REACH = {
  pickup: 5,
  dropoff: 2.5,
  checkpoint: 10,
  item: 1.4,
} as const;

const ITEMS = ['car keys', 'wallet', 'phone', 'sunglasses', 'TV remote', 'watch', 'house keys'];
/** Furniture with a surface something could be left on, and that surface's height. */
const SURFACES: Partial<Record<FurnitureType, number>> = {
  diningTable: 0.76,
  coffeeTable: 0.42,
  desk: 0.75,
  nightstand: 0.55,
  bed: 0.55,
  counter: 0.92,
};

/** Deliveries and lost things can be anywhere: in town or out in the zones. */
const HOUSES = generateWorld().houses;

/** A house's address, plus its zone when it's out of town. */
function where(h: House): string {
  const zone = zoneAt(h.x, h.z);
  return zone === 'town' ? h.address : `${h.address}, ${ZONES[zone].name}`;
}

export interface MissionPlayer {
  id: string;
  name: string;
  /** Car position (the car stays parked while on foot). */
  p: Vec3;
  avatar: AvatarState | null;
}

/** What the mission manager needs from its room. */
export interface MissionHost {
  players(): MissionPlayer[];
  /** Tell everyone the mission changed. */
  publish(state: MissionState): void;
  notice(text: string): void;
  award(playerId: string, points: number): void;
}

interface Current {
  state: MissionState;
  phaseEndsAt: number;
  /** Delivery: where the package waits, and where it goes. */
  pickup?: MissionTarget;
  dropoff?: MissionTarget;
  dropoffAddress?: string;
  pickupAddress?: string;
  /** Fetch: the item's world position. */
  itemTarget?: MissionTarget;
  fetchAddress?: string;
}

/**
 * Runs missions for one room, one after another: briefing → active → done → next.
 * The server is the referee: it checks player positions against the objectives.
 */
export class MissionManager {
  private current: Current | null = null;
  private count = 0;
  private order: MissionKind[];

  constructor(
    private host: MissionHost,
    private rng: () => number = Math.random,
  ) {
    const kinds: MissionKind[] = ['delivery', 'race', 'fetch'];
    const start = Math.floor(rng() * kinds.length);
    this.order = [...kinds.slice(start), ...kinds.slice(0, start)];
  }

  get state(): MissionState | null {
    return this.current?.state ?? null;
  }

  /** The state with `timeLeft` filled in for sending. */
  snapshot(now: number): MissionState | null {
    if (!this.current) return null;
    return { ...this.current.state, timeLeft: Math.max(0, this.current.phaseEndsAt - now) };
  }

  tick(now: number): void {
    if (!this.current) return this.start(now);
    const c = this.current;
    if (c.state.phase === 'active') this.checkObjectives(c, now);
    if (now < c.phaseEndsAt) return;
    switch (c.state.phase) {
      case 'briefing':
        c.state.phase = 'active';
        c.phaseEndsAt = now + ACTIVE_MS[c.state.kind];
        this.host.notice(c.state.kind === 'race' ? 'Go!' : `${c.state.title}: go!`);
        this.publish(now);
        return;
      case 'active':
        return this.finish(now, this.timeoutResult(c));
      case 'done':
        return this.start(now);
    }
  }

  playerLeft(id: string, now: number): void {
    const c = this.current;
    if (!c) return;
    if (c.state.carrier === id) {
      c.state.carrier = null;
      c.state.targets = [c.pickup!, c.dropoff!];
      c.state.objective = `Pick up the package at ${c.pickupAddress}`;
      this.host.notice('The package was dropped back at the pickup');
      this.publish(now);
    }
    if (c.state.progress) delete c.state.progress[id];
    if (c.state.grid) delete c.state.grid[id];
  }

  // ---------------------------------------------------------------------------

  private start(now: number): void {
    const kind = this.order[this.count % this.order.length];
    this.count++;
    const base = { id: this.count, kind, phase: 'briefing' as const, timeLeft: 0, targets: [] };
    let current: Current;
    if (kind === 'delivery') current = this.makeDelivery(base);
    else if (kind === 'race') current = this.makeRace(base);
    else current = this.makeFetch(base);
    current.phaseEndsAt = now + BRIEFING_MS;
    this.current = current;
    this.publish(now);
  }

  private makeDelivery(base: Omit<MissionState, 'title' | 'objective'>): Current {
    const [from, to] = this.twoHousesApart(90);
    const pickupAt = houseToWorld(from, from.doorOffset, 0, from.depth / 2 + from.setback - 2);
    const dropAt = houseToWorld(to, to.doorOffset, 0.4, to.depth / 2 + 0.9);
    const pickup: MissionTarget = { kind: 'pickup', p: [pickupAt.x, pickupAt.y, pickupAt.z], label: 'Package' };
    const dropoff: MissionTarget = { kind: 'dropoff', p: [dropAt.x, dropAt.y, dropAt.z], label: to.address };
    return {
      state: {
        ...base,
        title: 'Special delivery',
        objective: `Pick up the package at ${where(from)}`,
        targets: [pickup, dropoff],
        carrier: null,
      },
      phaseEndsAt: 0,
      pickup,
      dropoff,
      pickupAddress: where(from),
      dropoffAddress: where(to),
    };
  }

  private makeRace(base: Omit<MissionState, 'title' | 'objective'>): Current {
    const { checkpoints, grid } = this.raceCourse();
    const players = this.host.players();
    const slots: Record<string, { p: Vec3; yaw: number }> = {};
    players.forEach((pl, i) => (slots[pl.id] = grid[i % grid.length]));
    return {
      state: {
        ...base,
        title: 'Street race',
        objective: `Race through ${checkpoints.length} checkpoints. First across the line wins!`,
        checkpoints,
        progress: Object.fromEntries(players.map((pl) => [pl.id, 0])),
        grid: slots,
        finished: [],
      },
      phaseEndsAt: 0,
    };
  }

  private makeFetch(base: Omit<MissionState, 'title' | 'objective'>): Current {
    for (;;) {
      const house = HOUSES[Math.floor(this.rng() * HOUSES.length)];
      const plan = generateInterior(house);
      const spots = plan.furniture.filter((f) => SURFACES[f.type] !== undefined);
      if (spots.length === 0) continue;
      const f = spots[Math.floor(this.rng() * spots.length)];
      // Toward the front edge of the surface, clear of lamps and pillows.
      const forward = f.type === 'bed' ? f.d * 0.3 : f.type === 'nightstand' || f.type === 'counter' ? f.d * 0.2 : 0;
      const lx = f.x + Math.sin(f.yaw) * forward;
      const lz = f.z + Math.cos(f.yaw) * forward;
      const at = houseToWorld(house, lx, f.y + SURFACES[f.type]!, lz);
      const item = ITEMS[Math.floor(this.rng() * ITEMS.length)];
      const target: MissionTarget = { kind: 'item', p: [at.x, at.y, at.z], label: item };
      return {
        state: {
          ...base,
          title: 'Lost and found',
          objective: `Someone left their ${item} inside ${where(house)}. Find them first!`,
          targets: [target],
          item,
        },
        phaseEndsAt: 0,
        itemTarget: target,
        fetchAddress: where(house),
      };
    }
  }

  private checkObjectives(c: Current, now: number): void {
    const players = this.host.players();
    const secondsLeft = Math.floor((c.phaseEndsAt - now) / 1000);
    const s = c.state;

    if (s.kind === 'delivery') {
      if (!s.carrier) {
        const taker = players.find((pl) => distance(position(pl), c.pickup!.p) < REACH.pickup);
        if (taker) {
          s.carrier = taker.id;
          s.targets = [c.dropoff!];
          s.objective = `${taker.name} has the package: deliver it to ${c.dropoffAddress} (on foot, at the front door)`;
          this.host.notice(`${taker.name} picked up the package`);
          this.publish(now);
        }
        return;
      }
      const carrier = players.find((pl) => pl.id === s.carrier);
      if (carrier?.avatar && distance(carrier.avatar.p, c.dropoff!.p) < REACH.dropoff) {
        const points = 100 + secondsLeft;
        this.host.award(carrier.id, points);
        this.finish(now, `${carrier.name} delivered it with ${secondsLeft} s to spare (+${points})`);
      }
      return;
    }

    if (s.kind === 'race') {
      const cps = s.checkpoints!;
      let changed = false;
      for (const pl of players) {
        if (pl.avatar) continue; // must be driving
        const next = s.progress![pl.id] ?? 0;
        if (next >= cps.length || distance(pl.p, cps[next]) >= REACH.checkpoint) continue;
        s.progress![pl.id] = next + 1;
        changed = true;
        if (next + 1 === cps.length) {
          const place = s.finished!.push(pl.id);
          const points = RACE_POINTS[place - 1] ?? 25;
          this.host.award(pl.id, points);
          this.host.notice(`${pl.name} finished ${ordinal(place)}! (+${points})`);
          if (place === 1) c.phaseEndsAt = Math.min(c.phaseEndsAt, now + RACE_GRACE_MS);
        }
      }
      if (changed) this.publish(now);
      const everyone = players.length > 0 && players.every((pl) => (s.progress![pl.id] ?? 0) >= cps.length);
      if (everyone) this.finish(now, this.raceResult(s));
      return;
    }

    // Fetch: walk up to the item.
    const item = c.itemTarget!.p;
    const finder = players.find((pl) => pl.avatar && distance(pl.avatar.p, item) < REACH.item && item[1] - pl.avatar.p[1] > -0.3 && item[1] - pl.avatar.p[1] < 2);
    if (finder) {
      const points = 100 + secondsLeft;
      this.host.award(finder.id, points);
      this.finish(now, `${finder.name} found the ${s.item} with ${secondsLeft} s to spare (+${points})`);
    }
  }

  private finish(now: number, result: string): void {
    const c = this.current!;
    c.state.phase = 'done';
    c.state.result = result;
    c.state.targets = [];
    c.phaseEndsAt = now + DONE_MS;
    this.host.notice(result);
    this.publish(now);
  }

  private timeoutResult(c: Current): string {
    if (c.state.kind === 'race') return this.raceResult(c.state);
    if (c.state.kind === 'delivery') return 'Time up: the package never arrived';
    return `Time up: nobody found the ${c.state.item} in ${c.fetchAddress}`;
  }

  private raceResult(s: MissionState): string {
    const winner = s.finished?.[0];
    const name = this.host.players().find((pl) => pl.id === winner)?.name;
    return name ? `${name} won the race!` : 'Time up: nobody finished the race';
  }

  private publish(now: number): void {
    this.host.publish(this.snapshot(now)!);
  }

  private twoHousesApart(minDistance: number): [House, House] {
    for (;;) {
      const a = HOUSES[Math.floor(this.rng() * HOUSES.length)];
      const b = HOUSES[Math.floor(this.rng() * HOUSES.length)];
      const da = doorPosition(a);
      const db = doorPosition(b);
      if (Math.hypot(da.x - db.x, da.z - db.z) >= minDistance) return [a, b];
    }
  }

  /**
   * A route along the street grid: checkpoints at intersections, never doubling back.
   * The grid lines up on the road just before the first intersection.
   */
  private raceCourse(): { checkpoints: Vec3[]; grid: { p: Vec3; yaw: number }[] } {
    const n = BLOCKS_PER_SIDE;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const inside = (i: number, j: number) => i >= 0 && i <= n && j >= 0 && j <= n;
    for (;;) {
      const si = Math.floor(this.rng() * (n + 1));
      const sj = Math.floor(this.rng() * (n + 1));
      const [di, dj] = dirs[Math.floor(this.rng() * 4)];
      // The grid sits on the road behind the start, so that road must exist.
      if (!inside(si + di, sj + dj) || !inside(si - di, sj - dj)) continue;
      const path: [number, number][] = [[si + di, sj + dj]];
      let prev: [number, number] = [si, sj];
      while (path.length < RACE_CHECKPOINTS) {
        const [ci, cj] = path[path.length - 1];
        const options = dirs.map(([a, b]) => [ci + a, cj + b] as [number, number]).filter(([a, b]) => inside(a, b) && (a !== prev[0] || b !== prev[1]));
        prev = [ci, cj];
        path.push(options[Math.floor(this.rng() * options.length)]);
      }
      const checkpoints = path.map(([i, j]) => [roadCenter(i), 0, roadCenter(j)] as Vec3);
      // Heading from the start intersection toward the first checkpoint (yaw 0 faces +Z).
      const yaw = Math.atan2(di, dj);
      const back = (d: number, lane: number): Vec3 => [roadCenter(si) - di * d + dj * lane, 0.8, roadCenter(sj) - dj * d - di * lane];
      const grid = [
        { p: back(10, 2), yaw },
        { p: back(10, -2), yaw },
        { p: back(17, 2), yaw },
        { p: back(17, -2), yaw },
      ];
      return { checkpoints, grid };
    }
  }
}

/** Where a player is: on foot, or in their car. */
function position(pl: MissionPlayer): Vec3 {
  return pl.avatar ? pl.avatar.p : pl.p;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}
