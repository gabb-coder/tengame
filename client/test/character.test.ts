// Headless walking tests against a real house: walls, porch step, and the front door.
import RAPIER from '@dimforge/rapier3d-compat';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import { CURB_HEIGHT, doorPosition, generateTown, type House } from '../../shared/town.ts';
import { AVATAR, CharacterPhysics } from '../src/player/character.ts';
import { Doors } from '../src/world/doors.ts';
import { buildHouse, FOUNDATION_HEIGHT } from '../src/world/town/houses.ts';
import type { TownMaterials } from '../src/world/town/materials.ts';
import { MeshBuilder } from '../src/world/town/meshBuilder.ts';

const DT = 1 / 60;
const house = generateTown().houses.find((h) => h.facing === 'south')!;

before(() => RAPIER.init());

/** Every material lookup returns the same plain material; rendering isn't tested here. */
function fakeMaterials(): TownMaterials {
  const mat = new THREE.MeshStandardMaterial();
  const walls = new Proxy({}, { get: () => mat });
  return new Proxy({}, { get: (_, key) => (key === 'walls' ? walls : mat) }) as TownMaterials;
}

function setup(h: House = house) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  // The block surface the house stands on.
  world.createCollider(RAPIER.ColliderDesc.cuboid(200, CURB_HEIGHT / 2, 200).setTranslation(0, CURB_HEIGHT / 2, 0));
  buildHouse(h, new MeshBuilder(), fakeMaterials(), world);
  const mat = new THREE.MeshStandardMaterial();
  const doors = new Doors(new THREE.Scene(), [h], { door: mat, brass: mat }, world);
  world.step(); // register colliders with the query pipeline
  return { world, doors };
}

function walk(world: RAPIER.World, c: CharacterPhysics, dir: THREE.Vector3, seconds: number, opts: { run?: boolean; jump?: boolean; onStep?: () => void } = {}) {
  for (let i = 0; i < seconds / DT; i++) {
    c.step(dir.clone().normalize(), opts.run ?? false, opts.jump ?? false, DT);
    world.step();
    opts.onStep?.();
  }
}

const door = doorPosition(house);
// House faces south (+Z): its front wall is at z = door.z, inside is -Z.
const INTO_HOUSE = new THREE.Vector3(0, 0, -1);

test('walks at walking speed on flat ground and stays on the surface', () => {
  const { world } = setup();
  const c = new CharacterPhysics(world, { x: house.x + 30, y: CURB_HEIGHT, z: house.z });
  walk(world, c, new THREE.Vector3(1, 0, 0), 2);
  const feet = c.feet;
  assert.ok(Math.abs(feet.x - (house.x + 30) - 2 * AVATAR.walkSpeed) < 0.6, `walked ${feet.x - house.x - 30} m`);
  assert.ok(Math.abs(feet.y - CURB_HEIGHT) < 0.05, `feet at ${feet.y}`);
  assert.ok(c.grounded);
});

test('walls block walking', () => {
  const { world } = setup();
  // In front of the house, away from the porch and door.
  const x = house.x + (house.doorOffset > 0 ? -1 : 1) * (house.width / 2 - 1.2);
  const c = new CharacterPhysics(world, { x, y: CURB_HEIGHT, z: door.z + 3 });
  walk(world, c, INTO_HOUSE, 3);
  assert.ok(c.feet.z > door.z, `went through the wall to z=${c.feet.z} (wall at ${door.z})`);
});

test('climbs the porch step, is stopped by the closed door, and walks in once it opens', () => {
  const { world, doors } = setup();
  const c = new CharacterPhysics(world, { x: door.x, y: CURB_HEIGHT, z: door.z + 3 });
  walk(world, c, INTO_HOUSE, 3);
  assert.ok(c.feet.y > CURB_HEIGHT + FOUNDATION_HEIGHT - 0.05, `didn't climb the porch: feet at ${c.feet.y}`);
  assert.ok(c.feet.z > door.z - 0.1, `passed through the closed door to z=${c.feet.z}`);

  const near = doors.nearest(c.feet, 2.2);
  assert.equal(near?.house.id, house.id);
  doors.setOpen(house.id, true);
  for (let i = 0; i < 60; i++) {
    doors.update(DT);
    world.step();
  }
  walk(world, c, INTO_HOUSE, 2);
  assert.ok(c.feet.z < door.z - 1.5, `didn't get inside: z=${c.feet.z}, door at ${door.z}`);
  assert.ok(Math.abs(c.feet.y - (CURB_HEIGHT + FOUNDATION_HEIGHT)) < 0.1, `inside floor height ${c.feet.y}`);

  // Can't walk out through the back wall.
  walk(world, c, INTO_HOUSE, 4);
  assert.ok(c.feet.z > house.z - house.depth / 2, 'went through the back wall');
});

test('jumps about half a meter and lands', () => {
  const { world } = setup();
  const c = new CharacterPhysics(world, { x: house.x + 30, y: CURB_HEIGHT, z: house.z });
  walk(world, c, new THREE.Vector3(), 0.2);
  let peak = 0;
  walk(world, c, new THREE.Vector3(), 0.1, { jump: true });
  walk(world, c, new THREE.Vector3(), 1.5, { onStep: () => (peak = Math.max(peak, c.feet.y - CURB_HEIGHT)) });
  assert.ok(peak > 0.4 && peak < 1, `jump peak ${peak}`);
  assert.ok(c.grounded && Math.abs(c.feet.y - CURB_HEIGHT) < 0.05);
});

test('fits() detects walls and free space', () => {
  const { world } = setup();
  const c = new CharacterPhysics(world, { x: house.x + 30, y: CURB_HEIGHT, z: house.z });
  assert.equal(c.fits({ x: house.x + 20, y: CURB_HEIGHT, z: house.z }), true);
  // Straddling the side wall.
  assert.equal(c.fits({ x: house.x + house.width / 2 - 0.1, y: CURB_HEIGHT + FOUNDATION_HEIGHT, z: house.z }), false);
});
