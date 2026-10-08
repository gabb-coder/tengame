// Real furniture models are fitted into the boxes the floor plans reserve for them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import type { Furniture } from '../../shared/interior.ts';
import { fitMatrix, modelChoice } from '../src/world/town/furnitureModels.ts';

const model = (min: [number, number, number], max: [number, number, number]) => ({
  scene: new THREE.Group(),
  min: new THREE.Vector3(...min),
  max: new THREE.Vector3(...max),
});
const slot = (type: Furniture['type'], w: number, d: number, h: number): Furniture => ({ type, room: 'r', x: 0, z: 0, y: 0, yaw: 0, w, d, h, color: '#fff' });

/** The model's bounding box after fitting. */
function fitted(f: Furniture, m: ReturnType<typeof model>, yaw = 0): THREE.Box3 {
  return new THREE.Box3(m.min.clone(), m.max.clone()).applyMatrix4(fitMatrix(f, m, yaw));
}

test('a model that matches its box fills it, standing on the floor and centered', () => {
  const box = fitted(slot('sofa', 2, 0.9, 0.8), model([-1.2, 0.1, -0.5], [0.8, 0.9, 0.4]));
  assert.ok(box.min.distanceTo(new THREE.Vector3(-1, 0, -0.45)) < 1e-6, `min ${box.min.toArray()}`);
  assert.ok(box.max.distanceTo(new THREE.Vector3(1, 0.8, 0.45)) < 1e-6, `max ${box.max.toArray()}`);
});

test('tables keep the exact height things are put on, even if proportions differ', () => {
  const box = fitted(slot('diningTable', 1.4, 0.85, 0.76), model([-1.13, 0, -0.68], [1.13, 0.87, 0.71]));
  assert.ok(Math.abs(box.max.y - 0.76) < 1e-6, `top at ${box.max.y}`);
  assert.ok(Math.abs(box.min.y) < 1e-6);
});

test('proportions bend at most 25% to fit an odd-shaped box', () => {
  const box = fitted(slot('armchair', 0.85, 0.85, 0.95), model([-0.5, 0, -0.5], [0.5, 2, 0.5]));
  const size = box.getSize(new THREE.Vector3());
  const stretch = size.y / 2 / (size.x / 1);
  assert.ok(stretch > 1 / 1.25 ** 2 - 1e-6 && stretch < 1.25 ** 2 + 1e-6, `stretched ${stretch}`);
});

test('a model turned 90° fits with its long side along the box', () => {
  // Long along Z in its own frame; the box is long along X.
  const box = fitted(slot('coffeeTable', 1.1, 0.6, 0.42), model([-0.3, 0, -0.6], [0.3, 0.39, 0.6]), Math.PI / 2);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(size.x > size.z * 1.5, `size ${size.toArray()}`);
  assert.ok(Math.abs(size.x - 1.1) < 0.01 && Math.abs(size.z - 0.6) < 0.01);
});

test('each house picks one model per type, and different houses differ', () => {
  assert.equal(modelChoice('h1', 'chair', 2), modelChoice('h1', 'chair', 2));
  const picks = new Set(Array.from({ length: 20 }, (_, i) => modelChoice(`house-${i}`, 'armchair', 3)));
  assert.equal(picks.size, 3);
});
