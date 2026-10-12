// The racing mode's circuits: ten real Grand Prix tracks. Their shapes come from
// bacinger/f1-circuits (MIT) and their hills from NASA's SRTM survey (public domain); see
// scripts/circuits.mjs, which turns them into client/public/media/circuits/<id>.json.

/** What grows (or stands) around a circuit. */
export type Scenery = 'temperate' | 'forest' | 'alpine' | 'tropical' | 'desert' | 'city';

export interface CircuitInfo {
  id: string;
  /** Shown in the game: the place, never a trademark. */
  name: string;
  country: string;
  /** The track's shape in f1-circuits.geojson. */
  source: string;
  /** Track width (m), kerb to kerb. */
  width: number;
  /** Lap length (m), as built (see media/circuits/<id>.json). */
  length: number;
  /** Purpose-built, with grass, gravel and run-off; or city streets lined with walls. */
  style: 'permanent' | 'street';
  scenery: Scenery;
  /** Local time of day the race is run at (night races are floodlit). */
  hour: number;
  /** Where the track crosses itself, which pass goes over the bridge. */
  bridge?: 'later' | 'earlier';
  /** The land is flat (reclaimed land), whatever the survey says about the buildings on it. */
  flat?: boolean;
  /** By the sea: the survey's zeros are water, not gaps in the survey. */
  coast?: boolean;
}

export const CIRCUITS: readonly CircuitInfo[] = [
  { id: 'sepang', name: 'Sepang', country: 'Malaysia', source: 'my-1999', width: 16, length: 5560, style: 'permanent', scenery: 'tropical', hour: 15.5 },
  { id: 'marina-bay', name: 'Marina Bay', country: 'Singapore', source: 'sg-2008', width: 12, length: 4948, style: 'street', scenery: 'city', hour: 21, flat: true, coast: true },
  { id: 'silverstone', name: 'Silverstone', country: 'Great Britain', source: 'gb-1948', width: 15, length: 5884, style: 'permanent', scenery: 'temperate', hour: 14 },
  { id: 'monza', name: 'Monza', country: 'Italy', source: 'it-1922', width: 13, length: 5788, style: 'permanent', scenery: 'forest', hour: 15 },
  { id: 'spa', name: 'Spa-Francorchamps', country: 'Belgium', source: 'be-1925', width: 13, length: 6984, style: 'permanent', scenery: 'forest', hour: 14 },
  { id: 'monaco', name: 'Monaco', country: 'Monaco', source: 'mc-1929', width: 10, length: 3328, style: 'street', scenery: 'city', hour: 15, coast: true },
  { id: 'suzuka', name: 'Suzuka', country: 'Japan', source: 'jp-1962', width: 13, length: 5816, style: 'permanent', scenery: 'temperate', hour: 14, bridge: 'later' },
  { id: 'interlagos', name: 'Interlagos', country: 'Brazil', source: 'br-1940', width: 14, length: 4300, style: 'permanent', scenery: 'tropical', hour: 14 },
  { id: 'sakhir', name: 'Sakhir', country: 'Bahrain', source: 'bh-2002', width: 15, length: 5424, style: 'permanent', scenery: 'desert', hour: 20 },
  { id: 'spielberg', name: 'Spielberg', country: 'Austria', source: 'at-1969', width: 14, length: 4308, style: 'permanent', scenery: 'alpine', hour: 15 },
];

export const CIRCUIT_IDS = new Set(CIRCUITS.map((c) => c.id));

export function circuitInfo(id: string): CircuitInfo {
  return CIRCUITS.find((c) => c.id === id) ?? CIRCUITS[0];
}

/** Floodlit after dark. */
export function isNightRace(c: CircuitInfo): boolean {
  return c.hour >= 19 || c.hour < 6;
}

/**
 * A circuit as stored in media/circuits/<id>.json: the centre line every few meters, and
 * the lie of the land around it. Lengths in meters; x points east and z south.
 */
export interface CircuitData {
  id: string;
  /** Lap length (m). */
  length: number;
  /** Centre line: x, y, z per point, in centimeters, evenly spaced, starting at the start line. */
  points: number[];
  /** Ground heights (decimeters) on a grid: column-major from (x0, z0), `step` m apart. */
  terrain: { x0: number; z0: number; step: number; cols: number; rows: number; heights: number[] };
  /** Height of the sea (m), when there is sea nearby. */
  sea: number | null;
  /** Where the track passes over itself: distance along the lap of the upper and lower pass. */
  bridges: { over: number; under: number }[];
}
