// Town layout, generated from a fixed seed so every client (and the server, for
// missions) agrees on where roads and houses are. Pure data: no rendering here.
//
// Coordinates: X east, Z south, Y up; meters. The town is a square grid of blocks
// separated by roads. Houses sit in two rows per block, each row facing the
// east-west street beside it.

export const TOWN_SEED = 1337;
export const BLOCKS_PER_SIDE = 3;
export const BLOCK_SIZE = 90;
export const ASPHALT_WIDTH = 8; // two 4 m lanes
export const SIDEWALK_WIDTH = 2;
export const ROAD_WIDTH = ASPHALT_WIDTH + 2 * SIDEWALK_WIDTH;
export const PITCH = BLOCK_SIZE + ROAD_WIDTH;
/** Blocks and sidewalks are raised this much above the road (curb height). */
export const CURB_HEIGHT = 0.15;
/** Distance from the town center to the outer edge of the perimeter sidewalks. */
export const TOWN_HALF_EXTENT = (BLOCKS_PER_SIDE / 2) * PITCH + ROAD_WIDTH / 2;

const LOTS_PER_ROW = 3;
const LOT_WIDTH = BLOCK_SIZE / LOTS_PER_ROW;
const LOT_DEPTH = BLOCK_SIZE / 2;
const SETBACK_MIN = 7;
const SETBACK_MAX = 10;

// East-west streets (constant z), north to south.
const STREET_NAMES = ['Maple Street', 'Oak Street', 'Pine Street', 'Cedar Street'];
// North-south avenues (constant x), west to east.
const AVENUE_NAMES = ['1st Avenue', '2nd Avenue', '3rd Avenue', '4th Avenue'];

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Road {
  name: string;
  /** 'x' roads run east-west (constant z); 'z' roads run north-south (constant x). */
  axis: 'x' | 'z';
  /** Centerline coordinate: z for 'x' roads, x for 'z' roads. */
  center: number;
}

export type HouseStyle = 'plaster' | 'brick' | 'siding';

export interface House {
  id: string;
  address: string;
  /** Footprint center. */
  x: number;
  z: number;
  /** Yaw in radians. The house's local +Z is its front (door side). */
  rotation: number;
  /** Which way the front door faces. */
  facing: 'north' | 'south';
  width: number;
  depth: number;
  stories: 1 | 2;
  style: HouseStyle;
  wallColor: string;
  roofColor: string;
  doorColor: string;
  /** Door position along the front wall, from the center (local X). */
  doorOffset: number;
  /** Roof rise per meter of half-depth. */
  roofPitch: number;
  hasChimney: boolean;
  /** Which side of the house the driveway is on (local X sign). */
  drivewaySide: -1 | 1;
  /** Distance from the sidewalk edge to the house front. */
  setback: number;
}

export interface Tree {
  x: number;
  z: number;
  /** Overall height in meters. */
  height: number;
}

export interface SpawnPoint {
  x: number;
  z: number;
  /** Yaw for a car whose local +Z is forward. */
  rotation: number;
}

export interface TownLayout {
  roads: Road[];
  /** Raised blocks (lawns + sidewalks), including the park. */
  blocks: Rect[];
  park: Rect;
  houses: House[];
  trees: Tree[];
  spawns: SpawnPoint[];
}

const WALL_COLORS = ['#e8e2d6', '#d9cbb3', '#c9d3d9', '#e5d3c4', '#bfc9b8', '#f0ece4', '#d6c2a8'];
const BRICK_COLORS = ['#9c5a46', '#8a4f3d', '#a86b52', '#7d5545'];
const SIDING_COLORS = ['#7d93a8', '#a3b5a0', '#c7b79a', '#8c9aa6', '#e0dccf'];
const ROOF_COLORS = ['#3d3f45', '#5a3f35', '#4a4f57', '#6b4a3a', '#2f3a40'];
const DOOR_COLORS = ['#7a2e2e', '#2e4a7a', '#2f5e44', '#3a3a3a', '#8a6a3a', '#f2efe8'];

export function roadCenter(i: number): number {
  return (i - BLOCKS_PER_SIDE / 2) * PITCH;
}

export function blockRect(bx: number, bz: number): Rect {
  const minX = roadCenter(bx) + ROAD_WIDTH / 2;
  const minZ = roadCenter(bz) + ROAD_WIDTH / 2;
  return { minX, minZ, maxX: minX + BLOCK_SIZE, maxZ: minZ + BLOCK_SIZE };
}

