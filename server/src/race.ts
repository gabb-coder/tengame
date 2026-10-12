import { circuitInfo } from '../../shared/circuits.ts';
import type { BotState, RaceCar, RaceState, SetupStep } from '../../shared/protocol.ts';
import {
  DRIVERS,
  FLAG_MS,
  GRID_MS,
  HOLD_MAX_MS,
  HOLD_MIN_MS,
  LIGHT_MS,
  LOAD_WAIT_MS,
  MAX_GRID,
  MAX_LAP_SPEED,
  NEXT_GRID_MS,
  type RaceSetup,
  READY_WAIT_MS,
  RESULTS_MS,
  TEAMS,
} from '../../shared/racing.ts';

/** A player as the race sees them. */
export interface RacePlayer {
  id: string;
  name: string;
}

/** What the race needs from its room. */
export interface RaceHost {
  players(): RacePlayer[];
  /** Tell everyone how the race stands. */
  publish(state: RaceState): void;
  notice(text: string): void;
}

/** A lap report must say it's this far into the race (s), give or take (clocks and lag). */
const CLOCK_SLACK = 15;

/**
 * Referees a racing room's races. First the host chooses the Grand Prix and its settings
 * (everyone sees the choice as it's made); then race after race on it: the grid (with a
 * countdown, during which friends can join), the five red lights, the race, then the
 * results. Players time
 * their own laps and report each one; one player's game drives the computer cars and
 * reports theirs. The server checks every report (the right lap, no impossible lap time,
 * the right moment in the race), keeps the standings, and calls the finish.
 */
export class RaceManager {
  state: RaceState;
  /** Where the computer cars are, from the player driving them. */
  bots: BotState[] = [];
  private flagAt = 0;
  /** The host's game has built the circuit: the countdown is running. */
  private ready = false;
  /** Players whose games have built the circuit. */
  private loaded = new Set<string>();

  constructor(
    private host: RaceHost,
    setup: RaceSetup,
    now: number,
    private random: () => number = Math.random,
  ) {
    this.state = {
      setup,
      number: 1,
      phase: 'setup',
      cars: [],
      host: '',
      lightsAt: 0,
      startAt: 0,
      until: now,
      flag: false,
      choosing: 'gp',
    };
  }

  /**
   * The host's choice of Grand Prix and settings so far, on `step`; once `final`, everyone
   * lines up for it.
   */
  choose(from: string, setup: RaceSetup, step: SetupStep, final: boolean, now: number): void {
    const s = this.state;
    if (from !== s.host || s.phase !== 'setup') return;
    s.setup = setup;
    s.choosing = step;
    if (final) {
      s.phase = 'grid';
      delete s.choosing;
      // Until the host's game has built the circuit, a fallback in case it never says so.
      s.until = now + READY_WAIT_MS;
      this.lineUp();
    }
    this.host.publish(s);
  }

  /**
   * The host goes back to choosing the Grand Prix: between races (the results showing) or on
   * the grid before the lights; everyone's game puts the circuit away until the next choice.
   */
  reopen(from: string, now: number): void {
    const s = this.state;
    if (from !== s.host || (s.phase !== 'grid' && s.phase !== 'finished')) return;
    s.phase = 'setup';
    s.choosing = 'gp';
    s.number++;
    s.cars = [];
    s.flag = false;
    s.until = now;
    this.bots = [];
    // Everyone builds the next circuit afresh.
    this.loaded.clear();
    this.ready = false;
    this.host.publish(s);
  }

  /** A player's game has built the circuit; the host's starts the grid's countdown. */
  playerReady(from: string, now: number): void {
    const s = this.state;
    if (s.phase === 'setup') return;
    this.loaded.add(from);
    const car = s.cars.find((c) => c.id === from);
    const changed = !!car?.loading;
    if (car) delete car.loading;
    if (!this.ready && from === s.host && s.phase === 'grid') {
      this.ready = true;
      s.until = Math.min(s.until, now + GRID_MS);
    } else if (!changed) return;
    this.host.publish(s);
  }

  /** Lines everyone up: computer drivers fastest first, players from the middle back. */
  private lineUp(): void {
    const players = this.host.players();
    const { setup } = this.state;
    const bots = Math.max(0, Math.min(setup.bots, MAX_GRID - players.length));
    // Two seats per team; each player gets a team of their own where possible.
    const seats = TEAMS.flatMap((_, t) => [t, t]);
    const take = (t: number) => {
      const k = seats.indexOf(t);
      return seats.splice(k >= 0 ? k : 0, 1)[0];
    };
    const humans: RaceCar[] = players.map((p, k) => this.car(p.id, p.name, take((k * 3) % TEAMS.length), false));
    const computers: RaceCar[] = Array.from({ length: bots }, (_, n) => this.car(`bot:${n}`, DRIVERS[n % DRIVERS.length], seats.shift() ?? n % TEAMS.length, true));
    const middle = Math.floor(computers.length / 2);
    this.state.cars = [...computers.slice(0, middle), ...humans, ...computers.slice(middle)];
    if (!players.some((p) => p.id === this.state.host)) this.state.host = players[0]?.id ?? '';
  }

