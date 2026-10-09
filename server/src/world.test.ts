import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catchFish, FISHING_SPOTS, RELICS, TRIGGERS } from '../../shared/activities.ts';
import { appliancesOf, fireAppliances } from '../../shared/appliances.ts';
import { generateInterior } from '../../shared/interior.ts';
import { CURB_HEIGHT, TOWN_HALF_EXTENT } from '../../shared/town.ts';
import {
  distanceToPath,
  generateWorld,
  groundHeight,
  SEA_LEVEL,
  underwater,
  waterAt,
  WORLD_HALF,
  worldLocationName,
  zoneAt,
  ZONES,
} from '../../shared/world.ts';

const world = generateWorld();

test('the town sits in the middle of eight themed zones', () => {
  assert.equal(world.zones.length, 8);
  assert.equal(zoneAt(0, 0), 'town');
  for (const zone of world.zones) {
    const info = ZONES[zone.id];
    assert.equal(zoneAt(info.x, info.z), zone.id);
    assert.ok(info.name && info.theme, `${zone.id} has a name and a theme`);
  }
  assert.equal(new Set(Object.values(ZONES).map((z) => `${z.x},${z.z}`)).size, 9, 'one zone per grid cell');
});

test('every road stays inside the world, and you can drive from town to all of them', () => {
  for (const road of world.roads) {
    for (const p of road.path) assert.ok(Math.abs(p.x) <= WORLD_HALF + 1 && Math.abs(p.z) <= WORLD_HALF + 1, `${road.name} leaves the world at ${p.x},${p.z}`);
  }
  // Roads join where an end of one touches another (the town's streets count as one road).
  const touches = (a: (typeof world.roads)[number], b: (typeof world.roads)[number]) =>
    [a.path[0], a.path[a.path.length - 1]].some((end) => distanceToPath(b.path, end.x, end.z).distance < b.width / 2 + 2);
  const inTown = (r: (typeof world.roads)[number]) => [r.path[0], r.path[r.path.length - 1]].some((p) => Math.abs(p.x) <= TOWN_HALF_EXTENT && Math.abs(p.z) <= TOWN_HALF_EXTENT);
  const reached = new Set(world.roads.filter(inTown));
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of world.roads) {
      if (reached.has(r)) continue;
      if ([...reached].some((q) => touches(r, q) || touches(q, r))) {
        reached.add(r);
        grew = true;
      }
    }
  }
  const missing = world.roads.filter((r) => !reached.has(r)).map((r) => r.name);
  assert.deepEqual(missing, []);
});

test('the ground is level with every road (except under bridges)', () => {
  for (const road of world.roads) {
    road.path.forEach((p, i) => {
      // Skip points on or next to a bridge, where the road leaves the ground.
      for (let k = Math.max(0, i - 3); k <= Math.min(road.bridge.length - 1, i + 2); k++) if (road.bridge[k]) return;
      const d = groundHeight(p.x, p.z) - p.y;
      assert.ok(Math.abs(d) < 0.12, `${road.name} at ${p.x.toFixed(0)},${p.z.toFixed(0)}: ground is ${d.toFixed(2)} m off the road`);
    });
  }
});

test('zone houses stand on level lots, clear of roads and of each other', () => {
  const zoneHouses = world.houses.filter((h) => !h.id.startsWith('h'));
  assert.ok(zoneHouses.length >= 15);
  assert.equal(new Set(world.houses.map((h) => h.id)).size, world.houses.length, 'house ids are unique');
  for (const h of zoneHouses) {
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [h.x + (sx * h.width) / 2, h.z + (sz * h.depth) / 2]));
    for (const [x, z] of corners) {
      assert.ok(Math.abs(groundHeight(x, z) - CURB_HEIGHT) < 0.15, `${h.address}: ground at a corner is ${groundHeight(x, z).toFixed(2)}`);
      for (const road of world.roads) {
        assert.ok(distanceToPath(road.path, x, z).distance > road.width / 2, `${h.address} overlaps ${road.name}`);
      }
      assert.ok(!underwater(x, groundHeight(x, z), z), `${h.address} is in water`);
    }
    for (const other of zoneHouses) {
      if (other === h) continue;
      const apart = Math.abs(h.x - other.x) > (h.width + other.width) / 2 || Math.abs(h.z - other.z) > (h.depth + other.depth) / 2;
      assert.ok(apart, `${h.address} overlaps ${other.address}`);
    }
  }
});

