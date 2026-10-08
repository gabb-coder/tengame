import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  DOOR_HEIGHT,
  DOOR_WIDTH,
  FOUNDATION_HEIGHT,
  type Interior,
  type Opening,
  type Side,
  STORY_HEIGHT,
  WALL_THICKNESS,
} from '../../../../shared/interior.ts';
import { CURB_HEIGHT, type House } from '../../../../shared/town.ts';
import { boxCollider, hullCollider } from './colliders.ts';
import { buildInterior, frame } from './interior.ts';
import type { TownMaterials } from './materials.ts';
import { box, flatRect, type MeshBuilder, placement, projectedBox, wallPieces } from './meshBuilder.ts';
import { TEXTURE_TILE } from './textures.ts';

export { DOOR_HEIGHT, DOOR_WIDTH, FOUNDATION_HEIGHT, STORY_HEIGHT, WALL_THICKNESS };

const ROOF_OVERHANG = 0.45;
const PORCH_STEP_DEPTH = 0.45;
const ROOF_THICKNESS = 0.16;
/** Outer walls: a weatherproof outer skin and a painted inner skin. */
const OUTER_SKIN = 0.14;

/**
 * Where a house's front door hinges, in the house's local frame: on the left edge of the
 * opening (seen from outside), centered in the wall's thickness, at floor level.
 */
export function doorHingeLocal(h: House): THREE.Vector3 {
  return new THREE.Vector3(h.doorOffset - DOOR_WIDTH / 2, FOUNDATION_HEIGHT, h.depth / 2 - WALL_THICKNESS / 2);
}

/** World matrix of a house: origin at its footprint center on the block surface, local +Z = front. */
export function houseMatrix(h: House): THREE.Matrix4 {
  return placement(h.x, CURB_HEIGHT, h.z, h.rotation);
}

/**
 * Adds a house (foundation, walls with door and window openings, gable roof, porch,
 * yard) to `builder`, and everything inside (painted wall faces, inner trim, rooms and
 * furniture) to `inside`, plus colliders for all of it. Keeping the inside separate lets
 * far-away interiors be hidden.
 */
export function buildHouse(h: House, plan: Interior, builder: MeshBuilder, inside: MeshBuilder, m: TownMaterials, physics: RAPIER.World): void {
  const M = houseMatrix(h);
  const at = (x: number, y: number, z: number, yaw = 0, pitch = 0) => M.clone().multiply(placement(x, y, z, yaw, pitch));
  const { width: w, depth: d } = h;
  const H = h.stories * STORY_HEIGHT;
  const T = WALL_THICKNESS;
  const base = FOUNDATION_HEIGHT;
  const wallTop = base + H;
  const wallMat = m.walls[h.style];
  const wallTile = TEXTURE_TILE[h.style];

  // Foundation (its top is the ground floor).
  builder.add(box(w + 0.3, base, d + 0.3, TEXTURE_TILE.concrete), m.concrete, at(0, base / 2, 0));
  boxCollider(physics, M, { x: 0, y: base / 2, z: 0 }, { x: w + 0.3, y: base, z: d + 0.3 });

  // Outer walls, built in pieces around their doors and windows.
  for (const side of ['front', 'back', 'left', 'right'] as const) {
    const openings = plan.exterior[side];
    const along = side === 'front' || side === 'back';
    // Front/back walls span the full width; side walls fit between them.
    const [lo, hi] = along ? [-w / 2, w / 2] : [-d / 2 + T, d / 2 - T];
    // Distance of the wall's outer face from the center, and which way is outward.
    const outward = side === 'front' || side === 'right' ? 1 : -1;
    const face = (along ? d : w) / 2;
    for (const r of wallPieces(lo, hi, base, wallTop, openings)) {
      // Each piece: outer skin, inner skin, and one collider through both.
      const skins: [number, number, THREE.Material, string, number][] = [
        [face - OUTER_SKIN, face, wallMat, h.wallColor, wallTile],
        [face - T, face - OUTER_SKIN, m.interiorWall, plan.wallColor, TEXTURE_TILE.plaster],
      ];
      for (const [t0, t1, mat, color, tile] of skins) {
        const [a, b] = [outward * t0, outward * t1].sort((p, q) => p - q);
        // The painted inner skin stops at the inside corners so it never shows outside.
        const insideOnly = mat === m.interiorWall && along;
        const u0 = insideOnly ? Math.max(r.u0, -w / 2 + T) : r.u0;
        const u1 = insideOnly ? Math.min(r.u1, w / 2 - T) : r.u1;
        if (u1 - u0 < 1e-4) continue;
        const geo = along
          ? projectedBox({ x: u0, y: r.v0, z: a }, { x: u1, y: r.v1, z: b }, tile)
          : projectedBox({ x: a, y: r.v0, z: u0 }, { x: b, y: r.v1, z: u1 }, tile);
        (mat === m.interiorWall ? inside : builder).add(geo, mat, M, color);
      }
      const mid = outward * (face - T / 2);
      const center = along ? { x: (r.u0 + r.u1) / 2, y: (r.v0 + r.v1) / 2, z: mid } : { x: mid, y: (r.v0 + r.v1) / 2, z: (r.u0 + r.u1) / 2 };
      const size = along ? { x: r.u1 - r.u0, y: r.v1 - r.v0, z: T } : { x: T, y: r.v1 - r.v0, z: r.u1 - r.u0 };
      boxCollider(physics, M, center, size);
    }
    for (const o of openings) glaze(builder, inside, m, M, h, side, o);
  }

  buildInterior(h, plan, inside, m, physics, M);

  // Porch landing with a half-height step in front, and a small canopy over the door.
  const porch = (width: number, height: number, depth: number, z: number) => {
    builder.add(box(width, height, depth, TEXTURE_TILE.concrete), m.concrete, at(h.doorOffset, height / 2, z));
    boxCollider(physics, M, { x: h.doorOffset, y: height / 2, z }, { x: width, y: height, z: depth });
  };
  porch(DOOR_WIDTH + 1.6, base, 1.3, d / 2 + 0.65);
  porch(DOOR_WIDTH + 1.0, base / 2, PORCH_STEP_DEPTH, d / 2 + 1.3 + PORCH_STEP_DEPTH / 2);
  builder.add(box(DOOR_WIDTH + 1.2, 0.1, 1.1, TEXTURE_TILE.shingles), m.roof, at(h.doorOffset, base + DOOR_HEIGHT + 0.35, d / 2 + 0.55), h.roofColor);

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
  builder.add(flatRect(h.doorOffset - 0.6, d / 2 + 1.3 + PORCH_STEP_DEPTH, h.doorOffset + 0.6, lotFront, yardY, TEXTURE_TILE.concrete), m.paving, M, undefined, {
    castShadow: false,
  });
  const mailX = h.doorOffset - h.drivewaySide * 1.2;
  builder.add(box(0.08, 1.05, 0.08), m.darkMetal, at(mailX, 0.52, lotFront - 0.6));
  builder.add(new THREE.CapsuleGeometry(0.17, 0.32, 4, 10).rotateX(Math.PI / 2), m.door, at(mailX, 1.15, lotFront - 0.6), h.doorColor);
}

