import assert from 'node:assert/strict';
import { test } from 'node:test';
import { circleMover } from '../src/world/zones/creatures.ts';

test('circling creatures fly at their own pace, however large the shared clock', () => {
  // The shared clock is seconds since 1970: billions of them.
  const start = Date.now() / 1000;
  const frame = 1 / 60;
  // The Outpost Nova floaters, the dragon, the drones: radius and speed (m/s).
  for (const [radius, speed] of [[90, 2.2], [85, 16], [140, 14]]) {
    const mover = circleMover(0, 0, radius, 20, speed, null, { absolute: true });
    const a = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
    const b = { ...a };
    let fastest = 0;
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 400; k++) {
        const t = start + k * 0.7;
        mover(i, t, a);
        mover(i, t + frame, b);
        fastest = Math.max(fastest, Math.hypot(b.x - a.x, b.z - a.z) / frame);
      }
    }
    // Drifting in and out of the circle makes it a little quicker at times, never a blur.
    assert.ok(fastest < speed * 1.4, `circling at ${speed} m/s, it moved at ${fastest.toFixed(1)} m/s`);
  }
});
