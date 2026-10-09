// Building blocks for the themed zones around the town: roads with heights, flat pads,
// water, landmarks and houses. Pure data, shared by client and server.
import { type House, type HouseStyle, mulberry32, type RoofKind } from './town.ts';

/** The town sits in the middle cell of a 3 x 3 grid; the eight themed zones surround it. */
export const ZONE_SIZE = 400;
/** Cars and players stay within this distance of the center (an invisible wall beyond). */
export const WORLD_HALF = 600;
/** The ground goes on this far, so the horizon is hills or sea rather than an edge. */
export const TERRAIN_HALF = 800;
/** Spacing of the ground's height samples (meters). */
export const TERRAIN_STEP = 4;
export const HIGHWAY_WIDTH = 10;
export const SEA_LEVEL = -0.6;

export type ZoneId = 'town' | 'arctic' | 'medieval' | 'space' | 'jungle' | 'cyberpunk' | 'prehistoric' | 'ancient' | 'ocean';

/** What a road is paved with, which decides its look. */
export type Surface = 'asphalt' | 'cobble' | 'dirt' | 'sandstone' | 'metal' | 'snow';

export interface PathPoint {
  x: number;
  y: number;
  z: number;
}

export interface WorldRoad {
  name: string;
  surface: Surface;
  width: number;
  /** Centerline sampled every few meters, with the road surface's height. */
  path: PathPoint[];
  /** For each segment of `path` (i to i + 1): is it a bridge (the ground below stays as it is)? */
  bridge: boolean[];
  /** Dashed center line. */
  lines: boolean;
}

export type Shape =
  | { type: 'rect'; minX: number; minZ: number; maxX: number; maxZ: number }
  | { type: 'circle'; x: number; z: number; r: number }
  /** A square ring (a castle moat): between `inner` and `outer` half-sizes around the center. */
  | { type: 'ring'; x: number; z: number; inner: number; outer: number }
  /** A strip along a path (a river). */
  | { type: 'path'; path: PathPoint[]; width: number };

/** Ground leveled to height `y` over a shape, blending back to the natural ground over `margin` meters. */
export interface Pad {
  shape: Shape;
  y: number;
  margin: number;
}

export type WaterKind = 'water' | 'sea' | 'lava' | 'ice';

export interface Water {
  kind: WaterKind;
  /** Surface height. */
  level: number;
  shape: Shape;
  /** Dry places inside the shape (a glass tunnel under the sea). */
  except?: Shape[];
}

export interface Landmark {
  name: string;
  x: number;
  z: number;
  /** Counts as "at" the landmark within this distance. */
  r: number;
}

/** An outdoor fire (campfire or brazier) players can light. */
export interface Fire {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface ZoneLayout {
  id: ZoneId;
  roads: WorldRoad[];
  pads: Pad[];
  waters: Water[];
  houses: House[];
  landmarks: Landmark[];
  fires: Fire[];
  /** The zone's natural ground height (before roads and pads level it), in world coordinates. */
  ground(x: number, z: number): number;
}

/**
 * A road through control points `[x, z]` or `[x, z, y]` (y defaults to 0), smoothed into a
 * curve that passes through them. `bridges` lists control-point indices whose segment to
 * the next point is a bridge.
 */
export function makeRoad(
  name: string,
  surface: Surface,
  width: number,
  points: ([number, number] | [number, number, number])[],
  opts: { bridges?: number[]; lines?: boolean; spacing?: number } = {},
): WorldRoad {
  const spacing = opts.spacing ?? 3;
  const p = points.map(([x, z, y = 0]) => ({ x, y, z }));
  const path: PathPoint[] = [];
  const bridge: boolean[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[Math.min(p.length - 1, i + 2)];
    const steps = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / spacing));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      // Height eases between the control points (a curve would overshoot on steep ramps).
      const e = t * t * (3 - 2 * t);
      path.push({ x: catmull(p0.x, p1.x, p2.x, p3.x, t), y: p1.y + (p2.y - p1.y) * e, z: catmull(p0.z, p1.z, p2.z, p3.z, t) });
      bridge.push(opts.bridges?.includes(i) ?? false);
    }
  }
  path.push({ ...p[p.length - 1] });
  return { name, surface, width, path, bridge, lines: opts.lines ?? false };
}

function catmull(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

/** Distance from (x, z) to a path, the nearest segment's index, and how far along it (0..1). */
export function distanceToPath(path: PathPoint[], x: number, z: number): { distance: number; index: number; t: number } {
  let best = { distance: Infinity, index: 0, t: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < best.distance) best = { distance: d, index: i, t };
  }
  return best;
}

