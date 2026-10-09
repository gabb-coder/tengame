// The whole map: the town in the middle of a 3 x 3 grid, eight themed zones around it,
// highways between them, and the shape of the ground everywhere. Pure data, shared by
// the client (to build it) and the server (houses, fires and missions).
import { lerp, smoothstep } from './noise.ts';
import { ASPHALT_WIDTH, generateTown, type House, locationName, roadCenter, TOWN_HALF_EXTENT, type TownLayout } from './town.ts';
import {
  type Fire,
  HIGHWAY_WIDTH,
  type Landmark,
  makeRoad,
  type Pad,
  type PathPoint,
  shapeBounds,
  shapeDistance,
  TERRAIN_HALF,
  type Water,
  WORLD_HALF,
  type WorldRoad,
  ZONE_SIZE,
  type ZoneId,
  type ZoneLayout,
} from './worldKit.ts';
import { ancientLayout } from './zones/ancient.ts';
import { arcticLayout } from './zones/arctic.ts';
import { cyberpunkLayout } from './zones/cyberpunk.ts';
import { jungleLayout } from './zones/jungle.ts';
import { medievalLayout } from './zones/medieval.ts';
import { oceanLayout } from './zones/ocean.ts';
import { prehistoricLayout } from './zones/prehistoric.ts';
import { spaceLayout } from './zones/space.ts';

export * from './worldKit.ts';

export interface ZoneInfo {
  id: ZoneId;
  /** The place's name, e.g. "Frostfang Tundra". */
  name: string;
  /** What kind of place it is, e.g. "Arctic & Tundra". */
  theme: string;
  /** Center of its grid cell. */
  x: number;
  z: number;
}

/** Rows north to south, columns west to east. */
const GRID: ZoneId[][] = [
  ['arctic', 'medieval', 'space'],
  ['jungle', 'town', 'cyberpunk'],
  ['prehistoric', 'ancient', 'ocean'],
];

const NAMES: Record<ZoneId, [string, string]> = {
  town: ['Tengame Town', 'Home'],
  arctic: ['Frostfang Tundra', 'Arctic & Tundra'],
  medieval: ['Kingdom of Eldermoor', 'Medieval & Castles'],
  space: ['Outpost Nova', 'Deep Space & Alien Planets'],
  jungle: ['Emerald Jungle', 'Jungle & Rainforest'],
  cyberpunk: ['Neon Spire', 'Cyberpunk'],
  prehistoric: ['Primeval Valley', 'Prehistoric'],
  ancient: ['Valley of Empires', 'Ancient Empires'],
  ocean: ['Coral Bay', 'Oceanic & Deep Sea'],
};

export const ZONES = Object.fromEntries(
  GRID.flatMap((row, r) =>
    row.map((id, c) => [id, { id, name: NAMES[id][0], theme: NAMES[id][1], x: (c - 1) * ZONE_SIZE, z: (r - 1) * ZONE_SIZE }]),
  ),
) as Record<ZoneId, ZoneInfo>;

const HALF_CELL = ZONE_SIZE / 2;

/** Which zone (x, z) is in. Beyond the world's edge, the nearest zone. */
export function zoneAt(x: number, z: number): ZoneId {
  return GRID[z < -HALF_CELL ? 0 : z > HALF_CELL ? 2 : 1][x < -HALF_CELL ? 0 : x > HALF_CELL ? 2 : 1];
}

export interface WorldLayout {
  town: TownLayout;
  /** The eight themed zones. */
  zones: ZoneLayout[];
  /** Highways between the zones, and the roads out of town to them. */
  highways: WorldRoad[];
  /** Every road outside the town: highways and zone roads. */
  roads: WorldRoad[];
  /** Every house, in town and in the zones. */
  houses: House[];
  waters: Water[];
  landmarks: Landmark[];
  /** Outdoor fires, with their height in the world. */
  fires: Fire[];
}

let cached: WorldLayout | null = null;
const layouts = new Map<ZoneId, ZoneLayout>();

