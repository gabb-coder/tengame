import * as THREE from 'three';
import { CURB_HEIGHT } from '../../../shared/town.ts';
import type { LightPool } from './lightPool.ts';
import { ARM_LENGTH, LAMP_HEIGHT } from './town/props.ts';

const INTENSITY = 40;

/**
 * Street lamps after dark: every lamp head glows, and the lamps nearest the camera get
 * real lights from the shared pool, so the road beneath them is lit.
 */
export class StreetLights {
  private intensity = 0;

  constructor(
    lights: LightPool,
    lamps: { x: number; z: number; yaw: number }[],
    private glow: THREE.MeshStandardMaterial,
  ) {
    const self = this;
    // The bulb hangs at the end of the arm, which points along the lamp's local +Z.
    for (const l of lamps) {
      lights.add({
        position: new THREE.Vector3(l.x + Math.sin(l.yaw) * ARM_LENGTH, CURB_HEIGHT + LAMP_HEIGHT - 0.35, l.z + Math.cos(l.yaw) * ARM_LENGTH),
        color: '#ffd7a0',
        get intensity() {
          return self.intensity;
        },
        range: 30,
      });
    }
  }

  update(night: number): void {
    this.glow.emissiveIntensity = 0.15 + night * 4;
    this.intensity = night > 0.3 ? INTENSITY * THREE.MathUtils.smoothstep(night, 0.3, 0.7) : 0;
  }
}
