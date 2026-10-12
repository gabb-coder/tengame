// The real car model's wheels roll upright and straight, round their own axles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Media } from '../src/assets/media.ts';
import { CarModel } from '../src/vehicles/carModel.ts';

/** The car model file without its textures, which can't be decoded outside a browser. */
function untextured(file: string): ArrayBuffer {
  const glb = readFileSync(file);
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  const strip = (o: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(o)) {
      if (key.endsWith('Texture')) delete o[key];
      else if (value && typeof value === 'object') strip(value as Record<string, unknown>);
    }
  };
  json.materials.forEach(strip);
  delete json.textures;
  delete json.images;
  delete json.samplers;
  json.extensionsUsed = json.extensionsUsed?.filter((e: string) => e !== 'EXT_texture_webp');
  json.extensionsRequired = json.extensionsRequired?.filter((e: string) => e !== 'EXT_texture_webp');

  const text = Buffer.from(JSON.stringify(json));
  const chunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, ' ')]);
  const bin = glb.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + chunk.length + bin.length, 8);
  header.writeUInt32LE(chunk.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([header, chunk, bin]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}

test('every wheel of the real car is upright, points straight ahead and spins without wobbling', async () => {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(untextured('public/media/models/car.glb'), '');
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
