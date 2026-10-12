// The racing mode's rules and people: the teams and drivers on the grid, the race's
// settings and phases, and the timing. Shared by the server (the referee) and the game.

/**
 * The ten made-up teams on the grid: their colors paint the cars and the garages. No real
 * team's name or livery.
 */
export interface Team {
  name: string;
  /** Main body color, second color, and a small bright accent. */
  primary: string;
  secondary: string;
  accent: string;
}

export const TEAMS: readonly Team[] = [
  { name: 'Scarlet Arrow', primary: '#c8101e', secondary: '#f3f3f3', accent: '#ffcc00' },
  { name: 'Midnight Volt', primary: '#101c3d', secondary: '#1e5bd8', accent: '#ff2d55' },
  { name: 'Papaya Works', primary: '#ff7a1a', secondary: '#1d2b44', accent: '#3ec7ff' },
  { name: 'Silver Comet', primary: '#c9ced4', secondary: '#16181c', accent: '#00d6b4' },
  { name: 'Racing Green', primary: '#0c5c3a', secondary: '#e9e3c9', accent: '#c6ff00' },
  { name: 'Azure Motorsport', primary: '#1e88e5', secondary: '#ffffff', accent: '#f50057' },
  { name: 'Black Panther', primary: '#151515', secondary: '#d4a017', accent: '#e8e8e8' },
  { name: 'Violet Storm', primary: '#5b2a86', secondary: '#f2f2f2', accent: '#ff9f1c' },
  { name: 'Ivory Lightning', primary: '#f1efe8', secondary: '#c1121f', accent: '#003049' },
  { name: 'Lime Rocket', primary: '#9acd32', secondary: '#202020', accent: '#ff4f00' },
];

/** Computer drivers' names, two per team (made up). */
export const DRIVERS: readonly string[] = [
  'Marco Rossi', 'Lena Vogt',
  'Kenji Mori', 'Sofia Navarro',
  'Oliver Hart', 'Priya Nair',
  'Lucas Ferreira', 'Anya Petrova',
  'Tom Becker', 'Hana Kobayashi',
  'Diego Alvarez', 'Emma Lindqvist',
  'Ravi Menon', 'Chloe Martin',
  'Jonas Weber', 'Aisha Okafor',
  'Felix Moreau', 'Mei Lin',
  'Nico Romano', 'Sara Haddad',
];

/** Three letters for the timing screens: the first three of the surname, in capitals. */
export function code(name: string): string {
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1] ?? name;
  return (last.length >= 3 ? last : name).replace(/[^\p{L}]/gu, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
}

/** At most this many cars on the grid (players and computer drivers together). */
export const MAX_GRID = 20;
export const MIN_LAPS = 1;
export const MAX_LAPS = 30;
export const LAP_CHOICES = [3, 5, 10, 20] as const;
export const BOT_CHOICES = [0, 5, 9, 19] as const;

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** How close to the limit the computer drivers go (fastest to slowest share of the grip they dare use), by difficulty. */
export const SKILL: Record<Difficulty, [number, number]> = {
  easy: [0.9, 0.84],
  normal: [0.96, 0.9],
  hard: [1, 0.95],
};

/** What a racing room races: where, how many laps, against how many computer drivers, how good. */
export interface RaceSetup {
  circuit: string;
  laps: number;
  bots: number;
  difficulty: Difficulty;
}

/** Computer driver `n`'s share of grip (see SKILL): bot 0 is the fastest. */
export function botSkill(setup: RaceSetup, n: number): number {
  const [best, worst] = SKILL[setup.difficulty];
  return setup.bots <= 1 ? best : best + ((worst - best) * n) / (setup.bots - 1);
}

/**
 * The seconds on the grid before the start, the five red lights (one a second), and how
 * long the last one may stay on before they all go out (picked at random each start).
 */
export const GRID_MS = 25_000;
/** The countdown waits for the host's game to build the circuit, but no longer than this. */
export const READY_WAIT_MS = 60_000;
/** When the countdown ends, the lights wait for players still loading the circuit, but no longer than this. */
export const LOAD_WAIT_MS = 30_000;
export const NEXT_GRID_MS = 15_000;
export const LIGHT_MS = 1000;
export const HOLD_MIN_MS = 300;
export const HOLD_MAX_MS = 2500;
/** Results stay up this long before the next race lines up. */
export const RESULTS_MS = 25_000;
/** Once the winner is home, the others have this long to finish. */
export const FLAG_MS = 120_000;
/** No lap is faster than this average speed (m/s): anything quicker was a shortcut or a cheat. */
export const MAX_LAP_SPEED = 95;

/** How many red lights are lit `ms` after the first came on (until they go out at the start). */
export function lightsLit(sinceFirst: number): number {
  return Math.max(0, Math.min(5, Math.floor(sinceFirst / LIGHT_MS) + 1));
}
