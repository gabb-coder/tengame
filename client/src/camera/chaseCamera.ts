import * as THREE from 'three';
import { settings } from '../settings.ts';

const DISTANCE = 6.5;
const HEIGHT = 2.2;
const LOOK_HEIGHT = 1;
const MAX_FOV_BOOST = 14;
/** Riding along, how far the camera can be turned to look down on the car, or up. */
const MAX_LOOK_DOWN = 1.1;
const MAX_LOOK_UP = 0.35;

/**
 * Third-person camera behind a car facing +Z. Follows yaw only, so it stays
 * level when the car rolls or flies off a ramp.
 */
export class ChaseCamera {
  private yaw = 0;
  private position = new THREE.Vector3();
  private initialized = false;
  /** Turned to look about (riding along): how far round from behind the car, and up or down. */
  private lookYaw = 0;
  private lookPitch = 0;

  /**
   * `obstruct(from, to)` returns the distance from `from` to the first obstacle
   * toward `to`, or null if the line is clear.
   */
  constructor(
    private camera: THREE.PerspectiveCamera,
    private obstruct?: (from: THREE.Vector3, to: THREE.Vector3) => number | null,
  ) {}

  /** Jump straight behind the target next update instead of easing over (after a teleport). */
  snap(): void {
    this.initialized = false;
    this.position.set(0, 0, 0);
  }

  /** Turns the camera round the car (riding along, the mouse looks about). */
  look(yaw: number, pitch: number): void {
    this.lookYaw += yaw;
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + pitch, -MAX_LOOK_UP, MAX_LOOK_DOWN);
  }

  /** Back to looking where the car goes (for the driver). */
  straighten(): void {
    this.lookYaw = 0;
    this.lookPitch = 0;
  }

  update(target: THREE.Object3D, speed: number, dt: number): void {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(target.quaternion);
    let targetYaw = Math.atan2(forward.x, forward.z);
    // Look backward while reversing so you can see where you're going.
    if (speed < -2) targetYaw += Math.PI;

    if (!this.initialized) {
      this.yaw = targetYaw;
      this.initialized = true;
    }
    // Ease yaw along the shortest arc.
    const diff = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
    this.yaw += diff * (1 - Math.exp(-dt * 4));

    // Behind the car, up a little (and turned about, riding along).
    const yaw = this.yaw + this.lookYaw;
    const pitch = Math.atan2(HEIGHT - LOOK_HEIGHT, DISTANCE) + this.lookPitch;
    const reach = Math.hypot(HEIGHT - LOOK_HEIGHT, DISTANCE);
    const desired = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch) * reach, LOOK_HEIGHT + Math.sin(pitch) * reach, -Math.cos(yaw) * Math.cos(pitch) * reach).add(
      target.position,
    );
    if (this.position.lengthSq() === 0) this.position.copy(desired);
    this.position.lerp(desired, 1 - Math.exp(-dt * 10));
    this.position.y = Math.max(this.position.y, 0.5);

    const look = target.position.clone().setY(target.position.y + LOOK_HEIGHT);
    this.camera.position.copy(this.position);
    // Pull in (without smoothing) when a wall is between the car and the camera.
    const hit = this.obstruct?.(look, this.position);
    if (hit != null) {
      const dir = this.position.clone().sub(look).normalize();
      this.camera.position.copy(look).addScaledVector(dir, Math.max(hit - 0.3, 0.5));
    }
    this.camera.lookAt(look);

    // A little narrower than on foot at rest, widening with speed.
    const fov = settings.fov - 2 + Math.min(Math.abs(speed) / 50, 1) * MAX_FOV_BOOST;
    if (Math.abs(fov - this.camera.fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
  }
}