export function generateWorld(): WorldLayout {
  if (cached) return cached;
  const town = generateTown();
  const zones = [arcticLayout(), medievalLayout(), spaceLayout(), jungleLayout(), cyberpunkLayout(), prehistoricLayout(), ancientLayout(), oceanLayout()];
  for (const z of zones) layouts.set(z.id, z);

  const H = HALF_CELL;
  const E = WORLD_HALF;
  const highway = (name: string, points: [number, number][]) => makeRoad(name, 'asphalt', HIGHWAY_WIDTH, points, { lines: true });
  const highways = [
    highway('Northern Highway', [[-E, -H], [E, -H]]),
    highway('Southern Highway', [[-E, H], [E, H]]),
    highway('Western Highway', [[-H, -E], [-H, E]]),
    highway('Eastern Highway', [[H, -E], [H, E]]),
  ];
  // The town's middle streets and avenues carry on out to the highways.
  const edge = Math.abs(roadCenter(0));
  for (const road of town.roads.filter((r) => Math.abs(r.center) < edge - 1)) {
    for (const dir of [-1, 1]) {
      const [a, b] = [dir * edge, dir * H];
      const points: [number, number][] = road.axis === 'x' ? [[a, road.center], [b, road.center]] : [[road.center, a], [road.center, b]];
      highways.push(makeRoad(road.name, 'asphalt', ASPHALT_WIDTH, points, { lines: true }));
    }
  }

  const roads = [...highways, ...zones.flatMap((z) => z.roads)];
  cached = {
    town,
    zones,
    highways,
    roads,
    houses: [...town.houses, ...zones.flatMap((z) => z.houses)],
    waters: zones.flatMap((z) => z.waters),
    landmarks: zones.flatMap((z) => z.landmarks),
    fires: [],
  };
  // Fires are placed relative to the ground, which needs the roads and pads above.
  cached.fires = zones.flatMap((z) => z.fires).map((f) => ({ ...f, y: groundHeight(f.x, f.z) + f.y }));
  return cached;
}

export function zoneLayout(id: ZoneId): ZoneLayout | undefined {
  generateWorld();
  return layouts.get(id);
}

// ---------------------------------------------------------------------------
// The ground: each zone's natural terrain, leveled under pads and roads.

/** Roads level the ground across their width plus this much either side... */
const ROAD_SHOULDER = 1.5;
/** ...and blend back to the natural ground over this distance. */
const ROAD_BLEND = 10;
/** The ground sits this far below a road's surface. */
const ROAD_SINK = 0.03;
/** Neighboring zones' ground blends across their shared border over this distance. */
const ZONE_BLEND = 24;
const INDEX_CELL = 32;

interface Segment {
  a: PathPoint;
  b: PathPoint;
  core: number;
  /** The unbroken stretch of road (between bridges) it belongs to. */
  run: object;
  /** Ends where a bridge starts: the ground past them stays as it is. */
  openA: boolean;
  openB: boolean;
}

interface FlattenIndex {
  pads: Map<number, Pad[]>;
  segments: Map<number, Segment[]>;
}

let index: FlattenIndex | null = null;

function cellKey(cx: number, cz: number): number {
  return (cx + 1000) * 4096 + (cz + 1000);
}

function insert<T>(map: Map<number, T[]>, bounds: { minX: number; minZ: number; maxX: number; maxZ: number }, item: T): void {
  for (let cx = Math.floor(bounds.minX / INDEX_CELL); cx <= Math.floor(bounds.maxX / INDEX_CELL); cx++) {
    for (let cz = Math.floor(bounds.minZ / INDEX_CELL); cz <= Math.floor(bounds.maxZ / INDEX_CELL); cz++) {
      const key = cellKey(cx, cz);
      let list = map.get(key);
      if (!list) map.set(key, (list = []));
      list.push(item);
    }
  }
}

function buildIndex(): FlattenIndex {
  const world = generateWorld();
  const idx: FlattenIndex = { pads: new Map(), segments: new Map() };
  for (const zone of world.zones) for (const pad of zone.pads) insert(idx.pads, shapeBounds(pad.shape, pad.margin), pad);
  for (const road of world.roads) {
    const core = road.width / 2 + ROAD_SHOULDER;
    const reach = core + ROAD_BLEND;
    let run = {};
    for (let i = 0; i < road.path.length - 1; i++) {
      if (road.bridge[i]) {
        run = {};
        continue;
      }
      const a = road.path[i];
      const b = road.path[i + 1];
      const seg: Segment = { a, b, core, run, openA: !!road.bridge[i - 1], openB: !!road.bridge[i + 1] };
      insert(idx.segments, { minX: Math.min(a.x, b.x) - reach, minZ: Math.min(a.z, b.z) - reach, maxX: Math.max(a.x, b.x) + reach, maxZ: Math.max(a.z, b.z) + reach }, seg);
    }
  }
  return idx;
}

/** The zones' natural ground at (x, z), blended across zone borders so there are no steps. */
function naturalGround(x: number, z: number): number {
  const weights = (v: number): [number, number, number] => {
    const lo = smoothstep(v, -HALF_CELL - ZONE_BLEND, -HALF_CELL + ZONE_BLEND);
    const hi = smoothstep(v, HALF_CELL - ZONE_BLEND, HALF_CELL + ZONE_BLEND);
    return [1 - lo, lo - hi, hi];
  };
  const wx = weights(x);
  const wz = weights(z);
  let h = 0;
  for (let r = 0; r < 3; r++) {
    if (wz[r] <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const w = wz[r] * wx[c];
      if (w <= 0) continue;
      const id = GRID[r][c];
      if (id !== 'town') h += w * layouts.get(id)!.ground(x, z);
    }
  }
  return h;
}

