// House floor plans and furniture, generated from each house's data so every client
// (and the server, for missions) agrees on where rooms and items are. Pure data.
//
// Everything is in the house's local frame: origin at the footprint center on the
// ground, +Z toward the front door, X across the width. Heights are from the ground.

import { type House, mulberry32, type Rect } from './town.ts';

export const FOUNDATION_HEIGHT = 0.4;
export const STORY_HEIGHT = 2.8;
export const WALL_THICKNESS = 0.2;
export const PARTITION_THICKNESS = 0.12;
export const SLAB_THICKNESS = 0.2;
export const DOOR_WIDTH = 1.1;
export const DOOR_HEIGHT = 2.2;
export const DOORWAY_WIDTH = 0.9;
export const DOORWAY_HEIGHT = 2.1;
export const STEP_RISE = 0.2;
export const STEP_TREAD = 0.26;
export const STAIR_WIDTH = 1.0;
const STEP_COUNT = Math.round(STORY_HEIGHT / STEP_RISE);
const STAIR_RUN = STEP_COUNT * STEP_TREAD;
/** Clear floor before the first step and past the last one in the stair hall. */
const STAIR_APPROACH = 0.8;
const STAIR_TOP_LANDING = 0.9;
const BATHROOM_WIDTH = 2.3;

const WINDOW = { width: 1.2, sill: 0.9, height: 1.3 };
const SMALL_WINDOW = { width: 0.6, sill: 1.5, height: 0.6 };
/** Keep this much floor in front of every doorway clear of furniture. */
const DOOR_CLEARANCE = 1.1;

export type Side = 'front' | 'back' | 'left' | 'right';
export type RoomType = 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'hall';
export type FloorType = 'wood' | 'tile' | 'carpet';

export interface Opening {
  kind: 'door' | 'doorway' | 'window' | 'smallWindow';
  /** Position along the wall: x for front/back walls and x-axis partitions, z otherwise. */
  center: number;
  width: number;
  bottom: number;
  top: number;
}

export interface Room extends Rect {
  id: string;
  story: number;
  type: RoomType;
  floor: FloorType;
}

/** Interior wall. 'x' runs along X at z = `at`; 'z' runs along Z at x = `at`. */
export interface Partition {
  story: number;
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  openings: Opening[];
}

/** Straight stairs along X, against the back wall. Climbs from `fromX` to `toX`. */
export interface Stairs {
  fromX: number;
  toX: number;
  minZ: number;
  maxZ: number;
  bottomY: number;
  topY: number;
  steps: number;
}

export type FurnitureType =
  | 'sofa'
  | 'armchair'
  | 'coffeeTable'
  | 'tvStand'
  | 'bookshelf'
  | 'floorLamp'
  | 'plant'
  | 'rug'
  | 'counter'
  | 'upperCabinets'
  | 'fridge'
  | 'diningTable'
  | 'chair'
  | 'bed'
  | 'nightstand'
  | 'wardrobe'
  | 'desk'
  | 'bathtub'
  | 'shower'
  | 'toilet'
  | 'vanity';

export interface Furniture {
  type: FurnitureType;
  room: string;
  /** Footprint center. */
  x: number;
  z: number;
  /** Bottom of the item (floor height, or mounting height for wall cabinets). */
  y: number;
  /** Rotation around +Y; the item's front faces local +Z before rotation. */
  yaw: number;
  /** Size along its own X (width), Z (depth) and Y (height). */
  w: number;
  d: number;
  h: number;
  color: string;
  /** Counters: one letter per 0.6 m module — c cabinet, s sink, o stove. */
  modules?: string;
}

export interface Interior {
  stories: number;
  /** Walking surface height per story. */
  floorY: number[];
  /** Ceiling height per story. */
  ceilingY: number[];
  /** Inside faces of the outer walls. */
  inner: Rect;
  rooms: Room[];
  partitions: Partition[];
  /** Openings in each outer wall. */
  exterior: Record<Side, Opening[]>;
  stairs: Stairs | null;
  /** Hole in the upper floor above the stairs. */
  stairwell: Rect | null;
  furniture: Furniture[];
  wallColor: string;
}

/** Furniture you can walk through (or can't reach), so it gets no collider. */
export const NON_SOLID: ReadonlySet<FurnitureType> = new Set(['rug', 'upperCabinets']);

