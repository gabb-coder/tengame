import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ASPHALT_WIDTH,
  type House,
  type Rect,
  ROAD_WIDTH,
  TOWN_HALF_EXTENT,
  doorPosition,
  generateTown,
} from '../../shared/town.ts';

const town = generateTown();

function footprint(h: House, margin = 0): Rect {
  return {
    minX: h.x - h.width / 2 - margin,
    maxX: h.x + h.width / 2 + margin,
    minZ: h.z - h.depth / 2 - margin,
    maxZ: h.z + h.depth / 2 + margin,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

function inside(inner: Rect, outer: Rect): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minZ >= outer.minZ && inner.maxZ <= outer.maxZ;
}

test('layout is deterministic', () => {
  assert.deepEqual(generateTown(), town);
  assert.notDeepEqual(generateTown(7).houses, town.houses);
});

test('has a sensible number of houses with unique ids and addresses', () => {
  assert.ok(town.houses.length >= 30 && town.houses.length <= 60, `${town.houses.length} houses`);
  assert.equal(new Set(town.houses.map((h) => h.id)).size, town.houses.length);
  assert.equal(new Set(town.houses.map((h) => h.address)).size, town.houses.length);
  for (const h of town.houses) assert.match(h.address, /^\d+ \w+ Street$/);
});

test('every house sits inside a non-park block with room for its driveway', () => {
  for (const h of town.houses) {
    const block = town.blocks.find((b) => inside(footprint(h), b));
    assert.ok(block, `${h.address} is not inside a block`);
    assert.notDeepEqual(block, town.park, `${h.address} is in the park`);
    // Driveway runs beside the house on its drivewaySide; it must stay in the block too.
    const sideX = h.x + h.drivewaySide * (h.width / 2 + 3.5);
    assert.ok(sideX > block.minX && sideX < block.maxX, `${h.address} driveway leaves the block`);
  }
});

test('houses do not overlap each other', () => {
  for (let i = 0; i < town.houses.length; i++) {
    for (let j = i + 1; j < town.houses.length; j++) {
      const [a, b] = [town.houses[i], town.houses[j]];
      assert.ok(!overlaps(footprint(a, 1), footprint(b, 1)), `${a.address} overlaps ${b.address}`);
    }
  }
});

test('houses face the street they are addressed on', () => {
  for (const h of town.houses) {
    const street = town.roads.find((r) => r.axis === 'x' && h.address.endsWith(r.name))!;
    const frontZ = h.z + (h.facing === 'north' ? -1 : 1) * (h.depth / 2 + h.setback);
    assert.ok(Math.abs(Math.abs(frontZ - street.center) - ROAD_WIDTH / 2) < 0.01, `${h.address} front is off the street`);
  }
});

test('trees stay out of houses and off the roads', () => {
  for (const t of town.trees) {
    for (const h of town.houses) {
      assert.ok(!overlaps({ minX: t.x - 1, maxX: t.x + 1, minZ: t.z - 1, maxZ: t.z + 1 }, footprint(h)), 'tree in house');
    }
    assert.ok(town.blocks.some((b) => inside({ minX: t.x, maxX: t.x, minZ: t.z, maxZ: t.z }, b)), 'tree off a block');
  }
});

test('spawn points are on the asphalt and spread apart', () => {
  assert.equal(town.spawns.length, 4);
  for (const s of town.spawns) {
    const onRoad = town.roads.some((r) => Math.abs((r.axis === 'x' ? s.z : s.x) - r.center) < ASPHALT_WIDTH / 2);
    assert.ok(onRoad, `spawn ${s.x},${s.z} not on a road`);
    assert.ok(Math.abs(s.x) < TOWN_HALF_EXTENT && Math.abs(s.z) < TOWN_HALF_EXTENT);
  }
  for (let i = 1; i < town.spawns.length; i++) {
    assert.ok(Math.hypot(town.spawns[i].x - town.spawns[i - 1].x, town.spawns[i].z - town.spawns[i - 1].z) >= 8);
  }
});

test('door positions lie on the middle of each house front, facing the street', () => {
  for (const h of town.houses) {
    const d = doorPosition(h);
    const frontZ = h.z + (h.facing === 'north' ? -1 : 1) * (h.depth / 2);
    assert.ok(Math.abs(d.z - frontZ) < 1e-9, `${h.address} door z`);
    const expectedX = h.x + (h.facing === 'north' ? -1 : 1) * h.doorOffset;
    assert.ok(Math.abs(d.x - expectedX) < 1e-9, `${h.address} door x`);
    assert.ok(Math.abs(h.doorOffset) < h.width / 2 - 1, `${h.address} door too close to a corner`);
  }
});