test('fires sit on the ground, and every switchable thing has its own id', () => {
  assert.ok(world.fires.length >= 8);
  for (const f of world.fires) {
    assert.ok(Number.isFinite(f.y));
    if (f.id !== 'ancient/pyramid') assert.ok(Math.abs(f.y - groundHeight(f.x, f.z)) < 0.01, `${f.id} floats`);
  }
  const ids = [...world.houses.flatMap((h) => appliancesOf(h, generateInterior(h))), ...fireAppliances(world.fires)].map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('water: the sea is deep and you can be under it; land is dry', () => {
  assert.equal(waterAt(560, 560)?.kind, 'sea');
  assert.ok(groundHeight(560, 560) < SEA_LEVEL - 10);
  assert.ok(underwater(560, -5, 560));
  assert.ok(!underwater(560, 1, 560), 'above the surface');
  assert.equal(waterAt(-100, -100), null);
  // The glass tunnel and the dome under the sea are dry.
  const tunnel = world.roads.find((r) => r.name === 'Abyss Tunnel')!;
  const deep = tunnel.path.find((p) => p.y < -10)!;
  assert.ok(!underwater(deep.x, deep.y + 1, deep.z));
  assert.equal(waterAt(-500, -350)?.kind, 'ice');
});

test('places have names: landmarks, roads and zones', () => {
  assert.equal(worldLocationName(0, -470), 'Castle Eldermoor');
  assert.equal(worldLocationName(122, 522), 'Great Pyramid');
  assert.equal(worldLocationName(-200, -500), 'Western Highway');
  assert.equal(worldLocationName(560, 120), 'Neon Spire');
  assert.equal(worldLocationName(-700, 0), '', 'past the edge');
  for (const l of world.landmarks) assert.ok(worldLocationName(l.x, l.z).length > 0);
});

test('relics, buttons and fishing spots are where they can be reached', () => {
  assert.equal(new Set(RELICS.map((r) => r.id)).size, RELICS.length);
  for (const zone of [...world.zones.map((z) => z.id), 'town' as const]) {
    assert.ok(RELICS.filter((r) => r.zone === zone).length >= 3, `${zone} has relics to find`);
  }
  for (const r of RELICS) {
    assert.equal(zoneAt(r.x, r.z), r.zone, `${r.id} is in its zone`);
    assert.ok(Math.abs(r.x) < WORLD_HALF && Math.abs(r.z) < WORLD_HALF, `${r.id} is inside the world`);
    // Floating no lower than the ground, and not too high to reach (unless it's on something).
    assert.ok(r.y > groundHeight(r.x, r.z) - 0.1, `${r.id} is underground`);
    assert.ok(r.hint.length > 5 && r.name.length > 2);
  }
  for (const t of TRIGGERS) {
    assert.ok(t.y >= groundHeight(t.x, t.z) - 0.2, `${t.id} is underground`);
    assert.ok(!underwater(t.x, t.y + 1, t.z), `${t.id} is under water`);
  }
  for (const s of FISHING_SPOTS) {
    assert.ok(!underwater(s.x, s.y + 1, s.z), `${s.id}: you stand on dry land`);
    assert.ok(waterAt(s.float.x, s.float.z), `${s.id}: the float lands in water`);
    assert.ok(Math.abs(s.y - groundHeight(s.x, s.z)) < 1.5 || s.id === 'ocean/pier', `${s.id}: you stand on the ground`);
  }
});

test('catches are mostly common fish, sometimes rare ones, with sensible weights', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const spot = FISHING_SPOTS[0];
  const counts = new Map<string, number>();
  for (let i = 0; i < 2000; i++) {
    const { fish, kg } = catchFish(spot, rng);
    assert.ok(kg >= fish.kg[0] && kg <= fish.kg[1]);
    counts.set(fish.rarity, (counts.get(fish.rarity) ?? 0) + 1);
  }
  assert.ok(counts.get('common')! > counts.get('rare')!);
  assert.ok(counts.get('legendary')! > 0 && counts.get('legendary')! < 200);
});