export function generateTown(seed = TOWN_SEED): TownLayout {
  const rng = mulberry32(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)];
  const range = (min: number, max: number) => min + rng() * (max - min);

  const roads: Road[] = [];
  for (let i = 0; i <= BLOCKS_PER_SIDE; i++) {
    roads.push({ name: STREET_NAMES[i], axis: 'x', center: roadCenter(i) });
    roads.push({ name: AVENUE_NAMES[i], axis: 'z', center: roadCenter(i) });
  }

  const mid = Math.floor(BLOCKS_PER_SIDE / 2);
  const blocks: Rect[] = [];
  const houses: House[] = [];
  const trees: Tree[] = [];
  let park: Rect | undefined;

  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const block = blockRect(bx, bz);
      blocks.push(block);
      if (bx === mid && bz === mid) {
        park = block;
        continue;
      }
      for (const facing of ['north', 'south'] as const) {
        // North row fronts the street at the block's north edge.
        const streetIndex = facing === 'north' ? bz : bz + 1;
        const frontZ = facing === 'north' ? block.minZ : block.maxZ;
        const inward = facing === 'north' ? 1 : -1;
        for (let lot = 0; lot < LOTS_PER_ROW; lot++) {
          const lotCenterX = block.minX + (lot + 0.5) * LOT_WIDTH;
          const stories = rng() < 0.45 ? 2 : 1;
          const width = Math.round(range(10, 14) * 2) / 2;
          const depth = Math.round(range(8.5, 11) * 2) / 2;
          const setback = range(SETBACK_MIN, SETBACK_MAX);
          const drivewaySide = rng() < 0.5 ? -1 : 1;
          const style: HouseStyle = pick(['plaster', 'plaster', 'brick', 'siding'] as const);
          const wallColor = pick(style === 'brick' ? BRICK_COLORS : style === 'siding' ? SIDING_COLORS : WALL_COLORS);
          // Shift the house away from its driveway so both fit in the lot.
          const x = lotCenterX - drivewaySide * 2;
          const z = frontZ + inward * (setback + depth / 2);
          const streetNumber = houseNumber(x, facing);
          houses.push({
            id: `h${houses.length}`,
            address: `${streetNumber} ${STREET_NAMES[streetIndex]}`,
            x,
            z,
            rotation: facing === 'north' ? Math.PI : 0,
            facing,
            width,
            depth,
            stories,
            style,
            wallColor,
            roofColor: pick(ROOF_COLORS),
            doorColor: pick(DOOR_COLORS),
            doorOffset: Math.round(range(-0.25, 0.25) * (width - 3) * 2) / 2,
            roofPitch: range(0.45, 0.75),
            hasChimney: rng() < 0.4,
            drivewaySide: drivewaySide as -1 | 1,
            setback,
          });

          // A couple of back-yard trees per lot.
          const backZ = facing === 'north' ? block.minZ + LOT_DEPTH : block.maxZ - LOT_DEPTH;
          const yardDepth = LOT_DEPTH - setback - depth;
          for (let t = 0; t < 2; t++) {
            if (rng() < 0.3) continue;
            trees.push({
              x: lotCenterX + range(-LOT_WIDTH / 2 + 3, LOT_WIDTH / 2 - 3),
              z: backZ - inward * range(2.5, Math.max(3, yardDepth - 3)),
              height: range(6, 10),
            });
          }
        }
      }
    }
  }

  // Trees around the park edge, leaving its middle open for the ramps.
  const p = park!;
  for (let i = 0; i < 28; i++) {
    const edge = i % 4;
    const t = range(0.08, 0.92);
    const inset = range(4, 9);
    const x = edge < 2 ? p.minX + t * BLOCK_SIZE : edge === 2 ? p.minX + inset : p.maxX - inset;
    const z = edge === 0 ? p.minZ + inset : edge === 1 ? p.maxZ - inset : p.minZ + t * BLOCK_SIZE;
    trees.push({ x, z, height: range(7, 12) });
  }

  // Spawn in the eastbound lane of Oak Street, spaced along the road.
  const spawnZ = roadCenter(1) + ASPHALT_WIDTH / 4;
  const spawns: SpawnPoint[] = [0, 1, 2, 3].map((i) => ({
    x: roadCenter(0) + 30 + i * 12,
    z: spawnZ,
    rotation: Math.PI / 2,
  }));

  return { roads, blocks, park: p, houses, trees, spawns };
}

/** World position of a point in a house's local frame (+Z = front, y from the block surface). */
export function houseToWorld(h: House, lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
  const c = Math.cos(h.rotation);
  const s = Math.sin(h.rotation);
  return { x: h.x + lx * c + lz * s, y: CURB_HEIGHT + ly, z: h.z - lx * s + lz * c };
}

/** Front door center at the outer face of the front wall, at ground level. */
export function doorPosition(h: House): { x: number; z: number } {
  // Local (doorOffset, depth/2) rotated by the house's yaw.
  const lx = h.doorOffset;
  const lz = h.depth / 2;
  const c = Math.cos(h.rotation);
  const s = Math.sin(h.rotation);
  return { x: h.x + lx * c + lz * s, z: h.z - lx * s + lz * c };
}

/** Even numbers on the south side of a street, odd on the north, increasing eastward. */
function houseNumber(x: number, facing: 'north' | 'south'): number {
  const base = Math.round((x + TOWN_HALF_EXTENT) / 10) * 2 + 100;
  return facing === 'north' ? base : base + 1;
}

/** Small seeded PRNG so every client generates the same layout. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
