import * as THREE from 'three';
import type { Interior } from '../../../shared/interior.ts';
import type { House } from '../../../shared/town.ts';
import { roomCenter } from './town/interior.ts';
import { houseMatrix } from './town/houses.ts';

/** Lights are expensive per pixel, so only this many exist; they follow the player. */
const POOL_SIZE = 4;
const INTENSITY = 4;

interface Entry {
  house: House;
  plan: Interior;
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
}

/**
 * Warm ceiling lights for the rooms of whichever house the player is in. A fixed pool of
 * point lights is moved between houses (keeping the light count constant avoids shader
 * recompiles), and turned off outdoors.
 */
export class InteriorLights {
  private lights: THREE.PointLight[] = [];
  private entries: Entry[];
  private current = '';

  constructor(scene: THREE.Scene, houses: House[], interiors: Map<string, Interior>) {
    this.entries = houses.map((house) => {
      const matrix = houseMatrix(house);
      return { house, plan: interiors.get(house.id)!, matrix, inverse: matrix.clone().invert() };
    });
    for (let i = 0; i < POOL_SIZE; i++) {
      const light = new THREE.PointLight('#ffdcb0', 0, 9, 2);
      scene.add(light);
      this.lights.push(light);
    }
  }

  /** True while `focus` is inside a house. */
  inside = false;

  update(focus: THREE.Vector3): void {
    let found: { entry: Entry; story: number; local: THREE.Vector3 } | null = null;
    for (const entry of this.entries) {
      const local = focus.clone().applyMatrix4(entry.inverse);
      const r = entry.plan.inner;
      if (local.x < r.minX || local.x > r.maxX || local.z < r.minZ || local.z > r.maxZ) continue;
      const story = entry.plan.stories === 2 && local.y > entry.plan.floorY[1] - 0.3 ? 1 : 0;
      found = { entry, story, local };
      break;
    }
    this.inside = found !== null;
    const key = found ? `${found.entry.house.id}:${found.story}` : '';
    if (key === this.current) return;
    this.current = key;

    for (const light of this.lights) light.intensity = 0;
    if (!found) return;
    const { entry, story, local } = found;
    const rooms = entry.plan.rooms
      .filter((r) => r.story === story)
      .sort((a, b) => dist(a, local) - dist(b, local))
      .slice(0, POOL_SIZE);
    rooms.forEach((r, i) => {
      const [x, z] = roomCenter(r);
      this.lights[i].position.set(x, entry.plan.ceilingY[story] - 0.35, z).applyMatrix4(entry.matrix);
      this.lights[i].intensity = INTENSITY;
    });
  }
}

function dist(r: { minX: number; maxX: number; minZ: number; maxZ: number }, p: THREE.Vector3): number {
  return Math.hypot((r.minX + r.maxX) / 2 - p.x, (r.minZ + r.maxZ) / 2 - p.z);
}
