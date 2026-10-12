// The real car model's wheels roll upright and straight, round their own axles.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import type { Media } from '../src/assets/media.ts';
import { CarModel } from '../src/vehicles/carModel.ts';
import { loadModel } from './glb.ts';

test('every wheel of the real car is upright, points straight ahead and spins without wobbling', async () => {
  const gltf = await loadModel('car.glb');
  const model = { scene: gltf.scene, min: new THREE.Vector3(), max: new THREE.Vector3() };
  CarModel.load({ model: async () => model } as unknown as Media);
  await new Promise((resolve) => setTimeout(resolve));

  const car = new CarModel('#c00');
  const wheels = (car as unknown as { wheels: THREE.Group[] }).wheels;
  assert.equal(wheels.length, 4);
  const size = (wheel: THREE.Object3D) => {
    car.root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(wheel.children[0], true).getSize(new THREE.Vector3());
  };
  for (let i = 0; i < 4; i++) {
    car.setWheel(i, 0, 0, 0.2);
    const still = size(wheels[i]);
    // Seen from the side it's a circle (as tall as it is long); from the front, a narrow tyre.
    assert.ok(Math.abs(still.y - still.z) < 0.02, `wheel ${i} is ${still.y.toFixed(2)} tall but ${still.z.toFixed(2)} long`);
    assert.ok(still.x < still.y * 0.5, `wheel ${i} is ${still.x.toFixed(2)} wide`);
    // Rolling round its axle, it keeps the same shape.
    for (const turn of [0.7, 1.9, 4]) {
      car.setWheel(i, 0, turn, 0.2);
      const rolled = size(wheels[i]);
      assert.ok(rolled.distanceTo(still) < 0.02, `wheel ${i} wobbles: ${still.toArray().map((v) => v.toFixed(2))} → ${rolled.toArray().map((v) => v.toFixed(2))}`);
    }
  }
  car.dispose();
});
