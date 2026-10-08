import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CURB_HEIGHT, type House } from '../../../../shared/town.ts';
import { boxCollider, hullCollider } from './colliders.ts';
import type { TownMaterials } from './materials.ts';
import { box, flatRect, type MeshBuilder, placement } from './meshBuilder.ts';
import { TEXTURE_TILE } from './textures.ts';

export const FOUNDATION_HEIGHT = 0.4;
export const STORY_HEIGHT = 2.8;
export const WALL_THICKNESS = 0.2;
export const DOOR_WIDTH = 1.1;
export const DOOR_HEIGHT = 2.2;
const ROOF_OVERHANG = 0.45;
const ROOF_THICKNESS = 0.16;
const WINDOW_W = 1.2;
const WINDOW_H = 1.3;
const WINDOW_SILL = 0.9;
const FRAME = 0.08;

/** World matrix of a house: origin at its footprint center on the block surface, local +Z = front. */
export function houseMatrix(h: House): THREE.Matrix4 {
  return placement(h.x, CURB_HEIGHT, h.z, h.rotation);
}

/**
 * Adds a house exterior (foundation, walls with a door opening, windows, gable roof,
 * porch, driveway, path, mailbox) to `builder`, plus its colliders.
 * The inside is empty for now; interiors come in a later milestone.
 */
export function buildHouse(h: House, builder: MeshBuilder, m: TownMaterials, physics: RAPIER.World): void {
  const M = houseMatrix(h);
  const at = (x: number, y: number, z: number, yaw = 0, pitch = 0) => M.clone().multiply(placement(x, y, z, yaw, pitch));
  const { width: w, depth: d } = h;
  const H = h.stories * STORY_HEIGHT;
  const T = WALL_THICKNESS;
  const base = FOUNDATION_HEIGHT;
  const wallTop = base + H;
  const wallMat = m.walls[h.style];
  const wallTile = TEXTURE_TILE[h.style];

  // Foundation and floor.
  builder.add(box(w + 0.3, base, d + 0.3, TEXTURE_TILE.concrete), m.concrete, at(0, base / 2, 0));
  boxCollider(physics, M, { x: 0, y: base / 2, z: 0 }, { x: w + 0.3, y: base, z: d + 0.3 });

  // Walls. Each is also a collider so the interior can be walked later.
  const wall = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    builder.add(box(sx, sy, sz, wallTile), wallMat, at(x, y, z), h.wallColor);
    boxCollider(physics, M, { x, y, z }, { x: sx, y: sy, z: sz });
  };
  wall(0, base + H / 2, -d / 2 + T / 2, w, H, T); // back
  wall(-w / 2 + T / 2, base + H / 2, 0, T, H, d - 2 * T); // left
  wall(w / 2 - T / 2, base + H / 2, 0, T, H, d - 2 * T); // right
  // Front wall, split around the door.
  const doorL = h.doorOffset - DOOR_WIDTH / 2;
  const doorR = h.doorOffset + DOOR_WIDTH / 2;
  const frontZ = d / 2 - T / 2;
  wall((-w / 2 + doorL) / 2, base + H / 2, frontZ, doorL + w / 2, H, T);
  wall((doorR + w / 2) / 2, base + H / 2, frontZ, w / 2 - doorR, H, T);
  wall(h.doorOffset, base + DOOR_HEIGHT + (H - DOOR_HEIGHT) / 2, frontZ, DOOR_WIDTH, H - DOOR_HEIGHT, T);

  // Door: closed for now; opening it comes with on-foot play.
  builder.add(box(DOOR_WIDTH, DOOR_HEIGHT, 0.06), m.door, at(h.doorOffset, base + DOOR_HEIGHT / 2, frontZ), h.doorColor);
  boxCollider(physics, M, { x: h.doorOffset, y: base + DOOR_HEIGHT / 2, z: frontZ }, { x: DOOR_WIDTH, y: DOOR_HEIGHT, z: 0.06 });
  frame(builder, m, at(h.doorOffset, base, d / 2 + 0.01), DOOR_WIDTH, DOOR_HEIGHT, false);

  // Porch step and a small canopy over the door.
  builder.add(box(DOOR_WIDTH + 1.6, base, 1.3, TEXTURE_TILE.concrete), m.concrete, at(h.doorOffset, base / 2, d / 2 + 0.65));
  boxCollider(physics, M, { x: h.doorOffset, y: base / 2, z: d / 2 + 0.65 }, { x: DOOR_WIDTH + 1.6, y: base, z: 1.3 });
  builder.add(box(DOOR_WIDTH + 1.2, 0.1, 1.1, TEXTURE_TILE.shingles), m.roof, at(h.doorOffset, base + DOOR_HEIGHT + 0.35, d / 2 + 0.55), h.roofColor);

  // Windows on every story and side, skipping the door.
  for (let story = 0; story < h.stories; story++) {
    const sill = base + story * STORY_HEIGHT + WINDOW_SILL;
    for (const side of ['front', 'back'] as const) {
      const count = Math.max(1, Math.floor((w - 1.5) / 3));
      for (let i = 0; i < count; i++) {
        const x = -w / 2 + (w / count) * (i + 0.5);
        if (story === 0 && side === 'front' && Math.abs(x - h.doorOffset) < DOOR_WIDTH / 2 + WINDOW_W / 2 + 0.3) continue;
        const z = side === 'front' ? d / 2 : -d / 2;
        window_(builder, m, at(x, sill, z, side === 'front' ? 0 : Math.PI));
      }
    }
    for (const sx of [-1, 1]) {
      for (const fz of [-0.25, 0.25]) {
        window_(builder, m, at((sx * w) / 2, sill, fz * d, (sx * Math.PI) / 2));
      }
    }
  }

  // Gable roof with the ridge along the width.
  const rise = (d / 2) * h.roofPitch;
  const slope = Math.atan(h.roofPitch);
  const run = d / 2 + ROOF_OVERHANG;
  const slabLength = run / Math.cos(slope);
  const ridgeY = wallTop + rise;
  for (const dir of [1, -1]) {
    // Raise the slab by half its thickness so its underside rests on the walls.
    const cy = ridgeY - (run / 2) * h.roofPitch + ROOF_THICKNESS / 2 / Math.cos(slope);
    builder.add(
      box(w + 2 * ROOF_OVERHANG, ROOF_THICKNESS, slabLength, TEXTURE_TILE.shingles),
      m.roof,
      at(0, cy, (dir * run) / 2, 0, dir * slope),
      h.roofColor,
    );
  }
  // Ridge cap and the triangular gable walls.
  builder.add(box(w + 2 * ROOF_OVERHANG, 0.12, 0.3), m.roof, at(0, ridgeY + ROOF_THICKNESS, 0), h.roofColor);
  const gable = gableGeometry(d, rise, T, wallTile);
  builder.add(gable, wallMat, at(-w / 2 + T, wallTop, 0), h.wallColor);
  builder.add(gable, wallMat, at(w / 2, wallTop, 0), h.wallColor);
  // Roof collider: a prism over the walls, so cars that jump onto it don't fall inside.
  hullCollider(physics, M, [
    new THREE.Vector3(-w / 2, wallTop, -d / 2),
    new THREE.Vector3(w / 2, wallTop, -d / 2),
    new THREE.Vector3(-w / 2, wallTop, d / 2),
    new THREE.Vector3(w / 2, wallTop, d / 2),
    new THREE.Vector3(-w / 2, ridgeY, 0),
    new THREE.Vector3(w / 2, ridgeY, 0),
  ]);

  if (h.hasChimney) {
    const cx = w / 2 - 1.3;
    const cz = -d / 4;
    const bottom = wallTop + rise * 0.3;
    const height = ridgeY + 1.1 - bottom;
    builder.add(box(0.8, height, 0.8, TEXTURE_TILE.brick), m.walls.brick, at(cx, bottom + height / 2, cz), '#8a5446');
  }

  // Yard: driveway beside the house, path to the door, and a mailbox by the sidewalk.
  const yardY = 0.005;
  const lotFront = d / 2 + h.setback;
  const driveX = h.drivewaySide * (w / 2 + 2);
  builder.add(flatRect(driveX - 1.6, -d / 2, driveX + 1.6, lotFront, yardY, TEXTURE_TILE.concrete), m.paving, M, undefined, {
    castShadow: false,
  });
  builder.add(flatRect(h.doorOffset - 0.6, d / 2 + 1.3, h.doorOffset + 0.6, lotFront, yardY, TEXTURE_TILE.concrete), m.paving, M, undefined, {
    castShadow: false,
  });
  const mailX = h.doorOffset - h.drivewaySide * 1.2;
  builder.add(box(0.08, 1.05, 0.08), m.darkMetal, at(mailX, 0.52, lotFront - 0.6));
  builder.add(new THREE.CapsuleGeometry(0.17, 0.32, 4, 10).rotateX(Math.PI / 2), m.door, at(mailX, 1.15, lotFront - 0.6), h.doorColor);
}