  private car(id: string, name: string, team: number, bot: boolean): RaceCar {
    const car: RaceCar = { id, name, team, bot, laps: 0, last: null, best: null, finish: null };
    if (!bot && !this.loaded.has(id)) car.loading = true;
    return car;
  }

  /** A player joined the room: on the grid if it's still forming, else they watch until the next race (or the choice is still being made). */
  join(): void {
    if (this.state.phase === 'grid') this.lineUp();
    else if (!this.state.host) this.state.host = this.host.players()[0]?.id ?? '';
    this.host.publish(this.state);
  }

  /** A player left: off the grid, or out of the race; someone else drives the computer cars. */
  leave(id: string): void {
    const s = this.state;
    this.loaded.delete(id);
    if (s.phase === 'grid') this.lineUp();
    else {
      const car = s.cars.find((c) => c.id === id);
      if (car) car.out = true;
    }
    if (s.host === id) {
      s.host = this.host.players()[0]?.id ?? '';
      this.bots = [];
    }
    this.host.publish(s);
  }

  /** Whether this player's game has built the circuit. */
  hasLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  /** The host starts the race now instead of waiting out the countdown (still waiting for anyone loading). */
  startNow(from: string, now: number): void {
    const s = this.state;
    if (from !== s.host || s.phase !== 'grid') return;
    s.until = Math.min(s.until, now);
    this.tick(now);
  }

  private lights(now: number): void {
    const s = this.state;
    if (!s.cars.length) this.lineUp();
    s.phase = 'lights';
    s.lightsAt = now;
    s.startAt = now + 5 * LIGHT_MS + HOLD_MIN_MS + this.random() * (HOLD_MAX_MS - HOLD_MIN_MS);
    this.host.publish(s);
  }

  /** The computer cars' positions, from the player who drives them. */
  botsMoved(from: string, race: number, bots: BotState[]): void {
    if (from !== this.state.host || race !== this.state.number) return;
    this.bots = bots;
  }

  /**
   * A car crossed the line. Players report their own; the host reports the computer
   * drivers'. Returns whether the report was accepted.
   */
  lap(from: string, carId: string | undefined, lap: number, time: number, at: number, now: number): boolean {
    const s = this.state;
    if (s.phase !== 'racing') return false;
    const id = carId ?? from;
    const car = s.cars.find((c) => c.id === id);
    if (!car || car.out || car.finish !== null) return false;
    if (car.bot ? from !== s.host : id !== from) return false;
    if (lap !== car.laps + 1) return false;
    // No lap can beat the car's own pace by much: the shortest possible time round.
    const shortest = circuitInfo(s.setup.circuit).length / MAX_LAP_SPEED;
    if (!(time >= shortest) || time > 3600) return false;
    const raceTime = (now - s.startAt) / 1000;
    if (!(Math.abs(at - raceTime) < CLOCK_SLACK)) return false;
    car.laps = lap;
    car.last = time;
    car.best = car.best === null ? time : Math.min(car.best, time);
    if (car.laps >= s.setup.laps || s.flag) {
      car.finish = at;
      if (!s.flag) {
        s.flag = true;
        this.flagAt = now;
        this.host.notice(`${car.name} wins!`);
      }
    }
    if (this.running().every((c) => c.finish !== null)) this.finish(now);
    else this.host.publish(s);
    return true;
  }

  /** Cars still in the race (their players are here, or they're computer cars someone drives). */
  private running(): RaceCar[] {
    return this.state.cars.filter((c) => !c.out);
  }

  private finish(now: number): void {
    const s = this.state;
    s.phase = 'finished';
    s.until = now + RESULTS_MS;
    this.host.publish(s);
  }

  /** The finishing order: finishers by time, then the rest by laps done. */
  standings(): RaceCar[] {
    return [...this.state.cars].sort((a, b) => {
      if (a.out !== b.out) return a.out ? 1 : -1;
      if (a.finish !== null && b.finish !== null) return a.finish - b.finish;
      if (a.finish !== null || b.finish !== null) return a.finish !== null ? -1 : 1;
      return b.laps - a.laps;
    });
  }

  tick(now: number): void {
    const s = this.state;
    if (s.phase === 'grid' && now >= s.until && this.host.players().length > 0) {
      // Everyone's game has built the circuit, or the slowest have had long enough.
      if (!s.cars.some((c) => c.loading) || now >= s.until + LOAD_WAIT_MS) this.lights(now);
    }
    else if (s.phase === 'lights' && now >= s.startAt) {
      s.phase = 'racing';
      this.host.publish(s);
    } else if (s.phase === 'racing') {
      // Everyone gone, or the stragglers took too long after the winner.
      const humansLeft = s.cars.some((c) => !c.bot && !c.out);
      if (!humansLeft || (s.flag && now - this.flagAt > FLAG_MS)) this.finish(now);
    } else if (s.phase === 'finished' && now >= s.until) {
      s.number++;
      s.phase = 'grid';
      s.flag = false;
      s.until = now + NEXT_GRID_MS;
      this.bots = [];
      this.lineUp();
      this.host.publish(s);
    }
  }
}
