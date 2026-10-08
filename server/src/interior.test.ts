import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DOORWAY_WIDTH,
  footprint,
  generateInterior,
  type Interior,
  NON_SOLID,
  PARTITION_THICKNESS,
  type Room,
  stairsFootprint,
} from '../../shared/interior.ts';
import { generateTown, type Rect } from '../../shared/town.ts';

const houses = generateTown().houses;
const interiors = houses.map((h) => ({ h, i: generateInterior(h) }));

const overlaps = (a: Rect, b: Rect, m = 0) => a.minX < b.maxX - m && b.minX < a.maxX - m && a.minZ < b.maxZ - m && b.minZ < a.maxZ - m;
const inside = (a: Rect, b: Rect, m = 1e-6) => a.minX >= b.minX - m && a.maxX <= b.maxX + m && a.minZ >= b.minZ - m && a.maxZ <= b.maxZ + m;

/** Rooms sharing a wall through a doorway, plus the stairs between floors. */
function neighbors(i: Interior, r: Room): Room[] {
  const out: Room[] = [];
  for (const p of i.partitions) {
    if (p.story !== r.story) continue;
    for (const o of p.openings) {
      const [x, z] = p.axis === 'x' ? [o.center, p.at] : [p.at, o.center];
      const touching = (q: Room) =>
        q.story === r.story &&
        (p.axis === 'x'
          ? x > q.minX && x < q.maxX && Math.abs(Math.abs(z - (z < (q.minZ + q.maxZ) / 2 ? q.minZ : q.maxZ)) - PARTITION_THICKNESS / 2) < 1e-6
          : z > q.minZ && z < q.maxZ && Math.abs(Math.abs(x - (x < (q.minX + q.maxX) / 2 ? q.minX : q.maxX)) - PARTITION_THICKNESS / 2) < 1e-6);
      if (touching(r)) out.push(...i.rooms.filter((q) => q !== r && touching(q)));
    }
  }
  if (i.stairs && i.stairwell) {
    const below = i.rooms.find((q) => q.story === 0 && overlaps(q, stairsFootprint(i.stairs!)));
    const above = i.rooms.find((q) => q.story === 1 && overlaps(q, i.stairwell!));
    if (r === below && above) out.push(above);
    if (r === above && below) out.push(below);
  }
  return out;
}

test('every house has the essential rooms, and two-story houses have stairs', () => {
  for (const { h, i } of interiors) {
    const types = i.rooms.map((r) => r.type);
    for (const t of ['living', 'kitchen', 'bedroom', 'bathroom'] as const) assert.ok(types.includes(t), `${h.address} has no ${t}`);
    assert.equal(!!i.stairs, h.stories === 2, `${h.address} stairs`);
    if (h.stories === 2) {
      assert.ok(types.filter((t) => t === 'bedroom').length >= 2);
      const s = i.stairs!;
      assert.ok(inside(stairsFootprint(s), i.inner), `${h.address} stairs outside the house`);
      // Must be climbable by the character controller (max 45°) one step at a time.
      assert.ok(Math.atan((s.topY - s.bottomY) / Math.abs(s.toX - s.fromX)) < (40 * Math.PI) / 180);
    }
  }
});

test('rooms fit inside the house without overlapping', () => {
  for (const { h, i } of interiors) {
    for (const r of i.rooms) assert.ok(inside(r, i.inner), `${h.address} room ${r.id} outside`);
    for (const a of i.rooms) for (const b of i.rooms) if (a !== b && a.story === b.story) assert.ok(!overlaps(a, b), `${h.address} rooms ${a.id}/${b.id} overlap`);
  }
});

test('every room can be reached from the front door', () => {
  for (const { h, i } of interiors) {
    const start = i.rooms.find((r) => r.type === 'living' && r.story === 0)!;
    const door = i.exterior.front.find((o) => o.kind === 'door')!;
    assert.ok(door.center > start.minX && door.center < start.maxX, `${h.address} door not in the living room`);
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) for (const n of neighbors(i, queue.shift()!)) if (!seen.has(n)) (seen.add(n), queue.push(n));
    const unreachable = i.rooms.filter((r) => !seen.has(r)).map((r) => `${r.type}@${r.story}`);
    assert.deepEqual(unreachable, [], `${h.address} unreachable rooms`);
  }
});

