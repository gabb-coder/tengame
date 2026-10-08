import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CAR } from './carPhysics.ts';

const WHEEL_POSITIONS: [number, number][] = [
  [CAR.wheelX, CAR.wheelZFront],
  [-CAR.wheelX, CAR.wheelZFront],
  [CAR.wheelX, CAR.wheelZRear],
  [-CAR.wheelX, CAR.wheelZRear],
];

/** Lean limits for the visual body roll/pitch, in radians. */
const MAX_ROLL = 0.07;
const MAX_PITCH = 0.04;

// Shared geometry and materials across all cars.
const tireGeometry = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.26, 28).rotateZ(Math.PI / 2);
const rimGeometry = new THREE.CylinderGeometry(CAR.wheelRadius * 0.62, CAR.wheelRadius * 0.62, 0.27, 10).rotateZ(Math.PI / 2);
const tireMaterial = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.9 });
const rimMaterial = new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.25, metalness: 1 });
const glassMaterial = new THREE.MeshPhysicalMaterial({ color: '#0d1117', roughness: 0.05, metalness: 0.2, clearcoat: 1 });
const trimMaterial = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6 });
const headlightMaterial = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff6d8', emissiveIntensity: 2 });
const taillightMaterial = new THREE.MeshStandardMaterial({ color: '#400', emissive: '#ff0505', emissiveIntensity: 0.35 });

/**
 * Placeholder sports sedan built from primitives, facing +Z. Origin matches the
 * physics chassis center. Swapped for a glTF model in the realism pass.
 */
export class CarModel {
  readonly root = new THREE.Group();
  /** Body parts that lean with roll/pitch; wheels stay planted. */
  private body = new THREE.Group();
  private wheels: THREE.Group[] = [];
  private brakeLights: THREE.MeshStandardMaterial;
  private roll = 0;
  private pitch = 0;

  constructor(color: string) {
    const h = CAR.halfExtents;
    const paint = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.45,
      metalness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });

    const lower = new THREE.Mesh(new RoundedBoxGeometry(h.x * 2, h.y * 2 + 0.1, h.z * 2, 4, 0.14), paint);
    lower.position.y = 0.05;
    const cabin = new THREE.Mesh(new RoundedBoxGeometry(h.x * 1.7, 0.5, h.z * 1.05, 4, 0.18), glassMaterial);
    cabin.position.set(0, h.y + 0.3, -0.25);
    const roof = new THREE.Mesh(new RoundedBoxGeometry(h.x * 1.62, 0.08, h.z * 0.7, 2, 0.04), paint);
    roof.position.set(0, h.y + 0.56, -0.35);
    const bumperF = new THREE.Mesh(new THREE.BoxGeometry(h.x * 1.9, 0.14, 0.12), trimMaterial);
    bumperF.position.set(0, -0.2, h.z + 0.02);
    const bumperR = bumperF.clone();
    bumperR.position.z = -h.z - 0.02;

    this.brakeLights = taillightMaterial.clone();
    for (const side of [-1, 1]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.05), headlightMaterial);
      head.position.set(side * (h.x - 0.32), 0.14, h.z + 0.02);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.05), this.brakeLights);
      tail.position.set(side * (h.x - 0.3), 0.16, -h.z - 0.02);
      this.body.add(head, tail);
    }

    this.body.add(lower, cabin, roof, bumperF, bumperR);
    this.body.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    this.root.add(this.body);

    for (const [x, z] of WHEEL_POSITIONS) {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(tireGeometry, tireMaterial);
      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      tire.castShadow = true;
      // Inner group spins; outer group steers.
      const spin = new THREE.Group();
      spin.add(tire, rim);
      wheel.add(spin);
      wheel.position.set(x, CAR.wheelY - CAR.suspensionRest, z);
      this.wheels.push(wheel);
      this.root.add(wheel);
    }
  }

  /** Poses one wheel. `suspension` is the current spring length. */
  setWheel(i: number, steer: number, rotation: number, suspension: number): void {
    const wheel = this.wheels[i];
    wheel.position.y = CAR.wheelY - suspension;
    wheel.rotation.y = steer;
    wheel.children[0].rotation.x = rotation;
  }

  /**
   * Leans the body from acceleration in the car's frame (m/s²):
   * `lateral` positive = pushed toward +X, `longitudinal` positive = speeding up.
   */
  lean(lateral: number, longitudinal: number, dt: number): void {
    const k = 1 - Math.exp(-dt * 6);
    this.roll += (THREE.MathUtils.clamp(lateral * 0.008, -MAX_ROLL, MAX_ROLL) - this.roll) * k;
    this.pitch += (THREE.MathUtils.clamp(-longitudinal * 0.005, -MAX_PITCH, MAX_PITCH) - this.pitch) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);
  }

  setBraking(on: boolean): void {
    // Kept moderate: tone mapping pushes very bright red toward orange.
    this.brakeLights.emissiveIntensity = on ? 1.3 : 0.35;
  }
}
