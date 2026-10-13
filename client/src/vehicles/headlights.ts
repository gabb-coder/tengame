import * as THREE from 'three';
import type { Car } from './car.ts';

/**
 * Real headlights, lighting the road ahead of whichever car we're driving: ours, or a
 * friend's (other cars' lamps just glow). There's always the one pair, in the scene even
 * while unlit, since adding or taking away a light rebuilds every shader.
 */
export class Headlights {
  private beams: THREE.SpotLight[] = [];
  private car: Car | null = null;

  constructor(private scene: THREE.Scene) {
    for (const side of [-1, 1]) {
      const beam = new THREE.SpotLight('#fff3dc', 0, 90, 0.45, 0.5, 1.1);
      beam.position.set(side * 0.7, -0.03, 2.15);
      beam.target.position.set(side * 0.55, -1.3, 22);
      this.beams.push(beam);
    }
    this.fit(null);
  }

  /** Puts them on `car`, or away (unlit, but still in the scene) when there's none. */
  fit(car: Car | null): void {
    this.car = car;
    const holder = car?.object ?? this.scene;
    for (const beam of this.beams) holder.add(beam, beam.target);
  }

  /** On at night, while the engine runs (and they aren't smashed). */
  update(night: number): void {
    const car = this.car;
    const on = car && car.running && car.model.headlights ? THREE.MathUtils.smoothstep(night, 0.25, 0.6) : 0;
    for (const beam of this.beams) beam.intensity = on * 260;
  }
}
