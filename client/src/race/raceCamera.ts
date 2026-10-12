import * as THREE from 'three';
import { settings } from '../settings.ts';

/** Where the cameras sit: chasing behind, or on the car's airbox above the driver's head. */
export type CameraView = 'chase' | 'onboard';

const CHASE = { distance: 6.2, height: 1.9, look: 0.7 };
/** The onboard camera on top of the airbox (car-local, chassis frame). */
const ONBOARD = new THREE.Vector3(0, 0.78, -0.2);
const MAX_FOV_BOOST = 12;

/**
 * Follows a car: from behind and above, easing round as it turns (it doesn't roll or
 * pitch with the car), or onboard, fixed to the car like a broadcast's camera over the
 * driver's head.
 */
export class RaceCamera {
  view: CameraView = 'chase';
  private yaw = 0;
  private position = new THREE.Vector3();
  private fresh = true;
  private forward = new THREE.Vector3();
  private look = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {}

  toggle(): void {
    this.view = this.view === 'chase' ? 'onboard' : 'chase';
    this.fresh = true;
  }

  /** Jump straight into place next update (after a teleport). */
  snap(): void {
    this.fresh = true;
  }

  update(target: THREE.Object3D, speed: number, dt: number): void {
    const cam = this.camera;
    this.forward.set(0, 0, 1).applyQuaternion(target.quaternion);
    let fov = settings.fov;
    if (this.view === 'onboard') {
      cam.position.copy(ONBOARD).applyQuaternion(target.quaternion).add(target.position);
      this.look.copy(this.forward).multiplyScalar(30).add(cam.position);
      this.look.y -= 1.2;
      cam.up.set(0, 1, 0).applyQuaternion(target.quaternion);
      cam.lookAt(this.look);
      fov += 6;
    } else {
      cam.up.set(0, 1, 0);
      const targetYaw = Math.atan2(this.forward.x, this.forward.z);
      if (this.fresh) this.yaw = targetYaw;
      const diff = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
      this.yaw += diff * (1 - Math.exp(-dt * 6));
      const want = new THREE.Vector3(-Math.sin(this.yaw) * CHASE.distance, CHASE.height, -Math.cos(this.yaw) * CHASE.distance).add(target.position);
      if (this.fresh) this.position.copy(want);
      this.position.lerp(want, 1 - Math.exp(-dt * 14));
      cam.position.copy(this.position);
      cam.lookAt(this.look.copy(target.position).setY(target.position.y + CHASE.look));
      fov += Math.min(Math.abs(speed) / 80, 1) * MAX_FOV_BOOST - 2;
    }
    this.fresh = false;
    if (Math.abs(fov - cam.fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }
}