test('outer wall openings do not overlap each other', () => {
  for (const { h, i } of interiors) {
    for (const side of ['front', 'back', 'left', 'right'] as const) {
      const os = i.exterior[side];
      for (const a of os) for (const b of os) {
        if (a === b) continue;
        const sameHeight = a.bottom < b.top && b.bottom < a.top;
        assert.ok(!sameHeight || Math.abs(a.center - b.center) >= (a.width + b.width) / 2, `${h.address} ${side} openings overlap`);
      }
    }
    assert.ok(i.rooms.filter((r) => r.type !== 'hall').every((r) => hasWindow(i, r)), `${h.address} has a room without a window`);
  }
});

function hasWindow(i: Interior, r: Room): boolean {
  const floor = i.floorY[r.story];
  const at = (side: string, lo: number, hi: number) =>
    i.exterior[side as 'front'].some((o) => o.kind !== 'door' && o.bottom > floor && o.bottom < floor + 2 && o.center > lo && o.center < hi);
  return (
    (r.maxZ > i.inner.maxZ - 1e-6 && at('front', r.minX, r.maxX)) ||
    (r.minZ < i.inner.minZ + 1e-6 && at('back', r.minX, r.maxX)) ||
    (r.minX < i.inner.minX + 1e-6 && at('left', r.minZ, r.maxZ)) ||
    (r.maxX > i.inner.maxX - 1e-6 && at('right', r.minZ, r.maxZ))
  );
}

test('furniture stays in its room, does not overlap, and keeps doorways and stairs clear', () => {
  for (const { h, i } of interiors) {
    const solid = i.furniture.filter((f) => !NON_SOLID.has(f.type));
    for (const f of i.furniture) {
      const room = i.rooms.find((r) => r.id === f.room)!;
      assert.ok(inside(footprint(f), room), `${h.address} ${f.type} sticks out of ${room.type}`);
    }
    for (const a of solid) for (const b of solid) if (a !== b && a.room === b.room) assert.ok(!overlaps(footprint(a), footprint(b), 0.001), `${h.address} ${a.type} overlaps ${b.type}`);
    // A doorway-wide strip just inside each doorway and the front door is free.
    const doors: { x: number; z: number; story: number; axis: 'x' | 'z' }[] = [];
    for (const p of i.partitions) for (const o of p.openings) doors.push({ x: p.axis === 'x' ? o.center : p.at, z: p.axis === 'x' ? p.at : o.center, story: p.story, axis: p.axis });
    const front = i.exterior.front.find((o) => o.kind === 'door')!;
    doors.push({ x: front.center, z: i.inner.maxZ, story: 0, axis: 'x' });
    for (const d of doors) {
      const half = DOORWAY_WIDTH / 2;
      const zone = d.axis === 'x' ? { minX: d.x - half, maxX: d.x + half, minZ: d.z - 0.8, maxZ: d.z + 0.8 } : { minX: d.x - 0.8, maxX: d.x + 0.8, minZ: d.z - half, maxZ: d.z + half };
      for (const f of solid) {
        const story = i.rooms.find((r) => r.id === f.room)!.story;
        if (story === d.story) assert.ok(!overlaps(footprint(f), zone), `${h.address} ${f.type} blocks a doorway`);
      }
    }
    if (i.stairs) for (const f of solid) if (f.y < i.floorY[1] - 1) assert.ok(!overlaps(footprint(f), stairsFootprint(i.stairs)), `${h.address} ${f.type} on the stairs`);
  }
});

test('every house is furnished', () => {
  for (const { h, i } of interiors) {
    const has = (t: string) => i.furniture.some((f) => f.type === t);
    for (const t of ['sofa', 'coffeeTable', 'tvStand', 'counter', 'fridge', 'diningTable', 'bed', 'toilet', 'vanity']) assert.ok(has(t), `${h.address} has no ${t}`);
  }
});

test('interiors are deterministic', () => {
  assert.deepEqual(generateInterior(houses[3]), generateInterior(houses[3]));
});
