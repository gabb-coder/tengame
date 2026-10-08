import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { type Furniture, type Interior, NON_SOLID, PARTITION_THICKNESS, type Room } from '../../../../shared/interior.ts';
import type { House, Rect } from '../../../../shared/town.ts';
import { boxCollider, hullCollider } from './colliders.ts';
import { buildFurniture } from './furniture.ts';
import type { TownMaterials } from './materials.ts';
import { box, flatRect, type MeshBuilder, placement, projectedBox, wallPieces } from './meshBuilder.ts';
import { TEXTURE_TILE } from './textures.ts';

const TRIM = 0.08;
const RAIL_HEIGHT = 0.95;
const STAIR_COLOR = '#8f6a48';

/**
 * Inside of a house: floors, ceilings, interior walls with doorways, the upper floor
 * and stairs, ceiling lights and furniture. `M` is the house's world matrix.
 */
export function buildInterior(
  h: House,
  plan: Interior,
  builder: MeshBuilder,
  m: TownMaterials,
  physics: RAPIER.World,
  M: THREE.Matrix4,
  furnitureBuilder: FurnitureBuilder = () => builder,
): void {
  const at = (x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0) => M.clone().multiply(placement(x, y, z, yaw, pitch, roll));
  const noShadow = { castShadow: false };
  void h;

  // Floors, per room.
  for (const r of plan.rooms) {
    const [mat, tile] = r.floor === 'tile' ? [m.tileFloor, TEXTURE_TILE.tile] : r.floor === 'carpet' ? [m.carpetFloor, TEXTURE_TILE.carpet] : [m.floor, TEXTURE_TILE.wood];
    builder.add(flatRect(r.minX, r.minZ, r.maxX, r.maxZ, plan.floorY[r.story] + 0.002, tile), mat, M, undefined, noShadow);
  }

  // Ceilings, and the upper floor (with a hole for the stairs) in two-story houses.
  const top = plan.stories - 1;
  builder.add(flatRect(plan.inner.minX, plan.inner.minZ, plan.inner.maxX, plan.inner.maxZ, plan.ceilingY[top], TEXTURE_TILE.plaster, true), m.ceiling, M, undefined, noShadow);
  if (plan.stories === 2) {
    const y0 = plan.ceilingY[0];
    const y1 = plan.floorY[1];
    for (const r of subtract(plan.inner, plan.stairwell)) {
      builder.add(projectedBox({ x: r.minX, y: y0, z: r.minZ }, { x: r.maxX, y: y1, z: r.maxZ }, TEXTURE_TILE.plaster), m.ceiling, M);
      boxCollider(physics, M, { x: (r.minX + r.maxX) / 2, y: (y0 + y1) / 2, z: (r.minZ + r.maxZ) / 2 }, { x: r.maxX - r.minX, y: y1 - y0, z: r.maxZ - r.minZ });
    }
  }

  // Interior walls, with trim around each doorway.
  const PT = PARTITION_THICKNESS;
  for (const p of plan.partitions) {
    const bottom = plan.floorY[p.story];
    const top = plan.ceilingY[p.story];
    for (const r of wallPieces(p.from, p.to, bottom, top, p.openings)) {
      const [min, max] =
        p.axis === 'x'
          ? [{ x: r.u0, y: r.v0, z: p.at - PT / 2 }, { x: r.u1, y: r.v1, z: p.at + PT / 2 }]
          : [{ x: p.at - PT / 2, y: r.v0, z: r.u0 }, { x: p.at + PT / 2, y: r.v1, z: r.u1 }];
      builder.add(projectedBox(min, max, TEXTURE_TILE.plaster), m.interiorWall, M, plan.wallColor);
      boxCollider(physics, M, { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }, { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z });
    }
    for (const o of p.openings) {
      const faces =
        p.axis === 'x'
          ? [at(o.center, o.bottom, p.at + PT / 2, 0), at(o.center, o.bottom, p.at - PT / 2, Math.PI)]
          : [at(p.at + PT / 2, o.bottom, o.center, Math.PI / 2), at(p.at - PT / 2, o.bottom, o.center, -Math.PI / 2)];
      for (const f of faces) frame(builder, m, f, o.width, o.top - o.bottom, false);
    }
  }

  // Stairs: solid steps, a smooth ramp collider under their noses, and a handrail.
  const s = plan.stairs;
  if (s) {
    const dir = Math.sign(s.toX - s.fromX);
    const tread = Math.abs(s.toX - s.fromX) / s.steps;
    const rise = (s.topY - s.bottomY) / s.steps;
    for (let i = 0; i < s.steps; i++) {
      const xa = s.fromX + dir * i * tread;
      const xb = xa + dir * tread;
      const stepTop = s.bottomY + (i + 1) * rise;
      builder.add(projectedBox({ x: Math.min(xa, xb), y: s.bottomY, z: s.minZ }, { x: Math.max(xa, xb), y: stepTop, z: s.maxZ }, TEXTURE_TILE.wood), m.furnitureWood, M, STAIR_COLOR);
      // Nosing: a slightly proud lip on each tread.
      builder.add(box(tread + 0.02, 0.03, s.maxZ - s.minZ), m.furnitureWood, at((xa + xb) / 2 + dir * 0.01, stepTop - 0.015, (s.minZ + s.maxZ) / 2), '#7a5a3c');
    }
    hullCollider(physics, M, [
      new THREE.Vector3(s.fromX, s.bottomY, s.minZ),
      new THREE.Vector3(s.fromX, s.bottomY, s.maxZ),
      new THREE.Vector3(s.toX, s.topY, s.minZ),
      new THREE.Vector3(s.toX, s.topY, s.maxZ),
      new THREE.Vector3(s.toX, s.bottomY, s.minZ),
      new THREE.Vector3(s.toX, s.bottomY, s.maxZ),
    ]);
    // Handrail along the open side, following the slope, with balusters every other step.
    const run = Math.abs(s.toX - s.fromX);
    const length = Math.hypot(run, s.topY - s.bottomY);
    const angle = dir * Math.atan((s.topY - s.bottomY) / run);
    const railZ = s.maxZ - 0.04;
    builder.add(box(length, 0.06, 0.06), m.furnitureWood, at((s.fromX + s.toX) / 2, (s.bottomY + s.topY) / 2 + RAIL_HEIGHT, railZ, 0, 0, angle), STAIR_COLOR);
    for (let i = 0; i <= s.steps; i += 2) {
      const x = s.fromX + dir * (i + 0.5) * tread;
      const stepTop = s.bottomY + Math.min(i + 1, s.steps) * rise;
      builder.add(box(0.04, RAIL_HEIGHT, 0.04), m.trim, at(x, stepTop + RAIL_HEIGHT / 2, railZ));
    }
  }

  // Railings around the stairwell upstairs (the long side and the bottom end).
  if (s && plan.stairwell) {
    const w = plan.stairwell;
    const y = plan.floorY[1];
    const bottomEndX = Math.abs(w.minX - s.fromX) < Math.abs(w.maxX - s.fromX) ? w.minX : w.maxX;
    railing(builder, m, physics, M, { x: w.minX, z: w.maxZ }, { x: w.maxX, z: w.maxZ }, y);
    railing(builder, m, physics, M, { x: bottomEndX, z: w.minZ }, { x: bottomEndX, z: w.maxZ }, y);
  }

  // A ceiling light in each room.
  for (const r of plan.rooms) {
    const [cx, cz] = roomCenter(r);
    const y = plan.ceilingY[r.story];
    builder.add(new THREE.CylinderGeometry(0.22, 0.26, 0.05, 20), m.lampShade, at(cx, y - 0.025, cz), undefined, noShadow);
  }

  // Furniture, with box colliders for anything solid.
  for (const f of plan.furniture) {
    buildFurniture(f, furnitureBuilder(f), m, M);
    if (NON_SOLID.has(f.type)) continue;
    const local = placement(f.x, f.y, f.z, f.yaw);
    boxCollider(physics, M.clone().multiply(local), { x: 0, y: f.h / 2, z: 0 }, { x: f.w, y: f.h, z: f.d });
  }
}