/** Signed distance from (x, z) to a shape's edge: negative inside. */
export function shapeDistance(s: Shape, x: number, z: number): number {
  switch (s.type) {
    case 'rect': {
      const dx = Math.max(s.minX - x, x - s.maxX);
      const dz = Math.max(s.minZ - z, z - s.maxZ);
      return dx > 0 || dz > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) : Math.max(dx, dz);
    }
    case 'circle':
      return Math.hypot(x - s.x, z - s.z) - s.r;
    case 'ring': {
      const d = Math.max(Math.abs(x - s.x), Math.abs(z - s.z));
      return Math.max(s.inner - d, d - s.outer);
    }
    case 'path':
      return distanceToPath(s.path, x, z).distance - s.width / 2;
  }
}

export function inShape(s: Shape, x: number, z: number): boolean {
  return shapeDistance(s, x, z) <= 0;
}

/** Axis-aligned bounds of a shape, grown by `margin`. */
export function shapeBounds(s: Shape, margin = 0): { minX: number; minZ: number; maxX: number; maxZ: number } {
  switch (s.type) {
    case 'rect':
      return { minX: s.minX - margin, minZ: s.minZ - margin, maxX: s.maxX + margin, maxZ: s.maxZ + margin };
    case 'circle':
      return { minX: s.x - s.r - margin, minZ: s.z - s.r - margin, maxX: s.x + s.r + margin, maxZ: s.z + s.r + margin };
    case 'ring':
      return { minX: s.x - s.outer - margin, minZ: s.z - s.outer - margin, maxX: s.x + s.outer + margin, maxZ: s.z + s.outer + margin };
    case 'path': {
      const xs = s.path.map((p) => p.x);
      const zs = s.path.map((p) => p.z);
      const m = s.width / 2 + margin;
      return { minX: Math.min(...xs) - m, minZ: Math.min(...zs) - m, maxX: Math.max(...xs) + m, maxZ: Math.max(...zs) + m };
    }
  }
}

export const rect = (x: number, z: number, halfW: number, halfD: number): Shape => ({ type: 'rect', minX: x - halfW, minZ: z - halfD, maxX: x + halfW, maxZ: z + halfD });
export const circle = (x: number, z: number, r: number): Shape => ({ type: 'circle', x, z, r });

export interface HouseSpec {
  address: string;
  /** Where the road in front of the house runs (its centerline z) and the road's width. */
  roadZ: number;
  roadWidth: number;
  x: number;
  /** Which side of the road: north houses face south (toward it), south houses face north. */
  side: 'north' | 'south';
  style: HouseStyle;
  roof: RoofKind;
  wallColors: readonly string[];
  roofColors: readonly string[];
  doorColors: readonly string[];
  setback?: number;
  /** Rustic houses have a footpath but no driveway or mailbox. */
  rustic?: boolean;
}

/** A house beside a road in one of the zones (seeded by its id, so it's the same everywhere). */
export function zoneHouse(id: string, spec: HouseSpec): House {
  let seed = 7;
  for (const ch of id) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  const rng = mulberry32(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)];
  const width = Math.round((9 + rng() * 3) * 2) / 2;
  const depth = Math.round((8 + rng() * 2) * 2) / 2;
  const setback = spec.setback ?? 5 + rng() * 2;
  const offset = spec.roadWidth / 2 + setback + depth / 2;
  const north = spec.side === 'north';
  return {
    id,
    address: spec.address,
    x: spec.x,
    z: spec.roadZ + (north ? -offset : offset),
    rotation: north ? 0 : Math.PI,
    facing: north ? 'south' : 'north',
    width,
    depth,
    stories: rng() < 0.4 ? 2 : 1,
    style: spec.style,
    roof: spec.roof,
    wallColor: pick(spec.wallColors),
    roofColor: pick(spec.roofColors),
    doorColor: pick(spec.doorColors),
    doorOffset: Math.round((rng() - 0.5) * 0.5 * (width - 3) * 2) / 2,
    roofPitch: spec.roof === 'thatch' ? 0.85 + rng() * 0.15 : 0.5 + rng() * 0.25,
    hasChimney: rng() < 0.6,
    drivewaySide: rng() < 0.5 ? -1 : 1,
    setback,
    rustic: spec.rustic ?? true,
  };
}

/** The flat lot a zone house stands on (ground leveled to the curb height the house expects). */
export function housePad(h: House, curb: number): Pad {
  // Houses only face north or south here, so the footprint is axis-aligned.
  const front = h.rotation === 0 ? 1 : -1;
  const reachFront = h.depth / 2 + h.setback;
  const z0 = h.z - front * (h.depth / 2 + 3);
  const z1 = h.z + front * reachFront;
  return {
    shape: { type: 'rect', minX: h.x - h.width / 2 - 4, maxX: h.x + h.width / 2 + 4, minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) },
    y: curb,
    margin: 6,
  };
}

/**
 * How far (x, z) is beyond the playable square (negative inside). Zones raise mountains
 * out there so the world ends in hills instead of a wall.
 */
export function beyondEdge(x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z)) - WORLD_HALF;
}