/**
 * Trim (inside and out) for an opening in an outer wall, plus glass for windows.
 * The front door's panel itself is a separate moving object (see doors.ts).
 */
function glaze(builder: MeshBuilder, inside: MeshBuilder, m: TownMaterials, M: THREE.Matrix4, h: House, side: Side, o: Opening): void {
  const T = WALL_THICKNESS;
  const { width: w, depth: d } = h;
  // Placement at the opening's bottom center on the outer face, facing out; and on the inner face, facing in.
  const [outer, inner, middle] = (() => {
    switch (side) {
      case 'front':
        return [placement(o.center, o.bottom, d / 2, 0), placement(o.center, o.bottom, d / 2 - T, Math.PI), placement(o.center, o.bottom, d / 2 - T / 2, 0)];
      case 'back':
        return [placement(o.center, o.bottom, -d / 2, Math.PI), placement(o.center, o.bottom, -d / 2 + T, 0), placement(o.center, o.bottom, -d / 2 + T / 2, 0)];
      case 'left':
        return [placement(-w / 2, o.bottom, o.center, -Math.PI / 2), placement(-w / 2 + T, o.bottom, o.center, Math.PI / 2), placement(-w / 2 + T / 2, o.bottom, o.center, Math.PI / 2)];
      case 'right':
        return [placement(w / 2, o.bottom, o.center, Math.PI / 2), placement(w / 2 - T, o.bottom, o.center, -Math.PI / 2), placement(w / 2 - T / 2, o.bottom, o.center, Math.PI / 2)];
    }
  })();
  const height = o.top - o.bottom;
  const isWindow = o.kind === 'window' || o.kind === 'smallWindow';
  frame(builder, m, M.clone().multiply(outer), o.width, height, isWindow);
  frame(inside, m, M.clone().multiply(inner), o.width, height, isWindow);
  if (!isWindow) return;
  const mid = M.clone().multiply(middle);
  const at = (x: number, y: number) => mid.clone().multiply(placement(x, y, 0));
  builder.add(box(o.width, height, 0.02), o.kind === 'smallWindow' ? m.frostedGlass : m.glass, at(0, height / 2), undefined, { castShadow: false });
  // Sash bars: a cross for big windows.
  builder.add(box(o.width, 0.05, 0.05), m.trim, at(0, height / 2));
  if (o.kind === 'window') builder.add(box(0.05, height, 0.05), m.trim, at(0, height / 2));
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