/** Height of the ground at (x, z): what roads, houses and props stand on. */
export function groundHeight(x: number, z: number): number {
  generateWorld();
  index ??= buildIndex();
  let h = naturalGround(x, z);
  const key = cellKey(Math.floor(x / INDEX_CELL), Math.floor(z / INDEX_CELL));

  // The pad we're deepest inside wins.
  let best = Infinity;
  let pad: Pad | null = null;
  for (const p of index.pads.get(key) ?? []) {
    const d = shapeDistance(p.shape, x, z) - p.margin;
    if (d < best) [best, pad] = [d, p];
  }
  if (pad) h = lerp(h, pad.y, 1 - smoothstep(best + pad.margin, 0, pad.margin));

  // The nearest point on each stretch of road; a stretch whose nearest point is where a
  // bridge starts doesn't level the ground (that's the gap the bridge spans).
  const runs = new Map<object, { d: number; y: number; core: number; open: boolean }>();
  for (const s of index.segments.get(key) ?? []) {
    const dx = s.b.x - s.a.x;
    const dz = s.b.z - s.a.z;
    const len2 = dx * dx + dz * dz;
    const raw = len2 > 0 ? ((x - s.a.x) * dx + (z - s.a.z) * dz) / len2 : 0;
    const t = Math.min(1, Math.max(0, raw));
    const d = Math.hypot(x - (s.a.x + dx * t), z - (s.a.z + dz * t));
    const current = runs.get(s.run);
    if (current && current.d <= d) continue;
    runs.set(s.run, { d, y: s.a.y + (s.b.y - s.a.y) * t - ROAD_SINK, core: s.core, open: (raw < 0 && s.openA) || (raw > 1 && s.openB) });
  }
  let nearest: { d: number; y: number; core: number } | null = null;
  for (const r of runs.values()) if (!r.open && (!nearest || r.d - r.core < nearest.d - nearest.core)) nearest = r;
  return nearest ? lerp(h, nearest.y, 1 - smoothstep(nearest.d, nearest.core, nearest.core + ROAD_BLEND)) : h;
}

/** Ground heights on the terrain grid (TERRAIN_STEP apart, covering ±TERRAIN_HALF), x-major. */
export function terrainSamples(step: number, half = TERRAIN_HALF): Float32Array {
  const n = Math.round((2 * half) / step) + 1;
  const out = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = groundHeight(-half + i * step, -half + j * step);
  return out;
}

// ---------------------------------------------------------------------------
// Water, places and names.

/** The water (or lava, or ice) at (x, z), if any. The sea is only where it's over the ground. */
export function waterAt(x: number, z: number): Water | null {
  for (const w of generateWorld().waters) {
    if (shapeDistance(w.shape, x, z) > 0) continue;
    if (w.except?.some((s) => shapeDistance(s, x, z) <= 0)) continue;
    if (w.kind === 'sea' && groundHeight(x, z) >= w.level) continue;
    return w;
  }
  return null;
}

/** Whether (x, y, z) is under water (not ice or lava). */
export function underwater(x: number, y: number, z: number): boolean {
  const w = waterAt(x, z);
  return !!w && (w.kind === 'water' || w.kind === 'sea') && y < w.level;
}

let roadBounds: Map<WorldRoad, ReturnType<typeof shapeBounds>> | undefined;

/**
 * A name for where (x, z) is: a town street or address, a landmark, a road, or the zone.
 * Empty beyond the world's edge.
 */
export function worldLocationName(x: number, z: number): string {
  const world = generateWorld();
  if (Math.abs(x) <= TOWN_HALF_EXTENT && Math.abs(z) <= TOWN_HALF_EXTENT) return locationName(world.town, x, z);
  if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF + 20) return '';
  let best: Landmark | null = null;
  for (const l of world.landmarks) {
    if (Math.hypot(x - l.x, z - l.z) <= l.r && (!best || l.r < best.r)) best = l;
  }
  if (best) return best.name;
  for (const road of world.roads) {
    const b = (roadBounds ??= new Map()).get(road) ?? shapeBounds({ type: 'path', path: road.path, width: road.width + 2 });
    roadBounds.set(road, b);
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (shapeDistance({ type: 'path', path: road.path, width: road.width + 2 }, x, z) <= 0) return road.name;
  }
  const zone = zoneAt(x, z);
  return zone === 'town' ? 'Tengame Town' : ZONES[zone].name;
}