/** Picks which builder a piece of furniture goes into (e.g. a stand-in for a real model). */
export type FurnitureBuilder = (f: Furniture) => MeshBuilder;

export function roomCenter(r: Room): [number, number] {
  return [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];
}

/** Rectangular trim around an opening whose bottom center is the local origin, facing local +Z. */
export function frame(builder: MeshBuilder, m: TownMaterials, M: THREE.Matrix4, w: number, h: number, withSill: boolean): void {
  const at = (x: number, y: number, z: number) => M.clone().multiply(placement(x, y, z));
  builder.add(box(w + 2 * TRIM, TRIM, 0.08), m.trim, at(0, h + TRIM / 2, 0.03));
  builder.add(box(TRIM, h, 0.08), m.trim, at(-w / 2 - TRIM / 2, h / 2, 0.03));
  builder.add(box(TRIM, h, 0.08), m.trim, at(w / 2 + TRIM / 2, h / 2, 0.03));
  if (withSill) builder.add(box(w + 0.3, 0.07, 0.18), m.trim, at(0, -0.035, 0.07));
}

/** Straight railing between two floor points at height `y`, with a collider. */
function railing(builder: MeshBuilder, m: TownMaterials, physics: RAPIER.World, M: THREE.Matrix4, a: { x: number; z: number }, b: { x: number; z: number }, y: number): void {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  const mid = placement((a.x + b.x) / 2, y, (a.z + b.z) / 2, yaw);
  const local = (z: number, yy: number) => M.clone().multiply(mid).multiply(placement(0, yy, z));
  builder.add(box(0.07, 0.06, length), m.furnitureWood, local(0, RAIL_HEIGHT), STAIR_COLOR);
  const posts = Math.max(2, Math.round(length / 0.15));
  for (let i = 0; i <= posts; i++) builder.add(box(0.03, RAIL_HEIGHT, 0.03), m.trim, local(-length / 2 + (length * i) / posts, RAIL_HEIGHT / 2));
  boxCollider(physics, M.clone().multiply(mid), { x: 0, y: RAIL_HEIGHT / 2 + 0.05, z: 0 }, { x: 0.08, y: RAIL_HEIGHT + 0.1, z: length });
}

/** `outer` minus `hole` as up to four non-overlapping rectangles. */
function subtract(outer: Rect, hole: Rect | null): Rect[] {
  if (!hole) return [outer];
  const h = {
    minX: Math.max(outer.minX, hole.minX),
    maxX: Math.min(outer.maxX, hole.maxX),
    minZ: Math.max(outer.minZ, hole.minZ),
    maxZ: Math.min(outer.maxZ, hole.maxZ),
  };
  return [
    { minX: outer.minX, maxX: outer.maxX, minZ: outer.minZ, maxZ: h.minZ },
    { minX: outer.minX, maxX: outer.maxX, minZ: h.maxZ, maxZ: outer.maxZ },
    { minX: outer.minX, maxX: h.minX, minZ: h.minZ, maxZ: h.maxZ },
    { minX: h.maxX, maxX: outer.maxX, minZ: h.minZ, maxZ: h.maxZ },
  ].filter((r) => r.maxX - r.minX > 1e-4 && r.maxZ - r.minZ > 1e-4);
}
