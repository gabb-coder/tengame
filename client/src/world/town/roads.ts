import type RAPIER from '@dimforge/rapier3d-compat';
import {
  ASPHALT_WIDTH,
  BLOCKS_PER_SIDE,
  CURB_HEIGHT,
  type Rect,
  ROAD_WIDTH,
  SIDEWALK_WIDTH,
  TOWN_HALF_EXTENT,
  type TownLayout,
  roadCenter,
} from '../../../../shared/town.ts';
import { boxCollider } from './colliders.ts';
import type { TownMaterials } from './materials.ts';
import { box, flatRect, IDENTITY, type MeshBuilder, placement } from './meshBuilder.ts';
import { TEXTURE_TILE } from './textures.ts';

const ASPHALT_Y = 0.01;
const MARKING_Y = 0.02;
const DASH = 3;
const DASH_GAP = 3;
const LINE_WIDTH = 0.15;
const CROSSWALK_DEPTH = 3;
const STRIPE_WIDTH = 0.6;
const LAMP_SPACING = 26;
const LAMP_INSET = 0.5; // from the curb

const NO_SHADOW = { castShadow: false };

/** Asphalt, center lines and crosswalks for every road. */
export function buildRoads(layout: TownLayout, builder: MeshBuilder, m: TownMaterials): void {
  const first = roadCenter(0);
  const last = roadCenter(BLOCKS_PER_SIDE);
  const half = ASPHALT_WIDTH / 2;

  for (const road of layout.roads) {
    // Full-length strip; strips overlap at intersections with identical texels, so no seams.
    const [x0, z0, x1, z1] =
      road.axis === 'x'
        ? [first - half, road.center - half, last + half, road.center + half]
        : [road.center - half, first - half, road.center + half, last + half];
    builder.add(flatRect(x0, z0, x1, z1, ASPHALT_Y, TEXTURE_TILE.asphalt), m.asphalt, IDENTITY, undefined, NO_SHADOW);

    // Dashed center line between intersections, stopping short of the crosswalks.
    for (let i = 0; i < BLOCKS_PER_SIDE; i++) {
      const start = roadCenter(i) + half + CROSSWALK_DEPTH + 1;
      const end = roadCenter(i + 1) - half - CROSSWALK_DEPTH - 1;
      for (let s = start; s + DASH <= end; s += DASH + DASH_GAP) {
        const rect =
          road.axis === 'x'
            ? flatRect(s, road.center - LINE_WIDTH / 2, s + DASH, road.center + LINE_WIDTH / 2, MARKING_Y)
            : flatRect(road.center - LINE_WIDTH / 2, s, road.center + LINE_WIDTH / 2, s + DASH, MARKING_Y);
        builder.add(rect, m.markingYellow, IDENTITY, undefined, NO_SHADOW);
      }
    }
  }

  // Zebra crossings on every approach to every intersection.
  for (let i = 0; i <= BLOCKS_PER_SIDE; i++) {
    for (let j = 0; j <= BLOCKS_PER_SIDE; j++) {
      const cx = roadCenter(i);
      const cz = roadCenter(j);
      for (const dir of [-1, 1]) {
        const near = half + 0.6;
        const far = near + CROSSWALK_DEPTH;
        for (let s = -half + 0.5; s + STRIPE_WIDTH <= half - 0.3; s += STRIPE_WIDTH * 2) {
          // Crossing the east-west road (stripes run along x), on the west/east approaches.
          if ((dir < 0 && i > 0) || (dir > 0 && i < BLOCKS_PER_SIDE)) {
            const [a, b] = dir < 0 ? [cx - far, cx - near] : [cx + near, cx + far];
            builder.add(flatRect(a, cz + s, b, cz + s + STRIPE_WIDTH, MARKING_Y), m.markingWhite, IDENTITY, undefined, NO_SHADOW);
          }
          // Crossing the north-south road, on the north/south approaches.
          if ((dir < 0 && j > 0) || (dir > 0 && j < BLOCKS_PER_SIDE)) {
            const [a, b] = dir < 0 ? [cz - far, cz - near] : [cz + near, cz + far];
            builder.add(flatRect(cx + s, a, cx + s + STRIPE_WIDTH, b, MARKING_Y), m.markingWhite, IDENTITY, undefined, NO_SHADOW);
          }
        }
      }
    }
  }
}

/**
 * A raised block: curb-high slab with a sidewalk ring and a lawn (or park) on top.
 * `block` is the lawn area; the sidewalk surrounds it.
 */
