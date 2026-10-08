import * as THREE from 'three';
import { CURB_HEIGHT } from '../../../shared/town.ts';
import { ARM_LENGTH, LAMP_HEIGHT } from './town/props.ts';

/** Real lights are costly per pixel; only the lamps nearest the player get one. */
const POOL_SIZE = 6;
const INTENSITY = 40;
const RESELECT_EVERY = 0.5; // seconds

/**
 * Street lamps after dark: every lamp head glows, and a small pool of point lights
 * follows the player to the nearest lamps so the road beneath them is lit.
 */
export class StreetLights {
  private heads: THREE.Vector3[];
  private lights: THREE.PointLight[] = [];
  private sinceReselect = Infinity;

  constructor(
    scene: THREE.Scene,
    lamps: { x: number; z: number; yaw: number }[],
    private glow: THREE.MeshStandardMaterial,
  ) {
    // The bulb hangs at the end of the arm, which points along the lamp's local +Z.
    this.heads = lamps.map(
      (l) => new THREE.Vector3(l.x + Math.sin(l.yaw) * ARM_LENGTH, CURB_HEIGHT + LAMP_HEIGHT - 0.35, l.z + Math.cos(l.yaw) * ARM_LENGTH),
    );
    for (let i = 0; i < POOL_SIZE; i++) {
      const light = new THREE.PointLight('#ffd7a0', 0, 30, 1.6);
      scene.add(light);
      this.lights.push(light);
    }
  }

  update(focus: THREE.Vector3, night: number, dt: number): void {
    this.glow.emissiveIntensity = 0.15 + night * 4;
    const on = night > 0.3;
    this.sinceReselect += dt;
    if (on && this.sinceReselect >= RESELECT_EVERY) {
      this.sinceReselect = 0;
      const nearest = [...this.heads].sort((a, b) => a.distanceToSquared(focus) - b.distanceToSquared(focus)).slice(0, POOL_SIZE);
      nearest.forEach((p, i) => this.lights[i].position.copy(p));
    }
    const intensity = on ? INTENSITY * THREE.MathUtils.smoothstep(night, 0.3, 0.7) : 0;
    for (const light of this.lights) light.intensity = intensity;
  }
}