/** Window: glass pane with a white frame, sill at local y=0, set into a wall facing local +Z. */
function window_(builder: MeshBuilder, m: TownMaterials, M: THREE.Matrix4): void {
  const at = (x: number, y: number, z: number) => M.clone().multiply(placement(x, y, z));
  builder.add(box(WINDOW_W, WINDOW_H, 0.04), m.glass, at(0, WINDOW_H / 2, 0.01));
  frame(builder, m, M, WINDOW_W, WINDOW_H, true);
  // Mullion across the middle.
  builder.add(box(WINDOW_W, 0.05, 0.05), m.trim, at(0, WINDOW_H / 2, 0.04));
}

/** Rectangular trim around an opening whose bottom center is the local origin. */
function frame(builder: MeshBuilder, m: TownMaterials, M: THREE.Matrix4, w: number, h: number, withSill: boolean): void {
  const at = (x: number, y: number, z: number) => M.clone().multiply(placement(x, y, z));
  builder.add(box(w + 2 * FRAME, FRAME, 0.08), m.trim, at(0, h + FRAME / 2, 0.03));
  builder.add(box(FRAME, h, 0.08), m.trim, at(-w / 2 - FRAME / 2, h / 2, 0.03));
  builder.add(box(FRAME, h, 0.08), m.trim, at(w / 2 + FRAME / 2, h / 2, 0.03));
  if (withSill) builder.add(box(w + 0.3, 0.07, 0.18), m.trim, at(0, -0.035, 0.07));
}

/**
 * Triangular gable-end wall: base along local Z from -depth/2 to depth/2 at y=0,
 * apex at y=rise, extruded `thickness` toward local -X.
 */
function gableGeometry(depth: number, rise: number, thickness: number, tile: number): THREE.BufferGeometry {
  const shape = new THREE.Shape([
    new THREE.Vector2(-depth / 2, 0),
    new THREE.Vector2(depth / 2, 0),
    new THREE.Vector2(0, rise),
  ]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
  // Shape X becomes local Z, extrusion becomes local -X.
  return g.rotateY(-Math.PI / 2);
}