const WALL_COLORS = ['#eee9df', '#e9e4d8', '#e3e7e8', '#efe6d6', '#e4e8df', '#f3efe8'];
const FABRIC_COLORS = ['#5b6e7f', '#7d6a58', '#4f5d4a', '#8a8f96', '#6b4f4f', '#3e4a5c', '#a39280'];
const WOOD_COLORS = ['#8a6544', '#6e4f35', '#a07b55', '#5a4130', '#b59272'];
const BEDDING_COLORS = ['#e8e4dc', '#c9d4dd', '#d9c9b8', '#b8c4b0', '#e2cfd0'];
const RUG_COLORS = ['#8c5a4a', '#4f6276', '#9a8a6a', '#5e6b5a', '#7a6a82'];
const CABINET_COLORS = ['#f2f0ea', '#dfe3e2', '#41505a', '#8a9a88', '#c9b89a'];

const snap = (v: number, step = 0.1) => Math.round(v / step) * step;

export function generateInterior(h: House): Interior {
  const rng = mulberry32(hashId(h.id));
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)];

  const T = WALL_THICKNESS;
  const PT = PARTITION_THICKNESS;
  const inner: Rect = { minX: -h.width / 2 + T, maxX: h.width / 2 - T, minZ: -h.depth / 2 + T, maxZ: h.depth / 2 - T };
  const { minX: X0, maxX: X1, minZ: Z0, maxZ: Z1 } = inner;
  const innerW = X1 - X0;
  const innerD = Z1 - Z0;
  const two = h.stories === 2;
  const floorY = two ? [FOUNDATION_HEIGHT, FOUNDATION_HEIGHT + STORY_HEIGHT] : [FOUNDATION_HEIGHT];
  const wallTop = FOUNDATION_HEIGHT + h.stories * STORY_HEIGHT;
  const ceilingY = two ? [floorY[1] - SLAB_THICKNESS, wallTop] : [wallTop];

  // Front zone (living room / upstairs bedrooms) and back zone, split by a wall along X.
  const frontDepth = snap(innerD * 0.55);
  const zSplit = Z1 - frontDepth - PT / 2;
  const backMaxZ = zSplit - PT / 2;
  const frontMinZ = zSplit + PT / 2;

  // --- Structure, laid out with the kitchen on the -X side, then mirrored at random.
  const rooms: Room[] = [];
  const partitions: Partition[] = [];
  let stairs: Stairs | null = null;
  let stairwell: Rect | null = null;
  const room = (story: number, type: RoomType, minX: number, maxX: number, minZ: number, maxZ: number) => {
    const floor: FloorType = type === 'bathroom' || type === 'kitchen' ? 'tile' : type === 'bedroom' ? 'carpet' : 'wood';
    const r: Room = { id: `${story}-${rooms.length}`, story, type, floor, minX, maxX, minZ, maxZ };
    rooms.push(r);
    return r;
  };
  const doorway = (center: number, story: number, width = DOORWAY_WIDTH): Opening => ({
    kind: 'doorway',
    center,
    width,
    bottom: floorY[story],
    top: floorY[story] + DOORWAY_HEIGHT,
  });

  room(0, 'living', X0, X1, frontMinZ, Z1);
  const groundSplit: Partition = { story: 0, axis: 'x', at: zSplit, from: X0, to: X1, openings: [] };
  partitions.push(groundSplit);

  if (!two) {
    const kitchenW = snap((innerW - BATHROOM_WIDTH - 2 * PT) * 0.45);
    const kitchen = room(0, 'kitchen', X0, X0 + kitchenW, Z0, backMaxZ);
    const bath = room(0, 'bathroom', kitchen.maxX + PT, kitchen.maxX + PT + BATHROOM_WIDTH, Z0, backMaxZ);
    const bed = room(0, 'bedroom', bath.maxX + PT, X1, Z0, backMaxZ);
    for (const r of [kitchen, bath, bed]) groundSplit.openings.push(doorway((r.minX + r.maxX) / 2, 0, r === bath ? 0.8 : DOORWAY_WIDTH));
    partitions.push({ story: 0, axis: 'z', at: kitchen.maxX + PT / 2, from: Z0, to: backMaxZ, openings: [] });
    partitions.push({ story: 0, axis: 'z', at: bath.maxX + PT / 2, from: Z0, to: backMaxZ, openings: [] });
  } else {
    const hallW = STAIR_APPROACH + STAIR_RUN + STAIR_TOP_LANDING;
    const kitchen = room(0, 'kitchen', X0, X1 - hallW - PT, Z0, backMaxZ);
    const hall = room(0, 'hall', X1 - hallW, X1, Z0, backMaxZ);
    partitions.push({ story: 0, axis: 'z', at: kitchen.maxX + PT / 2, from: Z0, to: backMaxZ, openings: [] });
    groundSplit.openings.push(doorway((kitchen.minX + kitchen.maxX) / 2, 0));
    groundSplit.openings.push(doorway(hall.minX + STAIR_APPROACH / 2 + 0.6, 0));
    const fromX = hall.minX + STAIR_APPROACH;
    stairs = { fromX, toX: fromX + STAIR_RUN, minZ: Z0, maxZ: Z0 + STAIR_WIDTH, bottomY: floorY[0], topY: floorY[1], steps: STEP_COUNT };
    stairwell = { minX: fromX, maxX: fromX + STAIR_RUN, minZ: Z0, maxZ: Z0 + STAIR_WIDTH + 0.05 };

    // Upstairs: two bedrooms at the front; bathroom and hallway at the back.
    const xMid = snap((rng() - 0.5) * 0.8);
    const bedA = room(1, 'bedroom', X0, xMid - PT / 2, frontMinZ, Z1);
    const bedB = room(1, 'bedroom', xMid + PT / 2, X1, frontMinZ, Z1);
    const bath = room(1, 'bathroom', X0, X0 + BATHROOM_WIDTH + 0.3, Z0, backMaxZ);
    const hall2 = room(1, 'hall', bath.maxX + PT, X1, Z0, backMaxZ);
    const upperSplit: Partition = { story: 1, axis: 'x', at: zSplit, from: X0, to: X1, openings: [] };
    // Each bedroom door opens onto the hallway: center it on the overlap.
    for (const bed of [bedA, bedB]) {
      const lo = Math.max(bed.minX, hall2.minX);
      const hi = Math.min(bed.maxX, hall2.maxX);
      upperSplit.openings.push(doorway((lo + hi) / 2, 1));
    }
    partitions.push(upperSplit);
    partitions.push({ story: 1, axis: 'z', at: xMid, from: frontMinZ, to: Z1, openings: [] });
    const walkwayMid = (stairs.maxZ + backMaxZ) / 2;
    partitions.push({ story: 1, axis: 'z', at: bath.maxX + PT / 2, from: Z0, to: backMaxZ, openings: [doorway(walkwayMid, 1, 0.8)] });
  }

  const interior: Interior = {
    stories: h.stories,
    floorY,
    ceilingY,
    inner,
    rooms,
    partitions,
    exterior: { front: [], back: [], left: [], right: [] },
    stairs,
    stairwell,
    furniture: [],
    wallColor: pick(WALL_COLORS),
  };
  if (rng() < 0.5) mirror(interior);

  // --- Openings in the outer walls: the front door, then windows for each room.
  interior.exterior.front.push({ kind: 'door', center: h.doorOffset, width: DOOR_WIDTH, bottom: floorY[0], top: floorY[0] + DOOR_HEIGHT });
  for (const r of interior.rooms) addWindows(interior, r);

  // --- Furniture.
  const colors = {
    fabric: pick(FABRIC_COLORS),
    wood: pick(WOOD_COLORS),
    bedding: () => pick(BEDDING_COLORS),
    rug: () => pick(RUG_COLORS),
    cabinet: pick(CABINET_COLORS),
  };
  for (const r of interior.rooms) furnish(interior, r, colors, rng);
  return interior;
}

