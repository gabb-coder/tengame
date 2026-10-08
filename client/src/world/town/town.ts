import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CURB_HEIGHT, TOWN_HALF_EXTENT, type TownLayout, generateTown, mulberry32, type Tree } from '../../../../shared/town.ts';
import { boxCollider } from './colliders.ts';
import { buildHouse } from './houses.ts';
import type { TownMaterials } from './materials.ts';
import { box, flatRect, IDENTITY, MeshBuilder, placement } from './meshBuilder.ts';
import { buildBlock, buildPerimeterSidewalk, buildRoads, lampPositions } from './roads.ts';
import { buildLamps, buildTrees } from './props.ts';
import { TEXTURE_TILE } from './textures.ts';

/** How far past the town edge the invisible boundary walls stand. */
const BOUNDARY_MARGIN = 25;
const BACKDROP_TREES = 220;

export interface Town {
  layout: TownLayout;
  group: THREE.Group;
}

/** Builds the whole town into the scene and physics world. */
export function buildTown(scene: THREE.Scene, physics: RAPIER.World, m: TownMaterials): Town {
  const layout = generateTown();
  const group = new THREE.Group();
  group.name = 'town';

  const roads = new MeshBuilder();
  buildRoads(layout, roads, m);
  buildPerimeterSidewalk(roads, m, physics);
  group.add(roads.build('roads'));

  // One merged chunk per block, so off-screen blocks are frustum-culled as a unit.
  layout.blocks.forEach((block, i) => {
    const builder = new MeshBuilder();
    buildBlock(block, builder, m, physics);
    for (const h of layout.houses) {
      if (h.x > block.minX && h.x < block.maxX && h.z > block.minZ && h.z < block.maxZ) buildHouse(h, builder, m, physics);
    }
    if (block === layout.park) buildParkRamps(block, builder, m, physics);
    group.add(builder.build(`block-${i}`));
  });

  group.add(buildTrees(layout.trees, m, physics, 11));
  group.add(buildTrees(backdropTrees(), m, null, 12));
  group.add(buildLamps(lampPositions(layout), m, physics));
  addBoundary(physics);

  scene.add(group);
  return { layout, group };
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

