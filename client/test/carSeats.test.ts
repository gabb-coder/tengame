// People sit inside the car: at the wheel, or riding along, and it's a good fit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import type { Media, PersonInfo } from '../src/assets/media.ts';
import { AvatarModel } from '../src/player/avatarModel.ts';
import type { Human } from '../src/player/humanModel.ts';
import { CarModel } from '../src/vehicles/carModel.ts';
import { loadModel } from './glb.ts';

const manifest = JSON.parse(readFileSync('public/media/manifest.json', 'utf8'));
const everyday: PersonInfo[] = manifest.humans.people.filter((p: PersonInfo) => p.everyday);
const tallest = everyday.reduce((a, b) => ((a.height ?? 0) >= (b.height ?? 0) ? a : b));
const shortest = everyday.reduce((a, b) => ((a.height ?? 9) <= (b.height ?? 9) ? a : b));

test('the driver and three friends fit in the car: heads under the roof, legs in the footwell, hands on the wheel', async () => {
  const car = await loadModel('car.glb');
  CarModel.load({ model: async () => ({ scene: car.scene, min: new THREE.Vector3(), max: new THREE.Vector3() }) } as unknown as Media);
  AvatarModel.load({ humans: async () => manifest.humans, gltf: (name: string) => loadModel(name) } as unknown as Media);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const model = new CarModel('#c00');
  const parts: THREE.Mesh[] = [];
  model.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) parts.push(o as THREE.Mesh);
  });

  for (const person of [tallest, shortest]) {
    for (let n = 0; n < 4; n++) {
      const avatar = new AvatarModel('#29a3e0', `seat ${n}`, { people: [person.name] });
      const seat = model.seat(n);
      // The person loads the first time they're shown.
      let human: Human | null = null;
      for (let i = 0; i < 200 && !human; i++) {
        avatar.rideIn(seat, 1 / 30);
        await new Promise((resolve) => setTimeout(resolve, 5));
        human = (avatar as unknown as { human: Human | null }).human;
      }
      assert.ok(human, 'the person loaded');
      for (let i = 0; i < 30; i++) avatar.rideIn(seat, 1 / 30);
      model.root.updateMatrixWorld(true);
      const at = (bone: string) => human!.bone(bone)!.getWorldPosition(new THREE.Vector3());
      const who = `${person.name} (${person.height} m) in seat ${n}`;

      // The top of the head is below the roof right above it.
      let top = -Infinity;
      human.root.traverse((o) => {
        const skinned = o as THREE.SkinnedMesh;
        if (!skinned.isSkinnedMesh) return;
        skinned.computeBoundingBox();
        top = Math.max(top, skinned.boundingBox!.clone().applyMatrix4(skinned.matrixWorld).max.y);
      });
      const head = at('Head');
      const roof = new THREE.Raycaster(head, new THREE.Vector3(0, 1, 0)).intersectObjects(parts, false)[0];
      assert.ok(roof, `${who}: there's a roof over their head`);
      assert.ok(top < roof.point.y + 0.01, `${who}: the head (top ${top.toFixed(2)}) is under the roof (${roof.point.y.toFixed(2)})`);

      // Sitting low, legs out in front: ankles ahead of the hips, just above the floor.
      const hips = at('pelvis');
      for (const side of ['l', 'r']) {
        const ankle = at(`foot_${side}`);
        assert.ok(ankle.z > hips.z + 0.6, `${who}: the ${side} foot is out in front`);
        const floor = new THREE.Raycaster(ankle.clone().setY(hips.y), new THREE.Vector3(0, -1, 0)).intersectObjects(parts, false)[0];
        assert.ok(floor && ankle.y > floor.point.y - 0.02 && ankle.y < floor.point.y + 0.15, `${who}: the ${side} foot rests on the floor (${ankle.y.toFixed(2)}, floor ${floor?.point.y.toFixed(2)})`);
      }
      // Hands on the wheel.
      const grip = seat.grip;
      assert.equal(!!grip, n === 0, 'the driver holds the wheel');
      if (grip) {
        for (const [side, x] of [['l', 1], ['r', -1]] as const) {
          const wheel = seat.place.localToWorld(grip.clone().setX(grip.x * x));
          assert.ok(at(`hand_${side}`).distanceTo(wheel) < 0.04, `${who}: the ${side} hand is on the wheel`);
        }
      }
      avatar.dispose();
      avatar.root.removeFromParent();
    }
  }
  model.dispose();
});

test('getting out, the person is back in the world, standing', async () => {
  const model = new CarModel('#c00');
  const scene = new THREE.Scene();
  const avatar = new AvatarModel('#29a3e0', 'out');
  avatar.rideIn(model.seat(1), 1 / 30);
  assert.equal(avatar.root.parent, model.seat(1).place);
  avatar.leaveCar(scene);
  assert.equal(avatar.root.parent, scene);
  avatar.animate(0, 1 / 30);
  assert.equal(avatar.seated, false);
  model.dispose();
});