// ---------------------------------------------------------------------------
// Structure helpers

function mirror(i: Interior): void {
  const flipRect = (r: Rect) => {
    [r.minX, r.maxX] = [-r.maxX, -r.minX];
  };
  i.rooms.forEach(flipRect);
  if (i.stairwell) flipRect(i.stairwell);
  for (const p of i.partitions) {
    if (p.axis === 'z') p.at = -p.at;
    else [p.from, p.to] = [-p.to, -p.from];
    if (p.axis === 'x') for (const o of p.openings) o.center = -o.center;
  }
  if (i.stairs) {
    i.stairs.fromX = -i.stairs.fromX;
    i.stairs.toX = -i.stairs.toX;
  }
}

/** Which outer walls a room touches, and the span along each. */
function exteriorSpans(i: Interior, r: Room): { side: Side; lo: number; hi: number }[] {
  const e = 1e-6;
  const spans: { side: Side; lo: number; hi: number }[] = [];
  if (r.maxZ > i.inner.maxZ - e) spans.push({ side: 'front', lo: r.minX, hi: r.maxX });
  if (r.minZ < i.inner.minZ + e) spans.push({ side: 'back', lo: r.minX, hi: r.maxX });
  if (r.minX < i.inner.minX + e) spans.push({ side: 'left', lo: r.minZ, hi: r.maxZ });
  if (r.maxX > i.inner.maxX - e) spans.push({ side: 'right', lo: r.minZ, hi: r.maxZ });
  return spans;
}