export function buildBlock(block: Rect, builder: MeshBuilder, m: TownMaterials, physics: RAPIER.World): void {
  const sw = SIDEWALK_WIDTH;
  const outer = { minX: block.minX - sw, minZ: block.minZ - sw, maxX: block.maxX + sw, maxZ: block.maxZ + sw };
  const sizeX = outer.maxX - outer.minX;
  const sizeZ = outer.maxZ - outer.minZ;
  const cx = (outer.minX + outer.maxX) / 2;
  const cz = (outer.minZ + outer.maxZ) / 2;

  curbs(outer, builder, m);
  boxCollider(physics, IDENTITY, { x: cx, y: CURB_HEIGHT / 2, z: cz }, { x: sizeX, y: CURB_HEIGHT, z: sizeZ });

  const y = CURB_HEIGHT;
  builder.add(flatRect(block.minX, block.minZ, block.maxX, block.maxZ, y, TEXTURE_TILE.grass), m.grass, IDENTITY, undefined, NO_SHADOW);
  sidewalkRing(outer, block, y, builder, m);
}

/** The outer sidewalk along the far side of the perimeter roads. */
export function buildPerimeterSidewalk(builder: MeshBuilder, m: TownMaterials, physics: RAPIER.World): void {
  const e = TOWN_HALF_EXTENT;
  const inner = e - SIDEWALK_WIDTH;
  const outer = { minX: -e, minZ: -e, maxX: e, maxZ: e };
  const hole = { minX: -inner, minZ: -inner, maxX: inner, maxZ: inner };
  for (const piece of ringPieces(outer, hole)) {
    const sx = piece.maxX - piece.minX;
    const sz = piece.maxZ - piece.minZ;
    const center = { x: (piece.minX + piece.maxX) / 2, y: CURB_HEIGHT / 2, z: (piece.minZ + piece.maxZ) / 2 };
    boxCollider(physics, IDENTITY, center, { x: sx, y: CURB_HEIGHT, z: sz });
  }
  curbs(outer, builder, m);
  curbs(hole, builder, m);
  sidewalkRing(outer, hole, CURB_HEIGHT, builder, m);
}

/** Street lamp positions along both sidewalks of every road, clear of intersections. */
export function lampPositions(layout: TownLayout): { x: number; z: number; yaw: number }[] {
  const lamps: { x: number; z: number; yaw: number }[] = [];
  const offset = ASPHALT_WIDTH / 2 + LAMP_INSET;
  for (const road of layout.roads) {
    for (let i = 0; i < BLOCKS_PER_SIDE; i++) {
      const start = roadCenter(i) + ROAD_WIDTH / 2 + 6;
      const end = roadCenter(i + 1) - ROAD_WIDTH / 2 - 6;
      let side = 1;
      for (let s = start; s <= end; s += LAMP_SPACING) {
        // Skip the outward side of perimeter roads.
        const outwardOnly = (road.center === roadCenter(0) && side < 0) || (road.center === roadCenter(BLOCKS_PER_SIDE) && side > 0);
        if (!outwardOnly) {
          const lateral = road.center + side * offset;
          // Lamps face the road: arm points from the sidewalk toward the center.
          lamps.push(road.axis === 'x' ? { x: s, z: lateral, yaw: side > 0 ? Math.PI : 0 } : { x: lateral, z: s, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
        }
        side = -side;
      }
    }
  }
  return lamps;
}

function sidewalkRing(outer: Rect, inner: Rect, y: number, builder: MeshBuilder, m: TownMaterials): void {
  for (const r of ringPieces(outer, inner)) {
    builder.add(flatRect(r.minX, r.minZ, r.maxX, r.maxZ, y, TEXTURE_TILE.sidewalk), m.sidewalk, IDENTITY, undefined, NO_SHADOW);
  }
}

/** Vertical curb faces around `rect`, from the road up to just under the surface on top. */
function curbs(rect: Rect, builder: MeshBuilder, m: TownMaterials): void {
  const h = CURB_HEIGHT - 0.005;
  const t = 0.04;
  const sx = rect.maxX - rect.minX;
  const sz = rect.maxZ - rect.minZ;
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;
  for (const [x, z, w, d] of [
    [cx, rect.minZ + t / 2, sx, t],
    [cx, rect.maxZ - t / 2, sx, t],
    [rect.minX + t / 2, cz, t, sz],
    [rect.maxX - t / 2, cz, t, sz],
  ]) {
    builder.add(box(w, h, d, TEXTURE_TILE.concrete), m.concrete, placement(x, h / 2, z), undefined, NO_SHADOW);
  }
}

/** Splits the area between two nested rects into four non-overlapping strips. */
function ringPieces(outer: Rect, inner: Rect): Rect[] {
  return [
    { minX: outer.minX, minZ: outer.minZ, maxX: outer.maxX, maxZ: inner.minZ },
    { minX: outer.minX, minZ: inner.maxZ, maxX: outer.maxX, maxZ: outer.maxZ },
    { minX: outer.minX, minZ: inner.minZ, maxX: inner.minX, maxZ: inner.maxZ },
    { minX: inner.maxX, minZ: inner.minZ, maxX: outer.maxX, maxZ: inner.maxZ },
  ];
}

