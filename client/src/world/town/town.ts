import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { type FurnitureType, generateInterior, type Interior } from '../../../../shared/interior.ts';
import { CURB_HEIGHT, type House, type Rect, roadCenter, TOWN_HALF_EXTENT, type TownLayout, generateTown, mulberry32, type Tree } from '../../../../shared/town.ts';
import { boxCollider } from './colliders.ts';
import { type BlockFurniture, FURNITURE_MODELS, type FurnitureSlot } from './furnitureModels.ts';
import { buildHouse, houseMatrix } from './houses.ts';
import type { TownMaterials } from './materials.ts';
import { box, flatRect, IDENTITY, MeshBuilder, placement } from './meshBuilder.ts';
import { buildBlock, buildPerimeterSidewalk, buildRoads, lampPositions } from './roads.ts';
import { buildTrees, placeLamps } from './props.ts';
import { TEXTURE_TILE } from './textures.ts';

/** Interiors further than this from the camera are hidden; they're only seen up close. */
const INTERIOR_VIEW_DISTANCE = 45;

export interface Town {
  layout: TownLayout;
  /** Floor plan and furniture of each house, by house id. */
  interiors: Map<string, Interior>;
  /** Every house: the town's, then the zones'. */
  houses: House[];
  group: THREE.Group;
  /** Furniture that real models can replace, per block (see FurnitureModels). */
  furniture: BlockFurniture[];
  /** Shows only the interiors of blocks near `camera`. */
  updateInteriors(camera: THREE.Vector3): void;
}

/**
 * Builds the whole town into the scene and physics world, plus the houses out in the
 * zones (`zoneHouses`, one list per neighborhood).
 */
export function buildTown(scene: THREE.Scene, physics: RAPIER.World, m: TownMaterials, zoneHouses: House[][] = []): Town {
  const layout = generateTown();
  const houses = [...layout.houses, ...zoneHouses.flat()];
  const interiors = new Map(houses.map((h) => [h.id, generateInterior(h)]));
  const group = new THREE.Group();
  group.name = 'town';

  const roads = new MeshBuilder();
  buildRoads(layout, roads, m);
  buildPerimeterSidewalk(roads, m, physics);
  group.add(roads.build('roads'));

  // One merged chunk per block, so off-screen blocks are frustum-culled as a unit.
  const insides: { group: THREE.Group; block: Rect }[] = [];
  const furniture: BlockFurniture[] = [];
  /** Builds the houses standing in `area` (with `extra` for the ground they stand on). */
  const neighborhood = (name: string, area: Rect, list: House[], extra: (builder: MeshBuilder) => void, hasInteriors: boolean) => {
    const builder = new MeshBuilder();
    const inside = new MeshBuilder();
    // Furniture that has real models is drawn separately, so it can be swapped out later.
    const standIns = new Map<FurnitureType, MeshBuilder>();
    const slots: FurnitureSlot[] = [];
    extra(builder);
    for (const h of list) {
      const M = houseMatrix(h);
      buildHouse(h, interiors.get(h.id)!, builder, inside, m, physics, (f) => {
        if (!FURNITURE_MODELS[f.type]) return inside;
        slots.push({ f, houseId: h.id, matrix: M.clone().multiply(placement(f.x, f.y, f.z, f.yaw)) });
        if (!standIns.has(f.type)) standIns.set(f.type, new MeshBuilder());
        return standIns.get(f.type)!;
      });
    }
    group.add(builder.build(name));
    if (!hasInteriors) return;
    const g = inside.build(`${name}-interiors`);
    const groups = new Map([...standIns].map(([type, b]) => [type, b.build(`${name}-${type}`)] as const));
    for (const s of groups.values()) g.add(s);
    // Under a roof, rooms and furniture would add many draws to the sun's shadows for
    // little to see.
    g.traverse((o) => (o.castShadow = false));
    group.add(g);
    insides.push({ group: g, block: area });
    furniture.push({ group: g, standIns: groups, slots });
  };
  layout.blocks.forEach((block, i) => {
    const inBlock = layout.houses.filter((h) => h.x > block.minX && h.x < block.maxX && h.z > block.minZ && h.z < block.maxZ);
    neighborhood(
      `block-${i}`,
      block,
      inBlock,
      (builder) => {
        buildBlock(block, builder, m, physics);
        if (block === layout.park) buildParkRamps(block, builder, m, physics);
      },
      block !== layout.park,
    );
  });
  zoneHouses.forEach((list, i) => {
    if (list.length === 0) return;
    const area = {
      minX: Math.min(...list.map((h) => h.x - h.width)),
      maxX: Math.max(...list.map((h) => h.x + h.width)),
      minZ: Math.min(...list.map((h) => h.z - h.depth)),
      maxZ: Math.max(...list.map((h) => h.z + h.depth)),
    };
    neighborhood(`zone-houses-${i}`, area, list, () => {}, true);
  });

  group.add(buildTrees([...layout.trees, ...outskirtTrees()], m, physics, 11));
  placeLamps(lampPositions(layout));

  scene.add(group);
  return {
    layout,
    interiors,
    houses,
    group,
    furniture,
    updateInteriors(camera) {
      for (const { group: g, block } of insides) {
        const dx = Math.max(block.minX - camera.x, 0, camera.x - block.maxX);
        const dz = Math.max(block.minZ - camera.z, 0, camera.z - block.maxZ);
        g.visible = g.matrixWorldAutoUpdate = Math.hypot(dx, dz) < INTERIOR_VIEW_DISTANCE;
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

/** Trees on the grass between the town and the highways, clear of the roads out of town. */
function outskirtTrees(): Tree[] {
  const rng = mulberry32(99);
  const trees: Tree[] = [];
  const exits = [roadCenter(1), roadCenter(2)];
  while (trees.length < 70) {
    const x = (rng() * 2 - 1) * 192;
    const z = (rng() * 2 - 1) * 192;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge < TOWN_HALF_EXTENT + 5 || edge > 190) continue;
    // Keep clear of the exit roads (along the axis that leaves town).
    const across = Math.abs(x) > Math.abs(z) ? z : x;
    if (exits.some((c) => Math.abs(across - c) < 9)) continue;
    trees.push({ x, z, y: 0, height: 7 + rng() * 6 });
  }
  return trees;
}