function addWindows(i: Interior, r: Room): void {
  if (r.type === 'hall') return;
  const small = r.type === 'bathroom';
  const spec = small ? SMALL_WINDOW : WINDOW;
  const floor = i.floorY[r.story];
  for (const { side, lo, hi } of exteriorSpans(i, r)) {
    const span = hi - lo;
    const along = side === 'front' || side === 'back';
    let count = small ? 1 : along ? Math.max(1, Math.floor((span - 0.6) / 2.8)) : span > 2.4 ? 1 : 0;
    if (r.type === 'kitchen' && side !== 'back') count = Math.min(count, 1);
    if (small && side !== 'back' && exteriorSpans(i, r).some((s) => s.side === 'back')) count = 0;
    for (let k = 0; k < count; k++) {
      const center = lo + (span / count) * (k + 0.5);
      const opening: Opening = { kind: small ? 'smallWindow' : 'window', center, width: spec.width, bottom: floor + spec.sill, top: floor + spec.sill + spec.height };
      // Stay clear of room corners (where interior walls meet) and of other openings.
      if (center - spec.width / 2 < lo + 0.35 || center + spec.width / 2 > hi - 0.35) continue;
      const clash = i.exterior[side].some(
        (o) => Math.abs(o.center - center) < (o.width + spec.width) / 2 + 0.4 && o.bottom < opening.top && opening.bottom < o.top,
      );
      if (!clash) i.exterior[side].push(opening);
    }
  }
}

// ---------------------------------------------------------------------------
// Furniture placement

interface Footprint extends Rect {}

interface WallInfo {
  side: Side;
  /** Usable range along the wall (room span). */
  lo: number;
  hi: number;
  /** Intervals along the wall no furniture may cover (doorways with clearance). */
  blocked: [number, number][];
  /** Intervals tall furniture must avoid (windows). */
  windows: [number, number, number][]; // lo, hi, sill height above floor
}

interface Spec {
  type: FurnitureType;
  w: number;
  d: number;
  h: number;
  color: string;
  y?: number;
  modules?: string;
}

class RoomPlanner {
  readonly walls: WallInfo[];
  /** Areas that must stay clear: in front of doorways, and the stairs. */
  private keepClear: Footprint[] = [];
  private solids: Footprint[] = [];

  constructor(
    private i: Interior,
    readonly room: Room,
  ) {
    this.walls = (['back', 'front', 'left', 'right'] as const).map((side) => this.wallInfo(side));
    const s = i.stairs;
    if (s && room.story === 0 && overlaps(room, stairsFootprint(s))) this.keepClear.push(expand(stairsFootprint(s), 0.6));
    if (s && room.story === 1 && i.stairwell && overlaps(room, i.stairwell)) this.keepClear.push(expand(i.stairwell, 0.5));
  }

  get floor(): number {
    return this.i.floorY[this.room.story];
  }

  /** Walls sorted by free length, longest first. */
  wallsByFreeLength(exclude: Side[] = []): WallInfo[] {
    return this.walls.filter((w) => !exclude.includes(w.side)).sort((a, b) => freeLength(b) - freeLength(a));
  }

