import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { type FurnitureType, generateInterior, type Interior } from '../../../../shared/interior.ts';
import { CURB_HEIGHT, type Rect, TOWN_HALF_EXTENT, type TownLayout, generateTown, mulberry32, type Tree } from '../../../../shared/town.ts';
import { boxCollider } from './colliders.ts';
import { type BlockFurniture, FURNITURE_MODELS, type FurnitureSlot } from './furnitureModels.ts';
import { buildHouse, houseMatrix } from './houses.ts';
import type { TownMaterials } from './materials.ts';
import { box, flatRect, IDENTITY, MeshBuilder, placement } from './meshBuilder.ts';
import { buildBlock, buildPerimeterSidewalk, buildRoads, lampPositions } from './roads.ts';
import { buildLamps, buildTrees } from './props.ts';
import { TEXTURE_TILE } from './textures.ts';

/** How far past the town edge the invisible boundary walls stand. */
const BOUNDARY_MARGIN = 25;
const BACKDROP_TREES = 220;

/** Interiors further than this from the camera are hidden; they're only seen up close. */
const INTERIOR_VIEW_DISTANCE = 45;

export interface Town {
  layout: TownLayout;
  /** Floor plan and furniture of each house, by house id. */
  interiors: Map<string, Interior>;
  group: THREE.Group;
  /** Furniture that real models can replace, per block (see FurnitureModels). */
  furniture: BlockFurniture[];
  /** Shows only the interiors of blocks near `camera`. */
  updateInteriors(camera: THREE.Vector3): void;
}

/** Builds the whole town into the scene and physics world. */
export function buildTown(scene: THREE.Scene, physics: RAPIER.World, m: TownMaterials): Town {
  const layout = generateTown();
  const interiors = new Map(layout.houses.map((h) => [h.id, generateInterior(h)]));
  const group = new THREE.Group();
  group.name = 'town';

  const roads = new MeshBuilder();
  buildRoads(layout, roads, m);
  buildPerimeterSidewalk(roads, m, physics);
  group.add(roads.build('roads'));

  // One merged chunk per block, so off-screen blocks are frustum-culled as a unit.
  const insides: { group: THREE.Group; block: Rect }[] = [];
  const furniture: BlockFurniture[] = [];
  layout.blocks.forEach((block, i) => {
    const builder = new MeshBuilder();
    const inside = new MeshBuilder();
    // Furniture that has real models is drawn separately, so it can be swapped out later.
    const standIns = new Map<FurnitureType, MeshBuilder>();
    const slots: FurnitureSlot[] = [];
    buildBlock(block, builder, m, physics);
    for (const h of layout.houses) {
      if (!(h.x > block.minX && h.x < block.maxX && h.z > block.minZ && h.z < block.maxZ)) continue;
      const M = houseMatrix(h);
      buildHouse(h, interiors.get(h.id)!, builder, inside, m, physics, (f) => {
        if (!FURNITURE_MODELS[f.type]) return inside;
        slots.push({ f, houseId: h.id, matrix: M.clone().multiply(placement(f.x, f.y, f.z, f.yaw)) });
        if (!standIns.has(f.type)) standIns.set(f.type, new MeshBuilder());
        return standIns.get(f.type)!;
      });
    }
    if (block === layout.park) buildParkRamps(block, builder, m, physics);
    group.add(builder.build(`block-${i}`));
    if (block !== layout.park) {
      const g = inside.build(`block-${i}-interiors`);
      const groups = new Map([...standIns].map(([type, b]) => [type, b.build(`block-${i}-${type}`)] as const));
      for (const s of groups.values()) g.add(s);
      group.add(g);
      insides.push({ group: g, block });
      furniture.push({ group: g, standIns: groups, slots });
    }
  });

  group.add(buildTrees(layout.trees, m, physics, 11));
  group.add(buildTrees(backdropTrees(), m, null, 12));
  group.add(buildLamps(lampPositions(layout), m, physics));
  addBoundary(physics);

  scene.add(group);
  return {
    layout,
    interiors,
    group,
    furniture,
    updateInteriors(camera) {
      for (const { group: g, block } of insides) {
        const dx = Math.max(block.minX - camera.x, 0, camera.x - block.maxX);
        const dz = Math.max(block.minZ - camera.z, 0, camera.z - block.maxZ);
        g.visible = Math.hypot(dx, dz) < INTERIOR_VIEW_DISTANCE;
      }
    },
  };
}

function buildParkRamps(park: { minX: number; minZ: number; maxX: number; maxZ: number }, builder: MeshBuilder, m: TownMaterials, physics: RAPIER.World): void {
  const cx = (park.minX + park.maxX) / 2;
  const cz = (park.minZ + park.maxZ) / 2;
  const ramps: [number, number, number][] = [
    [cx - 18, cz, Math.PI / 2],
    [cx + 18, cz, -Math.PI / 2],
    [cx, cz + 20, Math.PI],
  ];
  const size = { x: 6, y: 0.4, z: 12 };
  const tilt = THREE.MathUtils.degToRad(14);
  for (const [x, z, yaw] of ramps) {
    const matrix = placement(x, CURB_HEIGHT + 1.3, z, yaw, -tilt);
    builder.add(box(size.x, size.y, size.z, TEXTURE_TILE.concrete), m.ramp, matrix);
    boxCollider(physics, matrix, { x: 0, y: 0, z: 0 }, size);
  }
  // Concrete pad under the ramps so cars don't tear up the lawn.
  builder.add(flatRect(cx - 28, cz - 28, cx + 28, cz + 28, CURB_HEIGHT + 0.005, TEXTURE_TILE.concrete), m.paving, IDENTITY, undefined, {
    castShadow: false,
  });
}

/** A ring of trees outside the boundary so the town doesn't end at a bare horizon. */
function backdropTrees(): Tree[] {
  const rng = mulberry32(99);
  const trees: Tree[] = [];
  for (let i = 0; i < BACKDROP_TREES; i++) {
    const angle = rng() * Math.PI * 2;
    // Square-ish ring hugging the boundary.
    const r = TOWN_HALF_EXTENT + BOUNDARY_MARGIN + 6 + rng() * 60;
    const k = 1 / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
    trees.push({ x: Math.cos(angle) * r * Math.min(k, 1.25), z: Math.sin(angle) * r * Math.min(k, 1.25), height: 8 + rng() * 8 });
  }
  return trees;
}

/** Invisible walls so cars can't leave the map. */
function addBoundary(physics: RAPIER.World): void {
  const e = TOWN_HALF_EXTENT + BOUNDARY_MARGIN;
  const height = 30;
  for (const [x, z, sx, sz] of [
    [0, -e, 2 * e, 1],
    [0, e, 2 * e, 1],
    [-e, 0, 1, 2 * e],
    [e, 0, 1, 2 * e],
  ]) {
    boxCollider(physics, IDENTITY, { x, y: height / 2, z }, { x: sx, y: height, z: sz });
  }
}