  /**
   * Places an item with its back against `wall`, at `at` along the wall if given,
   * else centered in the largest free stretch. Returns null if it doesn't fit.
   */
  against(wall: WallInfo, spec: Spec, at?: number, gap = 0.02): Furniture | null {
    const free = freeIntervals(wall, spec, true);
    const candidates: number[] = [];
    if (at !== undefined) candidates.push(at);
    for (const [lo, hi] of free.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))) {
      if (hi - lo < spec.w) continue;
      candidates.push((lo + hi) / 2, lo + spec.w / 2, hi - spec.w / 2);
    }
    for (const c of candidates) {
      if (!free.some(([lo, hi]) => c - spec.w / 2 >= lo - 1e-6 && c + spec.w / 2 <= hi + 1e-6)) continue;
      const item = this.make(wall, spec, c, gap);
      if (this.fits(item, spec.type)) return this.commit(item, spec.type);
    }
    return null;
  }

  /** Places an item freely at a position, if it fits. */
  at(spec: Spec, x: number, z: number, yaw: number): Furniture | null {
    const item: Furniture = { ...spec, room: this.room.id, x, z, y: this.floor + (spec.y ?? 0), yaw };
    return this.fits(item, spec.type) ? this.commit(item, spec.type) : null;
  }

  /** Tries a grid of spots in the open floor, closest to the room center first. */
  inOpenFloor(spec: Spec, yaw: number, extra = 0): Furniture | null {
    const r = this.room;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const spots: [number, number][] = [];
    for (let x = r.minX; x <= r.maxX; x += 0.25) for (let z = r.minZ; z <= r.maxZ; z += 0.25) spots.push([x, z]);
    spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz));
    for (const [x, z] of spots) {
      const item: Furniture = { ...spec, room: r.id, x, z, y: this.floor + (spec.y ?? 0), yaw };
      if (this.fits(item, spec.type, extra)) return this.commit(item, spec.type);
    }
    return null;
  }

  private make(wall: WallInfo, spec: Spec, along: number, gap: number): Furniture {
    const r = this.room;
    const d = spec.d / 2 + gap;
    const [x, z, yaw] =
      wall.side === 'back'
        ? [along, r.minZ + d, 0]
        : wall.side === 'front'
          ? [along, r.maxZ - d, Math.PI]
          : wall.side === 'left'
            ? [r.minX + d, along, Math.PI / 2]
            : [r.maxX - d, along, -Math.PI / 2];
    return { ...spec, room: r.id, x, z, y: this.floor + (spec.y ?? 0), yaw };
  }

  private fits(item: Furniture, type: FurnitureType, extra = 0): boolean {
    const f = footprint(item);
    const r = this.room;
    if (f.minX < r.minX - 1e-6 || f.maxX > r.maxX + 1e-6 || f.minZ < r.minZ - 1e-6 || f.maxZ > r.maxZ + 1e-6) return false;
    if (NON_SOLID.has(type)) return true;
    const padded = expand(f, extra);
    return !this.keepClear.some((k) => overlaps(f, k)) && !this.solids.some((s) => overlaps(padded, s));
  }

  private commit(item: Furniture, type: FurnitureType): Furniture {
    if (!NON_SOLID.has(type)) this.solids.push(footprint(item));
    this.i.furniture.push(item);
    return item;
  }

  private wallInfo(side: Side): WallInfo {
    const r = this.room;
    const along = side === 'front' || side === 'back';
    const lo = along ? r.minX : r.minZ;
    const hi = along ? r.maxX : r.maxZ;
    const info: WallInfo = { side, lo, hi, blocked: [], windows: [] };
    const floor = this.floor;
    const openings: Opening[] = [];
    // Outer wall openings on this side, if the room touches it.
    if (exteriorSpans(this.i, r).some((s) => s.side === side)) openings.push(...this.i.exterior[side]);
    // Interior wall openings on this edge of the room.
    const edge = side === 'back' ? r.minZ : side === 'front' ? r.maxZ : side === 'left' ? r.minX : r.maxX;
    for (const p of this.i.partitions) {
      if (p.story !== r.story || (p.axis === 'x') !== along) continue;
      if (Math.abs(Math.abs(p.at - edge) - PARTITION_THICKNESS / 2) > 1e-6) continue;
      openings.push(...p.openings);
    }
    for (const o of openings) {
      if (o.center + o.width / 2 < lo || o.center - o.width / 2 > hi) continue;
      if (o.bottom > floor + 2.5 || o.top < floor) continue; // another story
      if (o.kind === 'door' || o.kind === 'doorway') {
        info.blocked.push([o.center - o.width / 2 - 0.35, o.center + o.width / 2 + 0.35]);
        this.keepClear.push(this.clearZone(side, o));
      } else {
        info.windows.push([o.center - o.width / 2 - 0.05, o.center + o.width / 2 + 0.05, o.bottom - floor]);
      }
    }
    return info;
  }

  /** Floor in front of a doorway, inside this room. */
  private clearZone(side: Side, o: Opening): Footprint {
    const r = this.room;
    const half = o.width / 2 + 0.15;
    switch (side) {
      case 'back':
        return { minX: o.center - half, maxX: o.center + half, minZ: r.minZ, maxZ: r.minZ + DOOR_CLEARANCE };
      case 'front':
        return { minX: o.center - half, maxX: o.center + half, minZ: r.maxZ - DOOR_CLEARANCE, maxZ: r.maxZ };
      case 'left':
        return { minX: r.minX, maxX: r.minX + DOOR_CLEARANCE, minZ: o.center - half, maxZ: o.center + half };
      case 'right':
        return { minX: r.maxX - DOOR_CLEARANCE, maxX: r.maxX, minZ: o.center - half, maxZ: o.center + half };
    }
  }
}

/** Height of the top of an item, including what's drawn above it (TV, mirror). */
function visualTop(spec: Spec): number {
  const above = spec.type === 'vanity' ? 1.15 : spec.type === 'tvStand' ? 0.8 : 0;
  return (spec.y ?? 0) + spec.h + above;
}

function freeIntervals(wall: WallInfo, spec: Spec, checkWindows: boolean): [number, number][] {
  const blocked = [...wall.blocked];
  // Items reaching above a window's sill can't stand in front of it (counters just fit under).
  if (checkWindows) for (const [lo, hi, sill] of wall.windows) if (visualTop(spec) > sill + 0.05 && (spec.y ?? 0) < sill + 1.3) blocked.push([lo, hi]);
  blocked.sort((a, b) => a[0] - b[0]);
  const free: [number, number][] = [];
  let cursor = wall.lo + 0.05;
  for (const [lo, hi] of blocked) {
    if (lo > cursor) free.push([cursor, Math.min(lo, wall.hi - 0.05)]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < wall.hi - 0.05) free.push([cursor, wall.hi - 0.05]);
  return free.filter(([lo, hi]) => hi > lo);
}

function freeLength(w: WallInfo): number {
  return Math.max(0, ...freeIntervals(w, { type: 'sofa', w: 0, d: 0, h: 0, color: '' }, false).map(([lo, hi]) => hi - lo));
}

type Colors = { fabric: string; wood: string; bedding: () => string; rug: () => string; cabinet: string };

function furnish(i: Interior, r: Room, c: Colors, rng: () => number): void {
  const p = new RoomPlanner(i, r);
  switch (r.type) {
    case 'living':
      return furnishLiving(p, c, rng);
    case 'kitchen':
      return furnishKitchen(p, i, c);
    case 'bedroom':
      return furnishBedroom(p, c);
    case 'bathroom':
      return furnishBathroom(p);
    case 'hall':
      p.inOpenFloor({ type: 'plant', w: 0.5, d: 0.5, h: 1.1, color: '#4e6b3a' }, 0, 0.3);
      return;
  }
}

function opposite(side: Side): Side {
  return side === 'front' ? 'back' : side === 'back' ? 'front' : side === 'left' ? 'right' : 'left';
}

/** Point `distance` in front of an item (along its facing). */
function inFront(f: Furniture, distance: number): [number, number] {
  return [f.x + Math.sin(f.yaw) * distance, f.z + Math.cos(f.yaw) * distance];
}

function furnishLiving(p: RoomPlanner, c: Colors, rng: () => number): void {
  // Sofa on the wall with the most free space (not the front, which has the door).
  let sofa: Furniture | null = null;
  let sofaWall: WallInfo | undefined;
  for (const wall of p.wallsByFreeLength(['front'])) {
    sofa = p.against(wall, { type: 'sofa', w: 2.2, d: 0.95, h: 0.85, color: c.fabric });
    if (sofa) {
      sofaWall = wall;
      break;
    }
  }
  if (sofa && sofaWall) {
    const along = sofaWall.side === 'front' || sofaWall.side === 'back' ? sofa.x : sofa.z;
    const [tx, tz] = inFront(sofa, sofa.d / 2 + 0.5 + 0.3);
    p.at({ type: 'rug', w: 2.6, d: 1.8, h: 0.01, color: c.rug() }, tx, tz, sofa.yaw);
    p.at({ type: 'coffeeTable', w: 1.1, d: 0.6, h: 0.42, color: c.wood }, tx, tz, sofa.yaw);
    // TV facing the sofa if possible, else on whichever wall has room.
    const tv = { type: 'tvStand' as const, w: 1.6, d: 0.45, h: 0.5, color: c.wood };
    const tvWall = p.walls.find((w) => w.side === opposite(sofaWall!.side))!;
    if (!p.against(tvWall, tv, along)) for (const wall of p.wallsByFreeLength([sofaWall.side])) if (p.against(wall, tv)) break;
    // Armchair beside the sofa, angled toward the coffee table.
    const side = rng() < 0.5 ? -1 : 1;
    for (const s of [side, -side]) {
      const [ax, az] = inFront(sofa, 0.9);
      const lateral = 1.1 + 0.6;
      const x = ax + Math.cos(sofa.yaw) * lateral * s;
      const z = az - Math.sin(sofa.yaw) * lateral * s;
      if (p.at({ type: 'armchair', w: 0.85, d: 0.85, h: 0.95, color: c.fabric }, x, z, sofa.yaw - s * 0.7)) break;
    }
    p.against(sofaWall, { type: 'floorLamp', w: 0.4, d: 0.4, h: 1.6, color: '#2b2b2b' }, along + (sofa.w / 2 + 0.35) * -side);
  }
  for (const wall of p.wallsByFreeLength()) if (p.against(wall, { type: 'bookshelf', w: 1.0, d: 0.35, h: 1.9, color: c.wood })) break;
  for (const wall of p.wallsByFreeLength()) if (p.against(wall, { type: 'plant', w: 0.5, d: 0.5, h: 1.2, color: '#4e6b3a' }, wall.lo + 0.4) || p.against(wall, { type: 'plant', w: 0.5, d: 0.5, h: 1.2, color: '#4e6b3a' }, wall.hi - 0.4)) break;
}

function furnishKitchen(p: RoomPlanner, i: Interior, c: Colors): void {
  // Counter run along the back (outer) wall if there is one, with the sink under the window.
  const walls = p.wallsByFreeLength();
  const counterWall = walls.find((w) => w.side === 'back') ?? walls[0];
  const free = freeIntervals(counterWall, { type: 'counter', w: 0, d: 0, h: 0.92, color: '' }, false);
  const longest = free.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  if (longest) {
    const modules = Math.min(6, Math.floor((longest[1] - longest[0] - 0.85) / 0.6));
    if (modules >= 3) {
      const length = modules * 0.6;
      // Leave room for the fridge at one end of the run.
      const start = longest[0] + 0.85;
      const center = start + length / 2;
      const win = counterWall.windows[0];
      const sinkSlot = win ? Math.max(0, Math.min(modules - 1, Math.floor(((win[0] + win[1]) / 2 - start) / 0.6))) : 1;
      const stoveSlot = sinkSlot >= modules - 2 ? Math.max(0, sinkSlot - 2) : sinkSlot + 2;
      const layout = Array.from({ length: modules }, (_, k) => (k === sinkSlot ? 's' : k === stoveSlot ? 'o' : 'c')).join('');
      const counter = p.against(counterWall, { type: 'counter', w: length, d: 0.62, h: 0.92, color: c.cabinet, modules: layout }, center);
      if (counter) {
        p.against(counterWall, { type: 'fridge', w: 0.75, d: 0.7, h: 1.85, color: '#e8e8e6' }, longest[0] + 0.4);
        if (counterWall.windows.length === 0) {
          p.against(counterWall, { type: 'upperCabinets', w: length, d: 0.35, h: 0.7, y: 1.45, color: c.cabinet }, center);
        }
      }
    }
  }
  // Dining table with four chairs in the open floor.
  const table = p.inOpenFloor({ type: 'diningTable', w: 1.4, d: 0.85, h: 0.76, color: c.wood }, 0, 0.75);
  if (table) {
    for (const [dx, dz, yaw] of [
      [-0.35, -0.65, 0],
      [0.35, -0.65, 0],
      [-0.35, 0.65, Math.PI],
      [0.35, 0.65, Math.PI],
    ]) {
      p.at({ type: 'chair', w: 0.45, d: 0.45, h: 0.9, color: c.wood }, table.x + dx, table.z + dz, yaw);
    }
  }
  void i;
}

function furnishBedroom(p: RoomPlanner, c: Colors): void {
  const big = Math.min(p.room.maxX - p.room.minX, p.room.maxZ - p.room.minZ) > 3;
  const bedSpec = { type: 'bed' as const, w: big ? 1.6 : 1.0, d: 2.1, h: 1.05, color: c.bedding() };
  for (const wall of p.wallsByFreeLength()) {
    const bed = p.against(wall, bedSpec);
    if (!bed) continue;
    const along = wall.side === 'front' || wall.side === 'back' ? bed.x : bed.z;
    for (const s of [-1, 1]) p.against(wall, { type: 'nightstand', w: 0.5, d: 0.4, h: 0.55, color: c.wood }, along + s * (bed.w / 2 + 0.3));
    const [rx, rz] = inFront(bed, bed.d / 2 + 0.2);
    p.at({ type: 'rug', w: bed.w + 0.6, d: 1.0, h: 0.01, color: c.rug() }, rx, rz, bed.yaw);
    break;
  }
  for (const wall of p.wallsByFreeLength()) if (p.against(wall, { type: 'wardrobe', w: 1.2, d: 0.6, h: 2.0, color: c.wood })) break;
  for (const wall of p.wallsByFreeLength()) {
    const desk = p.against(wall, { type: 'desk', w: 1.1, d: 0.55, h: 0.75, color: c.wood });
    if (desk) {
      const [x, z] = inFront(desk, 0.45);
      p.at({ type: 'chair', w: 0.45, d: 0.45, h: 0.9, color: c.wood }, x, z, desk.yaw + Math.PI);
      break;
    }
  }
}

function furnishBathroom(p: RoomPlanner): void {
  const walls = p.wallsByFreeLength();
  let placedTub = false;
  for (const wall of walls) {
    if (p.against(wall, { type: 'bathtub', w: 1.7, d: 0.75, h: 0.55, color: '#f4f4f2' })) {
      placedTub = true;
      break;
    }
  }
  if (!placedTub) for (const wall of walls) if (p.against(wall, { type: 'shower', w: 0.9, d: 0.9, h: 2.0, color: '#f4f4f2' })) break;
  for (const wall of p.wallsByFreeLength()) if (p.against(wall, { type: 'toilet', w: 0.42, d: 0.68, h: 0.78, color: '#f4f4f2' })) break;
  for (const wall of p.wallsByFreeLength()) if (p.against(wall, { type: 'vanity', w: 0.8, d: 0.5, h: 0.85, color: '#f2f0ea' })) break;
}

// ---------------------------------------------------------------------------
// Geometry helpers

/** Axis-aligned footprint of an item (yaw is a multiple of 90° for wall items). */
export function footprint(f: Pick<Furniture, 'x' | 'z' | 'w' | 'd' | 'yaw'>): Rect {
  const c = Math.abs(Math.cos(f.yaw));
  const s = Math.abs(Math.sin(f.yaw));
  const hx = (f.w * c + f.d * s) / 2;
  const hz = (f.w * s + f.d * c) / 2;
  return { minX: f.x - hx, maxX: f.x + hx, minZ: f.z - hz, maxZ: f.z + hz };
}

export function stairsFootprint(s: Stairs): Rect {
  return { minX: Math.min(s.fromX, s.toX), maxX: Math.max(s.fromX, s.toX), minZ: s.minZ, maxZ: s.maxZ };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX - 1e-6 && b.minX < a.maxX - 1e-6 && a.minZ < b.maxZ - 1e-6 && b.minZ < a.maxZ - 1e-6;
}

function expand(r: Rect, m: number): Rect {
  return { minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m };
}

function hashId(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
